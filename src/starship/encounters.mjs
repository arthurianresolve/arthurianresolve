import { canHoldAt, firstOverlapAt, holdFlightAt, positionAt, trafficConflictAt } from './motion.mjs';
import { EXIT_FADE, PLAYBACK_SPEED, SHIELD, TRAFFIC } from './config.mjs';

const RANGE = 110;
const DURATION = 1.6;
const COOLDOWN = 2; // Logical seconds after impact, before another exchange.
const FLYBY = { attack: 0.1, hit: 0.3, reply: 0.45, replyHit: 0.65 };

/** Face an opponent during a checked pause, using the shared event-shifting rules. */
function pauseForEncounter(flight, time, duration, target) {
  const copy = holdFlightAt(flight, time, duration, { reason: 'encounter', otherShip: target.id });
  const pose = positionAt(flight, time);
  const heading = Math.atan2(target.x - pose.x, pose.y - target.y) * 180 / Math.PI;
  const angle = pose.angle + ((heading - pose.angle + 540) % 360 + 360) % 360 - 180;
  copy.positions = [
    ...copy.positions.filter((p) => p.time < time), { ...pose, time },
    { ...pose, angle, time: time + 0.15 }, { ...pose, angle, time: time + duration - 0.15 },
    { ...pose, time: time + duration },
    ...copy.positions.filter((p) => p.time > time + duration),
  ];
  return copy;
}

/** Aim a cosmetic projectile at the target's impact pose; never attach cell damage. */
function combatShot(source, target, fire, hit, weapon) {
  const pose = positionAt(source, fire);
  const aim = positionAt(target, hit);
  const length = Math.hypot(aim.x - pose.x, aim.y - pose.y);
  const dx = (aim.x - pose.x) / length;
  const dy = (aim.y - pose.y) / length;
  return { shipId: source.id, targetShipId: target.id, weapon, fire, hit,
    from: { x: pose.x + dx * source.muzzle, y: pose.y + dy * source.muzzle },
    x: aim.x - 6, y: aim.y - 6, dx, dy };
}

/** Append paired hits to candidates so a rejected shield expansion changes nothing. */
function exchange(cruiser, bird, time, timing = { attack: 0.2, hit: 0.55, reply: 0.8, replyHit: 1.15 }) {
  const add = (ship, target, fire, hit, shield, weapon) => ({ ...ship,
    shields: [...(ship.shields ?? []), { hit: shield }],
    combatShots: [...(ship.combatShots ?? []), combatShot(ship, target, fire, hit, weapon)],
  });
  return [add(cruiser, bird, time + timing.reply, time + timing.replyHit, time + timing.hit, 'torpedo'),
    add(bird, cruiser, time + timing.attack, time + timing.hit, time + timing.replyHit, 'green-torpedo')];
}

function separated(cruiser, bird, others, conflictAt = trafficConflictAt) {
  return conflictAt(cruiser, bird) === null && others.every((flight) =>
    conflictAt(cruiser, flight) === null && conflictAt(bird, flight) === null);
}

/**
 * Try one harmless Enterprise/Klingon exchange between nearby, diverging ships.
 * Candidates preserve in-flight weapons and recheck hulls, shields and following
 * against the fleet. Reject unsafe candidates without mutating reserved flights.
 */
