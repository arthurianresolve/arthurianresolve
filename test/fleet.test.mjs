// Integrated behavior checks. IDs link each rule to docs/ARCHITECTURE.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { planAnimation } from '../src/starship/fleet.mjs';
import { reconcileDamage } from '../src/starship/damage.mjs';
import { planDiscovery, planFlight } from '../src/starship/flights.mjs';
import { firstFollowingAt, flightsOverlap, positionAt } from '../src/starship/motion.mjs';
import { ENTERPRISE_SPEED, FLIGHT_SPEED, HULL_RADII, PLAYBACK_SPEED, STARFLIGHT_SPEED } from '../src/starship/config.mjs';
import { findLeastResistanceRoute } from '../src/starship/routes.mjs';
import { renderPlan } from '../src/starship/render.mjs';
import { createDiscoveryMotion } from '../src/starship/discovery-motion.mjs';
import { validatePlan } from '../src/starship/validate.mjs';

const snapshot = JSON.parse(await readFile(new URL('../data/contributions.json', import.meta.url), 'utf8'));
// Shared read-only integration plan; mutation tests use their own cloned fixtures.
const snapshotPlan = planAnimation(snapshot.days);

test('[FLIGHT-01] Starflight crosses right to left and never fires or flies through a surviving block', () => {
  const plan = snapshotPlan;
  const sharedHits = plan.fleetFlights.flatMap((ship) => ship.shots);
  const routeDates = new Set(plan.cells.filter((cell) => plan.route.some((point) => point.x === cell.x + 6 && point.y === cell.y + 6)).map((cell) => cell.date));
  assert.ok(plan.shots.length <= plan.resistance, 'Other ships can clear shared cells first.');
  assert.equal(sharedHits.filter((shot) => routeDates.has(shot.date)).length, plan.resistance);
  const hits = new Map(sharedHits.filter((shot) => shot.after === 0).map((shot) => [shot.date, shot.destroyedAt]));
  const active = plan.cells.filter((cell) => cell.count > 0);
  for (const [i, shot] of plan.shots.entries()) {
    assert.ok(shot.hit > shot.fire);
    assert.equal(shot.before - shot.after, 1);
    assert.ok(shot.before >= 1 && shot.before <= 4);
    assert.equal(shot.destroyedAt !== null, shot.after === 0);
    const position = plan.positions.findLast((pos) => pos.time <= shot.fire);
    assert.equal(Math.abs(shot.dx) + Math.abs(shot.dy), 1);
    assert.ok(Math.abs(Math.sin(position.angle * Math.PI / 180) - shot.dx) < 1e-9);
    assert.ok(Math.abs(-Math.cos(position.angle * Math.PI / 180) - shot.dy) < 1e-9);
    assert.equal(shot.from.x, position.x + shot.dx * 6);
    assert.equal(shot.from.y, position.y + shot.dy * 6);
    const distance = (shot.x + 6 - position.x) * shot.dx + (shot.y + 6 - position.y) * shot.dy;
    assert.ok(distance > 0 && distance <= 64);
    assert.equal((shot.x + 6 - position.x) * shot.dy, (shot.y + 6 - position.y) * shot.dx);
    for (const cell of active) {
      const along = (cell.x + 6 - position.x) * shot.dx + (cell.y + 6 - position.y) * shot.dy;
      const cross = (cell.x + 6 - position.x) * shot.dy - (cell.y + 6 - position.y) * shot.dx;
      if (cross === 0 && along > 0 && along < distance) assert.ok(hits.get(cell.date) < shot.fire, 'Lasers must not pass through an uncleared cell.');
    }
    if (i) assert.ok(shot.fire > plan.shots[i - 1].hit);
  }
  for (const [i, position] of plan.positions.entries()) {
    const prior = plan.positions[Math.max(0, i - 1)];
    assert.ok(position.x <= prior.x, 'Starflight must keep progressing toward the left.');
    assert.ok(prior.x === position.x || prior.y === position.y, 'Movement must turn at grid corners, not cut diagonally.');
    for (const cell of active) {
      const x = cell.x + 6;
      const y = cell.y + 6;
      const crosses = prior.x === position.x
        ? x === position.x && y >= Math.min(prior.y, position.y) && y <= Math.max(prior.y, position.y)
        : y === position.y && x >= Math.min(prior.x, position.x) && x <= Math.max(prior.x, position.x);
      if (crosses) assert.ok(hits.get(cell.date) <= prior.time, 'A contribution must be cleared before the ship enters it.');
    }
  }
  assert.ok(plan.positions[0].x > Math.max(...plan.cells.map((cell) => cell.x)) + 12);
  assert.ok(plan.positions.at(-1).x < Math.min(...plan.cells.map((cell) => cell.x)));
  assert.equal(plan.positions[0].angle, -90);
  assert.equal(plan.ships[0].startAt, plan.ships[1].startAt, 'The lead ships still appear together.');
  assert.ok(plan.shots.some((shot) => shot.dx === -1));
  assert.ok(plan.shots.every((shot) => shot.dx <= 0), 'Forward fire points left or along a vertical detour.');
  assert.equal(plan.exitAt, plan.positions.at(-1).time);
  assert.ok(plan.reset > plan.positions.at(-1).time);
  assert.ok(plan.cells.every((cell) => cell.x >= 44 && cell.x + 12 < 940 && cell.y >= 132 && cell.y + 12 < 282));
});

