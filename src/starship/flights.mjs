import { DAMAGE, FLIGHT_SPEED } from './config.mjs';
import { createDamageTimeline } from './damage.mjs';
import { createMotion } from './motion.mjs';
import { createDiscoveryMotion } from './discovery-motion.mjs';

/** Enterprise repeats 3 torpedoes / 2 phasers, then 4 / 2, then 5 / 2. */
export const enterpriseWeapon = (index) => [3, 4, 9, 10, 16, 17].includes(index % 18) ? 'phaser' : 'torpedo';

/**
 * Plan one armed crossing through cell centers, with one damage event per shot.
 * Ordinary weapons hit the first occupied cell up to four cells ahead. A cell
 * scheduled to clear soon can be waited for at the next cell. Distant scheduled
 * hits are not exclusive claims: move through clear space and clear the blocker.
 * Input cells/path are not mutated; positions and shots belong to this flight.
 * direction=-1 enters from the right, faces left, and exits past the left edge.
 */
export function planFlight(cells, path, { id, muzzle = 6, sharedClearTimes = new Map(), sharedShots = [], startY, startAt = 0, speed = FLIGHT_SPEED, spawnX, launchHold = 0.65, direction = 1 }) {
  const byPosition = new Map(cells.map((cell) => [`${cell.x + 6},${cell.y + 6}`, cell]));
  const route = path.map((cell) => ({ x: cell.x + 6, y: cell.y + 6 }));

  const motion = createMotion({ x: spawnX ?? route[0].x - 20 * direction,
    y: startY ?? route[0].y, angle: 90 * direction }, speed, startAt);
  const { positions, hold, face, move } = motion;
  const shots = [];
  const cleared = new Set();
  const damage = createDamageTimeline(cells, sharedShots, sharedClearTimes);
  const { remainingAt, clearedAt } = damage;

  hold(launchHold, 'launch');
  if (motion.position.y !== route[0].y) {
    const entry = { x: motion.position.x, y: route[0].y };
    face(entry);
    move(entry);
  }
  for (const [index, next] of route.entries()) {
    face(next);
    const dx = Math.sign(next.x - motion.position.x);
    const dy = Math.sign(next.y - motion.position.y);
    // Shoot the first occupied cell ahead; a laser cannot pass through another one.
    for (let ahead = index; ahead < Math.min(route.length, index + 4); ahead++) {
      const target = route[ahead];
      const distance = (target.x - motion.position.x) * dx + (target.y - motion.position.y) * dy;
      if (distance > 64 || target.x !== motion.position.x + dx * distance || target.y !== motion.position.y + dy * distance) break;
      const cell = byPosition.get(`${target.x},${target.y}`);
      if (!cell?.level || cleared.has(cell.date)) continue;
      const clearAt = clearedAt(cell);
      if (clearAt <= motion.time) {
        cleared.add(cell.date);
        continue;
      }
      // Do not stop several empty cells early for somebody else's future shot.
      if (ahead > index && Number.isFinite(clearAt)) break;
      const from = { x: motion.position.x + dx * muzzle, y: motion.position.y + dy * muzzle };
      const shotSeconds = 0.07 + (distance - muzzle) / 360 + DAMAGE.clearanceDelay;
      // A nearly completed clearance can save a redundant volley. Bound that
      // wait by our own time to clear the remaining density.
      if (ahead === index && (remainingAt(cell, motion.time) === 0
        || clearAt - motion.time <= shotSeconds * remainingAt(cell, motion.time))) {
        hold(clearAt - motion.time, 'shared-clearance', { date: cell.date });
        cleared.add(cell.date);
        break;
      }
      while (remainingAt(cell, motion.time) > 0) {
        const fire = motion.time;
        const hit = fire + 0.07 + (distance - muzzle) / 360;
        const remaining = remainingAt(cell, hit);
        if (!remaining) {
          // A shot already in flight finishes first; let its explosion clear.
          hold(clearedAt(cell) - motion.time, 'shared-clearance', { date: cell.date });
          break;
        }
        const weapon = id === 'cruiser' ? enterpriseWeapon(shots.length) : id === 'bird' ? 'green-torpedo' : 'laser';
        const shot = { ...cell, shipId: id, weapon, from, dx, dy, fire, hit, before: remaining, after: remaining - 1, destroyedAt: remaining === 1 ? hit + DAMAGE.explosionDelay : null };
        shots.push(shot);
        damage.record(shot);
        hold(hit - fire + DAMAGE.clearanceDelay, 'firing', { date: cell.date, weapon });
      }
      cleared.add(cell.date);
      break;
    }
    move(next);
  }

  const exit = { x: route.at(-1).x + 20 * direction, y: motion.position.y };
  face(exit);
  move(exit);
  return { id, shots, positions, events: motion.events, route, muzzle, startAt, exitAt: motion.time, speed, direction };
}