export function stageEncounter(cruiser, bird, otherFlights, { maxDelaySeconds = TRAFFIC.encounterDelaySeconds } = {}) {
  const duration = DURATION;
  if (duration / PLAYBACK_SPEED > maxDelaySeconds) return [cruiser, bird];
  for (let time = Math.max(cruiser.startAt, bird.startAt) + 1; time < Math.min(cruiser.exitAt, bird.exitAt) - 1; time += 0.1) {
    if (!canHoldAt(cruiser, time) || !canHoldAt(bird, time)) continue;
    const c = positionAt(cruiser, time);
    const b = positionAt(bird, time);
    const cNext = positionAt(cruiser, time + 0.08);
    const bNext = positionAt(bird, time + 0.08);
    const distance = Math.hypot(c.x - b.x, c.y - b.y);
    const cv = { x: cNext.x - c.x, y: cNext.y - c.y };
    const bv = { x: bNext.x - b.x, y: bNext.y - b.y };
    if (distance < 48 || distance > RANGE || Math.hypot(cv.x, cv.y) < 1 || Math.hypot(bv.x, bv.y) < 1 || cv.x * bv.x + cv.y * bv.y > 0.01 || Math.hypot(cNext.x - bNext.x, cNext.y - bNext.y) <= distance) continue;
    const next = exchange(pauseForEncounter(cruiser, time, duration, { ...b, id: bird.id }),
      pauseForEncounter(bird, time, duration, { ...c, id: cruiser.id }), time);
    if (separated(...next, otherFlights)) return next;
  }
  return [cruiser, bird];
}

/**
 * Add harmless exchanges to all reserved crossings, including parallel or waiting
 * ships. Only effects change: moving earlier flights would invalidate later hull,
 * damage and respawn reservations. Keep weapons free and check the full shield life.
 */
export function stageFlybyEncounters(flights, end) {
  for (const cruiser of flights.filter((flight) => flight.id === 'cruiser')) {
    for (const bird of flights.filter((flight) => flight.id === 'bird')) {
      const others = flights.filter((flight) => flight !== cruiser && flight !== bird);
      const until = Math.min(cruiser.exitAt, bird.exitAt, end) - FLYBY.replyHit - SHIELD.duration;
      for (let time = Math.max(cruiser.startAt, bird.startAt) + 0.2; time < until; time += 0.1) {
        // Use each launcher's actual firing window. Requiring both to be idle
        // for the whole exchange suppresses combat throughout a dense calendar.
        if ([[bird, FLYBY.attack, FLYBY.hit], [cruiser, FLYBY.reply, FLYBY.replyHit]].some(([ship, fire, hit]) =>
          ship.shots.some((shot) => shot.fire <= time + hit && shot.hit >= time + fire)
          || ship.combatShots?.some((shot) => shot.fire < time + FLYBY.replyHit && shot.hit + COOLDOWN >= time))) continue;
        // Relative motion is linear between pose boundaries; its maximum distance
        // occurs at an endpoint. Both ships must stay in range through retaliation.
        const times = [time + FLYBY.attack, time + FLYBY.replyHit, ...[cruiser, bird].flatMap((ship) => ship.positions
          .filter((pose) => pose.time > time + FLYBY.attack && pose.time < time + FLYBY.replyHit).map((pose) => pose.time))];
        if (times.some((at) => {
          const c = positionAt(cruiser, at), b = positionAt(bird, at);
          return Math.hypot(c.x - b.x, c.y - b.y) > RANGE;
        })) continue;
        const next = exchange(cruiser, bird, time, FLYBY);
        // Trajectories and following clearance are already reserved. Only these
        // shield intervals enlarge the hull; include both complete fades.
        const shieldWindow = next.map((ship) => ({ ...ship, startAt: time + FLYBY.hit,
          exitAt: time + FLYBY.replyHit + SHIELD.duration - EXIT_FADE }));
        if (!separated(...shieldWindow, others, firstOverlapAt)) continue;
        for (const [ship, candidate, target] of [[cruiser, next[0], bird], [bird, next[1], cruiser]]) {
          ship.combatShots = candidate.combatShots.sort((a, b) => a.fire - b.fire);
          ship.shields = candidate.shields.sort((a, b) => a.hit - b.hit);
          ship.events = [...(ship.events ?? []), { start: time, end: time + FLYBY.replyHit + SHIELD.duration,
            reason: 'flyby-combat', otherShip: target.id, otherStartAt: target.startAt }].sort((a, b) => a.start - b.start);
        }
      }
    }
  }
}