test('[DAMAGE-01] each density level takes exactly that many hits and only the last hit destroys it', () => {
  for (const level of [1, 2, 3, 4]) {
    // Isolate shot cost here; DAMAGE-02 checks ownership across the whole fleet.
    const cells = snapshotPlan.cells.map((cell) => ({ ...cell, level, count: level * 10 }));
    const { route } = findLeastResistanceRoute(cells, 196, { direction: -1 });
    const plan = planFlight(cells, route, { id: 'scout', direction: -1, spawnX: 920 });
    const groups = Map.groupBy(plan.shots, (shot) => shot.date);
    for (const group of groups.values()) {
      assert.deepEqual(group.map((shot) => shot.before), Array.from({ length: level }, (_, i) => level - i));
      assert.deepEqual(group.map((shot) => shot.after), Array.from({ length: level }, (_, i) => level - i - 1));
      assert.ok(group.slice(0, -1).every((shot) => shot.destroyedAt === null));
      const last = group.at(-1);
      assert.ok(last.destroyedAt > last.hit);
      const entry = plan.positions.find((pos) => pos.x === last.x + 6 && pos.y === last.y + 6);
      assert.ok(entry.time >= last.hit + 0.22, 'The ship must wait for the explosion to finish.');
    }
    assert.equal(plan.shots.length, plan.route.length * level);
    assert.equal(groups.size, plan.route.length);
  }
});