/**
 * Plan Discovery’s clear-space crossing, emergency beam, and retreat/retry loop.
 * Prefer already clear cells, then fields unused by armed routes. The route search
 * receives weighted clones; movement and damage always use the original cells.
 * laserDuration is in logical seconds (the caller converts two playback seconds).
 * A continuous beam is separate from its per-block damage pulses.
 */
export function planDiscovery(cells, clearTimes, armedRoutes, findRoute, startAt = 0, armedShots = [], laserDuration = 1, spawnX) {
  const left = Math.min(...cells.map((cell) => cell.x));
  const spawn = { x: spawnX ?? left - 14, y: 138 + 3 * 16 };
  const motion = createDiscoveryMotion(spawn, startAt);
  const used = new Set(armedRoutes.flat().map((cell) => cell.date));
  const byPosition = new Map(cells.map((cell) => [`${cell.x + 6},${cell.y + 6}`, cell]));
  const damage = createDamageTimeline(cells, armedShots, clearTimes);
  const { remainingAt, clearedAt } = damage;
  const shots = [];
  const beams = [];
  const retries = [];
  const route = [];
  motion.hold(0.65, 'launch');
  for (let attempt = 0; attempt < 1000; attempt++) {
    const candidates = cells.map((cell) => ({ ...cell,
      level: (clearedAt(cell) > motion.time ? remainingAt(cell, motion.time) * 100000 : 0) + (used.has(cell.date) ? 1 : 0),
    }));
    const path = findRoute(candidates, spawn.y - 6).route.map((cell) => byPosition.get(`${cell.x + 6},${cell.y + 6}`));
    const visited = [spawn];
    const entry = { x: spawn.x, y: path[0].y + 6 };
    if (entry.y !== spawn.y) { motion.face(entry); motion.move(entry); visited.push(entry); }
    let blocked;
    for (const cell of path) {
      const next = { x: cell.x + 6, y: cell.y + 6 };
      motion.face(next);
      if (clearedAt(cell) > motion.time) {
        motion.hold(0.6, 'blocked', { date: cell.date });
        if (remainingAt(cell, motion.time) > 0 && clearedAt(cell) > motion.time) {
          const dx = Math.sign(next.x - motion.position.x);
          const dy = Math.sign(next.y - motion.position.y);
          const fire = motion.time;
          const end = fire + laserDuration;
          const from = { x: motion.position.x + dx * 11, y: motion.position.y + dy * 11 };
          const to = { x: next.x + dx * 22, y: next.y + dy * 22 };
          const beamId = beams.length;
          beams.push({ from, to, fire, end });
          for (let pulse = 1; pulse <= 2; pulse++) for (let offset = 0; offset < 2; offset++) {
            const target = byPosition.get(`${next.x + dx * offset * 16},${next.y + dy * offset * 16}`);
            if (!target) continue;
            const hit = fire + laserDuration * pulse / 2;
            const before = clearedAt(target) <= hit ? 0 : remainingAt(target, hit);
            if (before > 0) {
              const shot = { ...target, shipId: 'discovery', weapon: 'discovery-laser', beamId, from, dx, dy, fire, hit, before, after: before - 1, destroyedAt: before === 1 ? hit + DAMAGE.explosionDelay : null };
              shots.push(shot);
              damage.record(shot);
            }
          }
          motion.hold(laserDuration + DAMAGE.clearanceDelay, 'emergency-beam', { date: cell.date });
        }
        if (clearedAt(cell) > motion.time) { blocked = cell; break; }
      }
      motion.move(next);
      visited.push(next);
      route.push(next);
    }
    if (!blocked) {
      const exit = { x: path.at(-1).x + 26, y: motion.position.y };
      motion.face(exit);
      motion.move(exit);
      return { id: 'discovery', shots, beams, burns: motion.burns, bursts: motion.bursts, muzzle: 11, route, positions: motion.positions, events: motion.events, startAt, exitAt: motion.time, retries, speed: FLIGHT_SPEED / 3 };
    }
    const retry = { blockedDate: blocked.date, pausedAt: motion.time };
    motion.hold(0.6, 'retreat-check', { date: blocked.date });
    retry.retreatAt = motion.time;
    for (const next of visited.slice(0, -1).reverse()) { motion.face(next); motion.move(next); }
    // When the first cell is blocked, it is already waiting at the left edge.
    motion.face({ x: spawn.x + 16, y: spawn.y });
    retry.returnedAt = motion.time;
    motion.hold(0.8, 'retry', { date: blocked.date });
    retry.retryAt = motion.time;
    retries.push(retry);
  }
  throw new Error('Discovery could not reach a cleared crossing.');
}
