// Route policy checks use small grids with known choices and the retained fleet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { findHighDensityRoute, findLeastResistanceRoute, findRandomDensityRoute } from '../src/starship/routes.mjs';
import { planAnimation } from '../src/starship/fleet.mjs';

const snapshot = JSON.parse(await readFile(new URL('../data/contributions.json', import.meta.url), 'utf8'));

test('[ROUTE-07] column policies can choose their own entrance without a reserved route', () => {
  const cells = [0, 1, 2].flatMap((column) => [0, 1, 2].map((row) => ({
    x: column * 16, y: row * 16, level: 0, count: 0,
  })));
  for (const result of [findRandomDensityRoute(cells), findHighDensityRoute(cells, [])]) {
    assert.deepEqual(result.route.map((cell) => [cell.x, cell.y]), [[0, 16], [16, 16], [32, 16]]);
  }
});

test('[ROUTE-01] routing chooses lower total resistance over a shorter but harder crossing', () => {
  const levels = [[4, 4, 4, 4, 4], [1, 1, 4, 1, 1], [4, 1, 1, 1, 4]];
  const cells = levels.flatMap((row, y) => row.map((level, x) => ({ x: x * 16, y: y * 16, level })));
  const result = findLeastResistanceRoute(cells);
  assert.equal(result.resistance, 7);
  assert.equal(result.route.length, 7);
  assert.ok(result.route.every((cell) => cell.level === 1));
  assert.equal(result.route[0].x, 0);
  assert.equal(result.route.at(-1).x, 64);
});

test('[ROUTE-02] an open route costs no hits and equal-resistance routes prefer fewer moves', () => {
  const cells = [0, 1, 2].flatMap((row) => [0, 1, 2, 3].map((column) => ({ x: column * 16, y: row * 16, level: row === 1 ? 0 : 4 })));
  const result = findLeastResistanceRoute(cells);
  assert.equal(result.resistance, 0);
  assert.equal(result.route.length, 4);
  assert.ok(result.route.every((cell) => cell.y === 16));
  assert.throws(() => findLeastResistanceRoute([{ x: 0, y: 0, level: 1 }, { x: 32, y: 0, level: 1 }]), /No forward route/);
});

test('[ROUTE-03] the cruiser selects the densest available targets and starts away from the scout', () => {
  const levels = [[0, 4, 2, 1], [1, 1, 1, 1], [0, 2, 4, 4]];
  const cells = levels.flatMap((row, y) => row.map((level, x) => ({ x: x * 16, y: y * 16, level, count: level * 20 })));
  const scout = cells.filter((cell) => cell.y === 16);
  const cruiser = findHighDensityRoute(cells, scout);
  assert.deepEqual(cruiser.targets.map((cell) => cell.level), [0, 4, 4, 4]);
  assert.notEqual(cruiser.route[0].y, scout[0].y);
  assert.ok(cruiser.targets.every((cell) => cell.y !== 16));
  for (const [i, cell] of cruiser.route.entries()) if (i) {
    const before = cruiser.route[i - 1];
    assert.ok(cell.x >= before.x);
    assert.equal(Math.abs(cell.x - before.x) + Math.abs(cell.y - before.y), 16);
  }
});

test('[ROUTE-04] Bird of Prey chooses varied densities reproducibly and always advances toward the right', () => {
  const cells = [0, 1, 2, 3, 4, 5, 6, 7].flatMap((column) => [1, 2, 3, 4].map((level, row) => ({ date: `${column}-${row}`, x: column * 16, y: row * 16, level, count: level * 10 })));
  const first = findRandomDensityRoute(cells, 16, 42);
  assert.deepEqual(first, findRandomDensityRoute(cells, 16, 42));
  assert.notDeepEqual(first.targets, findRandomDensityRoute(cells, 16, 43).targets);
  assert.ok(new Set(first.targets.map((cell) => cell.level)).size > 1);
  assert.equal(first.route.at(-1).x, 112);
  assert.ok(first.route.every((cell, i) => !i || cell.x >= first.route[i - 1].x));
  const bird = planAnimation(snapshot.days).ships[2];
  assert.ok([...bird.shots, ...bird.combatShots].every((shot) => shot.weapon === 'green-torpedo'));
});

test('[ROUTE-05] Starflight chooses its own lane even when Discovery has cleared an easier path', () => {
  const cells = [0, 1, 2].flatMap((row) => [0, 1, 2, 3].map((column) => ({ x: column * 16, y: row * 16, level: row === 1 ? 0 : 1 })));
  const avoid = new Set(cells.filter((cell) => cell.y === 16).map((cell) => `${cell.x},${cell.y}`));
  const independent = findLeastResistanceRoute(cells, 32, { avoid });
  assert.ok(independent.route.every((cell) => cell.y === 32));
  assert.equal(independent.resistance, 4);
  assert.ok(independent.route.every((cell) => cells.includes(cell)), 'Route weights must not replace actual density.');
});

test('[ROUTE-06] a right-side entrance selects a least-resistance route toward the left', () => {
  const levels = [[4, 4, 4, 4, 4], [1, 1, 4, 1, 1], [4, 1, 1, 1, 4]];
  const cells = levels.flatMap((row, y) => row.map((level, x) => ({ x: x * 16, y: y * 16, level })));
  const before = structuredClone(cells);
  const result = findLeastResistanceRoute(cells, 16, { direction: -1 });
  assert.equal(result.resistance, 7);
  assert.equal(result.route[0].x, 64);
  assert.equal(result.route.at(-1).x, 0);
  assert.ok(result.route.every((cell) => cells.includes(cell) && cell.level === 1));
  assert.ok(result.route.every((cell, i) => !i || cell.x <= result.route[i - 1].x));
  assert.deepEqual(cells, before, 'Calendar dates and positions keep their original ordering.');
});