test('[DAMAGE-02] the fleet shares damage correctly and Discovery only enters empty or cleared cells', () => {
  const plan = snapshotPlan;
  const [scout, cruiser] = plan.ships;
  assert.deepEqual(plan.ships.map((ship) => ship.id), ['scout', 'cruiser', 'bird', 'discovery', 'tardis']);
  assert.notEqual(scout.positions[0].y, cruiser.positions[0].y);
  assert.equal(scout.positions[0].y, 138 + 4 * 16);
  assert.equal(cruiser.positions[0].y, 138 + 2 * 16);
  assert.equal(plan.ships[3].positions[0].y, 138 + 3 * 16);
  assert.notDeepEqual(scout.route, cruiser.route);
  assert.ok(cruiser.shots.some((shot) => shot.level === 4));
  assert.ok(cruiser.shots.length > scout.shots.length);
  const allShots = plan.fleetFlights.flatMap((ship) => ship.shots).sort((a, b) => a.hit - b.hit);
  const groups = Map.groupBy(allShots, (shot) => shot.date);
  const destroyed = new Map();
  for (const [date, shots] of groups) {
    assert.equal(shots.length, shots[0].level);
    assert.equal(shots.filter((shot) => shot.after === 0).length, 1);
    destroyed.set(date, shots.at(-1).hit + 0.22);
  }
  const active = plan.cells.filter((cell) => cell.level > 0);
  for (const ship of plan.fleetFlights) {
    for (const [i, position] of ship.positions.entries()) if (i) {
      const before = ship.positions[i - 1];
      if (ship.id === 'scout') assert.ok(position.x <= before.x);
      else if (!['discovery', 'tardis'].includes(ship.id)) assert.ok(position.x >= before.x);
      for (const cell of active) {
        const x = cell.x + 6;
        const y = cell.y + 6;
        const crosses = before.x === position.x
          ? x === position.x && y >= Math.min(before.y, position.y) && y <= Math.max(before.y, position.y)
          : y === position.y && x >= Math.min(before.x, position.x) && x <= Math.max(before.x, position.x);
        if (crosses) assert.ok(destroyed.get(cell.date) <= before.time, `${ship.id} entered ${cell.date} before its explosion finished.`);
      }
    }
    for (const shot of ship.shots) {
      const position = ship.positions.findLast((pos) => pos.time <= shot.fire);
      assert.equal(shot.from.x, position.x + shot.dx * ship.muzzle);
      assert.equal(shot.from.y, position.y + shot.dy * ship.muzzle);
      const distance = (shot.x + 6 - position.x) * shot.dx + (shot.y + 6 - position.y) * shot.dy;
      for (const cell of active) {
        const along = (cell.x + 6 - position.x) * shot.dx + (cell.y + 6 - position.y) * shot.dy;
        const cross = (cell.x + 6 - position.x) * shot.dy - (cell.y + 6 - position.y) * shot.dx;
        if (shot.weapon !== 'discovery-laser' && cross === 0 && along > 0 && along < distance) assert.ok(destroyed.get(cell.date) < shot.fire, 'An ordinary shot must not pass through a surviving block.');
      }
    }
  }
});

test('[WEAPON-01] Enterprise alternates 3, 4, then 5 red torpedoes with exactly two phasers between bursts', () => {
  const shots = snapshotPlan.fleetFlights.filter((ship) => ship.id === 'cruiser').flatMap((ship) => [...ship.shots, ...(ship.combatShots ?? [])]).sort((a, b) => a.fire - b.fire);
  const runs = [];
  for (const shot of shots) {
    if (runs.at(-1)?.weapon === shot.weapon) runs.at(-1).count++;
    else runs.push({ weapon: shot.weapon, count: 1 });
  }
  assert.ok(runs.length > 6);
  for (const [i, run] of runs.slice(0, -1).entries()) {
    assert.equal(run.weapon, i % 2 ? 'phaser' : 'torpedo');
    assert.equal(run.count, i % 2 ? 2 : 3 + (i / 2) % 3);
  }
  const svg = renderPlan(snapshot, snapshotPlan);
  assert.match(svg, /data-weapon="phaser"/);
  assert.match(svg, /data-weapon="torpedo"/);
  assert.match(svg, /stroke="#ff4b55"/);
  assert.match(svg, /fill="#ff4b55"/);
});

test('[DISCOVERY-01] Discovery pauses at a barrier, retraces cleared cells left, and retries at one-third speed', () => {
  const cells = [0, 1, 2, 3].map((column) => ({ date: `cell-${column}`, x: 44 + column * 16, y: 180, level: column === 2 ? 4 : 0 }));
  const flight = planDiscovery(cells, new Map([['cell-2', 8]]), [cells], findLeastResistanceRoute);
  assert.ok(flight.retries.length > 0);
  assert.equal(flight.shots.length, 4);
  assert.ok(flight.shots.every((shot) => shot.weapon === 'discovery-laser'));
  for (const retry of flight.retries) {
    assert.ok(retry.retreatAt - retry.pausedAt >= 0.59);
    assert.equal(positionAt(flight, retry.returnedAt).x, 30);
    assert.ok(retry.retryAt > retry.returnedAt);
  }
  assert.ok(flight.positions.some((p, i) => i && p.x < flight.positions[i - 1].x));
  for (const [i, p] of flight.positions.entries()) if (i) {
    const previous = flight.positions[i - 1];
    const distance = Math.hypot(p.x - previous.x, p.y - previous.y);
    if (distance) assert.ok(Math.abs(distance / (p.time - previous.time) - FLIGHT_SPEED / 3) < 1e-8);
    if (p.x === cells[2].x + 6) assert.ok(previous.time >= flight.shots.at(-1).hit + 0.22);
  }
});

