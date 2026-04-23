import test from 'node:test';
import assert from 'node:assert/strict';
import { createDamageTimeline } from '../src/starship/damage.mjs';
import { planFlight } from '../src/starship/flights.mjs';
import { DAMAGE } from '../src/starship/config.mjs';

const row = (levels) => levels.map((level, i) => ({ date: `cell-${i}`, level,
  count: level * 10, x: 44 + i * 16, y: 180 }));
const fly = (cells, sharedShots) => planFlight(cells, cells, {
  id: 'bird', muzzle: 11.2, spawnX: 20, speed: 100, launchHold: 0, sharedShots,
});

test('[DAMAGE-04] clearance uses cumulative hits, not a later ship\'s provisional final shot', () => {
  const cells = row([4]);
  const incoming = [10, 12, 100, 110].map((hit) => ({ date: 'cell-0', hit }));
  const original = structuredClone(incoming);
  const damage = createDamageTimeline(cells, incoming);
  assert.equal(damage.remainingAt(cells[0], 11), 3);
  damage.record({ date: 'cell-0', hit: 11 });
  damage.record({ date: 'cell-0', hit: 11 });
  assert.equal(damage.remainingAt(cells[0], 11), 1);
  assert.equal(damage.clearedAt(cells[0]), 12 + DAMAGE.clearanceDelay);
  assert.equal(damage.clearances().get('cell-0'), 12 + DAMAGE.clearanceDelay);
  assert.deepEqual(incoming, original, 'Planning must not mutate another ship\'s hits.');
});

test('[FLIGHT-02] a distant future clearance cannot park the Bird of Prey before empty cells', () => {
  const cells = row([0, 0, 0, 4, 0]);
  const incoming = [100, 101, 102, 103].map((hit) => ({ date: 'cell-3', hit }));
  const flight = fly(cells, incoming);
  assert.ok(flight.exitAt < 5, 'Clear the obstruction instead of waiting for the distant volley.');
  assert.equal(flight.shots.length, 4);
  const firstFire = flight.shots[0];
  assert.equal(firstFire.from.x - firstFire.dx * flight.muzzle, cells[2].x + 6,
    'Use the two clear cells before stopping at the obstruction.');
  assert.ok(flight.shots.every((shot) => shot.weapon === 'green-torpedo'));
});

test('[FLIGHT-03] shared partial hits leave only the remaining density to shoot', () => {
  const cells = row([4]);
  const flight = fly(cells, [0, 0].map((hit) => ({ date: 'cell-0', hit })));
  assert.deepEqual(flight.shots.map(({ before, after }) => [before, after]), [[2, 1], [1, 0]]);
  assert.equal(cells[0].level, 4);
});

test('[FLIGHT-04] a destroyed block remains occupied until the shared explosion clears', () => {
  const cells = row([1]);
  for (const hit of [0, 0.04]) {
    const flight = fly(cells, [{ date: 'cell-0', hit }]);
    assert.equal(flight.shots.length, 0);
    const entry = flight.positions.findIndex((pose) => pose.x === cells[0].x + 6);
    assert.ok(flight.positions[entry - 1].time >= hit + DAMAGE.clearanceDelay,
      'Do not move into a zero-health cell while its explosion is still visible.');
    assert.ok(flight.positions.every((pose, i, poses) => Number.isFinite(pose.time)
      && (!i || pose.time >= poses[i - 1].time)));
  }
});
