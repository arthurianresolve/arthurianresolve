import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { validatePlan, InvalidPlanError } from '../src/starship/validate.mjs';
import { writePlan } from '../scripts/generate-starship.mjs';

/** A small, valid crossing that fires once and waits through the explosion. */
function fixture() {
  const cell = { date: '2026-01-01', x: 44, y: 244, level: 1, count: 1 };
  const ship = { id: 'cruiser', startAt: 0, exitAt: 1, muzzle: 10, events: [],
    positions: [{ x: 20, y: 250, angle: 90, time: 0 }, { x: 20, y: 250, angle: 90, time: 0.6 }, { x: 50, y: 250, angle: 90, time: 1 }],
    shots: [{ ...cell, shipId: 'cruiser', weapon: 'torpedo', fire: 0, hit: 0.2,
      from: { x: 30, y: 250 }, dx: 1, dy: 0, before: 1, after: 0, destroyedAt: 0.26 }] };
  return { cells: [cell], ships: [ship], fleetFlights: [ship], reset: 2, duration: 2.6 };
}

test('[VALIDATE-01] final-plan validation is read-only and accepts a cleared crossing', () => {
  const plan = fixture(), before = structuredClone(plan);
  assert.deepEqual(validatePlan(plan), { cells: 1, flights: 1, shots: 1, checkedPairs: 0 });
  assert.deepEqual(plan, before);
});

test('[VALIDATE-02] corrupt time, damage, positions and effects fail with a specific reason', () => {
  for (const [code, corrupt] of [
    ['PLAN-POSE', (plan) => { plan.ships[0].positions[0].x = NaN; }],
    ['PLAN-ORDER', (plan) => { plan.ships[0].positions.splice(2, 0, { x: 20, y: 250, angle: 90, time: 0.4 }); }],
    ['PLAN-TELEPORT', (plan) => { plan.ships[0].positions[1].time = 0; plan.ships[0].positions[1].x = 30; }],
    ['PLAN-DAMAGE', (plan) => { plan.ships[0].shots[0].before = 2; }],
    ['PLAN-BLOCK', (plan) => { plan.ships[0].shots = []; }],
    ['PLAN-BLOCK', (plan) => {
      const ship = plan.ships[0]; ship.id = 'tardis'; ship.shots = [];
      // Its center misses the cell, but the projected wall still intersects it.
      ship.positions.forEach((pose) => { pose.y = 243; pose.angle = 0; });
    }],
    ['PLAN-MUZZLE', (plan) => { plan.ships[0].shots[0].from.x = 999; }],
    ['PLAN-EFFECT', (plan) => { plan.ships[0].burns = [{ start: 1, end: 0 }]; }],
    ['PLAN-EVENT', (plan) => { plan.ships[0].events = [{ start: 0.5, end: 0.2, reason: 'traffic' }]; }],
  ]) {
    const plan = fixture(); corrupt(plan);
    assert.throws(() => validatePlan(plan), (error) => error instanceof InvalidPlanError && error.code === code, code);
  }
});

test('[VALIDATE-03] separated duplicates, physical collisions and close following are distinct failures', () => {
  for (const [code, id, offset] of [['PLAN-DUPLICATE', 'cruiser', 500], ['PLAN-COLLISION', 'bird', 0], ['PLAN-FOLLOWING', 'bird', 70]]) {
    const plan = fixture(), other = structuredClone(plan.ships[0]);
    other.id = id; other.shots = [];
    other.positions.forEach((pose) => { pose.x += offset; });
    plan.fleetFlights.push(other);
    if (id !== 'cruiser') plan.ships.push(other);
    assert.throws(() => validatePlan(plan), (error) => error.code === code, code);
  }
});

test('[VALIDATE-04] failed plan validation leaves existing generated files untouched', async () => {
  const out = await mkdtemp(join(tmpdir(), 'starship-validation-'));
  try {
    const file = join(out, 'github-contribution-grid-starship-dark.svg');
    await writeFile(file, 'last valid output');
    const plan = fixture(); plan.ships[0].shots = [];
    await assert.rejects(writePlan({}, plan, { out }), (error) => error.code === 'PLAN-BLOCK');
    assert.equal(await readFile(file, 'utf8'), 'last valid output');
  } finally {
    // mkdtemp owns this exact directory; no computed repository paths are removed.
    assert.equal(dirname(resolve(out)), resolve(tmpdir()));
    assert.ok(basename(out).startsWith('starship-validation-'));
    await rm(out, { recursive: true, force: true });
  }
});