test('[DISCOVERY-02] Discovery chooses unused clear fields when a separate crossing exists', () => {
  const cells = [0, 1, 2, 3].flatMap((column) => [0, 1, 2].map((row) => ({ date: `${column}-${row}`, x: 44 + column * 16, y: 164 + row * 16, level: 0 })));
  const armedRoutes = [cells.filter((cell) => cell.y !== 180)];
  const flight = planDiscovery(cells, new Map(), armedRoutes, findLeastResistanceRoute);
  assert.equal(flight.retries.length, 0);
  assert.ok(flight.route.every((position) => position.y === 186));
});

test('[CLEARANCE-01] continuous hull clearance catches crossings between keyframes and includes stationary ships', () => {
  const ship = (id, from, to) => ({ id, startAt: 0, exitAt: 1, positions: [{ ...from, time: 0 }, { ...to, time: 1 }] });
  const scout = ship('scout', { x: 0, y: 0 }, { x: 100, y: 0 });
  const cruiser = ship('cruiser', { x: 50, y: -50 }, { x: 50, y: 50 });
  assert.equal(flightsOverlap(scout, cruiser), true);
  const waiting = ship('discovery', { x: 50, y: 10 }, { x: 50, y: 10 });
  assert.equal(flightsOverlap(scout, waiting), true, 'Centres differ, but parts of the hulls would overlap.');
  waiting.positions.forEach((p) => { p.y = HULL_RADII.scout + HULL_RADII.discovery + 3; });
  assert.equal(flightsOverlap(scout, waiting), false);
});

test('[CLEARANCE-02] every scheduled pair keeps complete hulls apart through flight, holds, turns, retreats and fade-out', () => {
  for (const days of [snapshot.days, snapshot.days.map((day) => ({ ...day, level: 4, count: 40 })), snapshot.days.map((day) => ({ ...day, level: 0, count: 0 }))]) {
    const plan = days === snapshot.days ? snapshotPlan : planAnimation(days);
    const { ships, fleetFlights } = plan;
    assert.equal(validatePlan(plan).flights, fleetFlights.length, 'The production output gate accepts every scheduled crossing.');
    assert.equal(ships[1].speed, ENTERPRISE_SPEED, 'Enterprise keeps the reduced lead-ship speed.');
    assert.equal(ships[0].speed, STARFLIGHT_SPEED, 'Starflight keeps the reduced lead-ship speed.');
    assert.equal(ships[3].speed, FLIGHT_SPEED / 3, 'Discovery keeps its original one-third baseline speed.');
    assert.equal(ships[2].speed, ships[3].speed * 2);
    assert.equal(ships[2].speed, ships[1].speed, 'Bird remains at the original two-thirds baseline speed.');
    assert.equal(ships[0].startAt, ships[1].startAt);
    assert.equal(ships[2].startAt, ships[3].startAt);
    for (let i = 0; i < fleetFlights.length; i++) for (let j = i + 1; j < fleetFlights.length; j++) {
      assert.equal(flightsOverlap(fleetFlights[i], fleetFlights[j]), false, `${fleetFlights[i].id} and ${fleetFlights[j].id} have intersecting hull envelopes.`);
      assert.equal(firstFollowingAt(fleetFlights[i], fleetFlights[j]), null, `${fleetFlights[i].id} must not trail ${fleetFlights[j].id} in the same lane.`);
    }
  }
});

test('[DISCOVERY-03] Discovery emergency beam lasts two playback seconds and damages two blocks twice each', () => {
  const cells = [0, 1, 2, 3, 4].map((column) => ({ date: `cell-${column}`, x: 44 + column * 16, y: 180, level: column === 2 || column === 3 ? 4 : 0 }));
  const flight = planDiscovery(cells, new Map(), [], findLeastResistanceRoute);
  assert.equal(flight.beams.length, 2);
  for (const beam of flight.beams) assert.equal((beam.end - beam.fire) / 0.5, 2);
  const first = flight.shots.filter((shot) => shot.beamId === 0);
  assert.equal(first.length, 4);
  assert.deepEqual([...new Set(first.map((shot) => shot.date))], ['cell-2', 'cell-3']);
  assert.ok(first.every((shot) => shot.dx === 1 && shot.dy === 0));
  for (const group of Map.groupBy(first, (shot) => shot.date).values()) {
    assert.deepEqual(group.map((shot) => [shot.before, shot.after]), [[4, 3], [3, 2]]);
  }
  assert.ok(flight.retries.length > 0);
});

test('[DAMAGE-03] shared emergency damage cancels redundant later hits without destroying a block twice', () => {
  const cells = [{ date: 'a', level: 3 }];
  const scout = { id: 'scout', shots: [2, 3, 4].map((hit) => ({ date: 'a', hit, shipId: 'scout' })) };
  const discovery = { id: 'discovery', shots: [1, 1.5].map((hit) => ({ date: 'a', hit, shipId: 'discovery' })) };
  reconcileDamage(cells, [scout, discovery]);
  assert.equal(scout.shots.length, 1);
  assert.equal(discovery.shots.length, 2);
  assert.deepEqual([...discovery.shots, ...scout.shots].map((shot) => shot.after), [2, 1, 0]);
});

test('[ENCOUNTER-01] Klingon and Enterprise exchange harmless fire, flash shields, then diverge', () => {
  const plan = snapshotPlan;
  const enterprise = plan.ships[1];
  const bird = plan.ships[2];
  const encounter = bird.events.find((event) => event.reason === 'encounter');
  const first = bird.combatShots.find((shot) => Math.abs(shot.fire - encounter.start - 0.2) < 1e-8);
  const reply = enterprise.combatShots.find((shot) => Math.abs(shot.fire - encounter.start - 0.8) < 1e-8);
  assert.equal(first.targetShipId, 'cruiser');
  assert.equal(reply.targetShipId, 'bird');
  assert.ok(first.hit < reply.fire);
  assert.ok(enterprise.shields.some((shield) => shield.hit === first.hit));
  assert.ok(bird.shields.some((shield) => shield.hit === reply.hit));
  assert.ok([first, reply].every((shot) => !('date' in shot) && !('after' in shot)));
  const resume = first.fire - 0.2 + 1.6;
  const a = positionAt(enterprise, resume);
  const b = positionAt(bird, resume);
  const nextA = positionAt(enterprise, resume + 0.08);
  const nextB = positionAt(bird, resume + 0.08);
  assert.ok((nextA.x - a.x) * (nextB.x - b.x) + (nextA.y - a.y) * (nextB.y - b.y) <= 0.01);
  assert.ok(Math.hypot(nextA.x - nextB.x, nextA.y - nextB.y) > Math.hypot(a.x - b.x, a.y - b.y));
  assert.ok(bird.combatShots.length > 1 && enterprise.combatShots.length > 1,
    'Dense contribution targeting must leave opportunities for additional in-range exchanges.');
});

test('[RESPAWN-01] each ship respawns at its own entrance without duplicate visible crossings', () => {
  const plan = snapshotPlan;
  for (const flights of Map.groupBy(plan.fleetFlights, (flight) => flight.id).values()) {
    assert.ok(flights.length >= 2);
    for (let i = 1; i < flights.length; i++) {
      const gap = flights[i].startAt - flights[i - 1].exitAt;
      if (flights[i].id === 'tardis') assert.ok(gap >= 0.3 - 1e-9, 'The TARDIS may delay appearance when it has no safe path to reverse along.');
      else assert.ok(Math.abs(gap - 0.3) < 1e-9);
      assert.ok(flights[i].startAt > flights[i - 1].exitAt + 0.25, 'The previous appearance must finish fading before re-entry.');
      const entrances = flights[i].id === 'scout' ? [920, 940] : flights[i].id === 'cruiser' ? [0, -20] : [20, 0];
      assert.ok(entrances.includes(flights[i].positions[0].x));
    }
  }
  const secondScout = plan.fleetFlights.filter((flight) => flight.id === 'scout')[1];
  assert.ok(secondScout.startAt < plan.ships[1].exitAt);
});

test('[LAUNCH-01] Klingon and Discovery appear together one playback second after both lead ships enter the grid', () => {
  const plan = snapshotPlan;
  const firstCenterX = Math.min(...plan.cells.map((cell) => cell.x)) + 6;
  const lastCenterX = Math.max(...plan.cells.map((cell) => cell.x)) + 6;
  const arrivals = plan.ships.slice(0, 2).map((ship) => ship.positions.find((position) => position.x >= firstCenterX && position.x <= lastCenterX).time);
  const expected = Math.max(...arrivals) + 0.5;
  for (const ship of plan.ships.slice(2, 4)) {
    assert.equal(ship.startAt, expected);
    assert.equal(ship.positions[0].x, 20);
  }
});

test('[LAUNCH-02] Enterprise advances right during Starflight arrival instead of waiting at the left bay', () => {
  const [scout, enterprise] = snapshotPlan.ships;
  const firstCenter = Math.min(...snapshotPlan.cells.map((cell) => cell.x)) + 6;
  const rightEdge = Math.max(...snapshotPlan.cells.map((cell) => cell.x)) + 12;
  assert.equal(enterprise.startAt, scout.startAt);
  assert.ok(positionAt(enterprise, 2 * PLAYBACK_SPEED).x >= firstCenter,
    'The clear entrance is reached within two playback seconds, without a whole-flight traffic delay.');
  const early = positionAt(enterprise, 4 * PLAYBACK_SPEED);
  const later = positionAt(enterprise, 6 * PLAYBACK_SPEED);
  assert.ok(later.x > early.x, 'Enterprise keeps advancing while Starflight enters from the other side.');
  assert.ok(enterprise.positions.every((pose, i) => !i || pose.x >= enterprise.positions[i - 1].x));
  assert.ok(enterprise.positions.at(-1).x > rightEdge);
  assert.equal(flightsOverlap(enterprise, scout), false);
});

test('[CLEARANCE-03] pose lookup clamps endpoints and preserves equal-time turn boundaries', () => {
  const ship = { positions: [
    { x: 0, y: 0, angle: 90, time: 0 },
    { x: 10, y: 0, angle: 90, time: 1 },
    { x: 10, y: 0, angle: 180, time: 1 },
    { x: 10, y: 10, angle: 180, time: 2 },
  ] };
  assert.equal(positionAt(ship, -1), ship.positions[0]);
  assert.deepEqual(positionAt(ship, 1), { x: 10, y: 0, angle: 90 });
  assert.deepEqual(positionAt(ship, 1.5), { x: 10, y: 5, angle: 180 });
  assert.equal(positionAt(ship, 3), ship.positions[3]);
});

test('[DISCOVERY-04] seven/five/three-block bursts pause between runs and exhaust follows movement only', () => {
  const motion = createDiscoveryMotion({ x: 0, y: 0 }, 0);
  motion.move({ x: 31 * 16, y: 0 });
  assert.deepEqual(motion.bursts.map((burst) => burst.blocks), [7, 5, 3, 7, 5, 3, 7]);
  assert.deepEqual(motion.bursts.map((burst) => burst.distance / 16), [7, 5, 3, 7, 5, 3, 1]);
  for (let i = 1; i < motion.bursts.length; i++) {
    assert.ok(Math.abs(motion.bursts[i].startAt - motion.bursts[i - 1].endAt - 0.3) < 1e-8);
  }
  for (const ship of snapshotPlan.fleetFlights.filter((flight) => flight.id === 'discovery')) {
    for (const [i, burst] of ship.bursts.entries()) {
      assert.equal(burst.blocks, [7, 5, 3][i % 3]);
      if (i < ship.bursts.length - 1) assert.ok(Math.abs(burst.distance - burst.blocks * 16) < 1e-8);
      if (i) assert.ok(burst.startAt - ship.bursts[i - 1].endAt >= 0.3 - 1e-8);
    }
    for (const burn of ship.burns) {
      const a = positionAt(ship, burn.start);
      const b = positionAt(ship, burn.end);
      assert.ok(Math.abs(Math.hypot(b.x - a.x, b.y - a.y) / (burn.end - burn.start) - ship.speed) < 1e-6);
    }
    for (let i = 1; i < ship.positions.length; i++) {
      const a = ship.positions[i - 1];
      const b = ship.positions[i];
      if (b.time === a.time) continue;
      const moving = Math.hypot(b.x - a.x, b.y - a.y) > 1e-8;
      const time = (a.time + b.time) / 2;
      assert.equal(ship.burns.some((burn) => time > burn.start && time < burn.end), moving);
    }
  }
  const svg = renderPlan(snapshot, snapshotPlan);
  assert.match(svg, /data-effect="discovery-afterburner"/);
  assert.match(svg, /fill="#ff8a26"/);
});

test('[CLEARANCE-04] Discovery exhaust reserves extra space only while its burst is moving', () => {
  const discovery = { id: 'discovery', startAt: 0, exitAt: 1, positions: [{ x: 0, y: 0, angle: 0, time: 0 }] };
  const scout = { id: 'scout', startAt: 0, exitAt: 1, positions: [{ x: 0, y: 30, angle: 0, time: 0 }] };
  assert.equal(flightsOverlap(discovery, scout), false);
  assert.equal(flightsOverlap({ ...discovery, burns: [{ start: 0.2, end: 0.4 }] }, scout), true);
});

test('[CLEARANCE-05] no type travels close behind another type in the same lane', () => {
  const flight = (id, x, y, travel) => ({ id, startAt: 0, exitAt: 1,
    positions: [{ x, y, angle: 90, time: 0 }, { x: x + travel, y, angle: 90, time: 1 }] });
  const scout = flight('scout', 0, 0, 100);
  const discovery = flight('discovery', 80, 0, 30);
  assert.equal(firstFollowingAt(scout, discovery), 0);
  assert.equal(firstFollowingAt(scout, flight('discovery', 80, 16, 30)), null);
  assert.equal(firstFollowingAt(flight('scout', 0, 0, 0), discovery), null);
  assert.equal(firstFollowingAt(flight('bird', 0, 0, 100), flight('cruiser', 80, 0, 30)), 0);
  const tardis = flight('tardis', 0, 0, 100);
  tardis.positions.forEach((position) => { position.angle = 0; });
  assert.equal(firstFollowingAt(tardis, discovery), 0, 'The upright TARDIS uses its travel direction.');
  tardis.positions[1].y = 8;
  assert.equal(firstFollowingAt(tardis, discovery), firstFollowingAt(discovery, tardis), 'Curved-path checks must be independent of pair ordering.');
});

test('[CLEARANCE-06] a weaving TARDIS cannot trail inside another ship\'s wake', () => {
  const flight = (id, from, to) => ({ id, startAt: 0, exitAt: 1,
    positions: [{ ...from, angle: 0, time: 0 }, { ...to, angle: 0, time: 1 }] });
  const enterprise = flight('cruiser', { x: 50, y: 0 }, { x: 100, y: 0 });
  const weaving = flight('tardis', { x: 0, y: 10 }, { x: 60, y: 30 });
  assert.equal(firstFollowingAt(weaving, enterprise), 0, 'A diagonal wave is still trailing when it starts in the ship\'s wake.');
  assert.equal(firstFollowingAt(enterprise, weaving), 0);
  assert.equal(firstFollowingAt(flight('tardis', { x: 0, y: 32 }, { x: 60, y: 40 }), enterprise), null);
  assert.equal(firstFollowingAt(flight('tardis', { x: 70, y: -40 }, { x: 70, y: 40 }), enterprise), null, 'Perpendicular crossings are handled by hull clearance.');
  assert.equal(firstFollowingAt(flight('tardis', { x: 0, y: 10 }, { x: -60, y: 30 }), enterprise), null, 'Reversing away from a ship is not trailing.');
});
