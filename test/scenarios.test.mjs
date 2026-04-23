import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY } from '../src/starship/config.mjs';
import { planAnimation } from '../src/starship/fleet.mjs';
import { validatePlan } from '../src/starship/validate.mjs';

/** Fixed dates and seed reproduce both partial-week geometry and awkward traffic. */
function calendar(start, choose) {
  let seed = 0x1701;
  return Array.from({ length: 366 }, (_, index) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const date = new Date(Date.parse(`${start}T00:00:00Z`) + index * DAY);
    const level = choose(index, date.getUTCDay(), seed);
    return { date: date.toISOString().slice(0, 10), level, count: level * 10 };
  });
}

for (const [name, start, choose] of [
  ['narrow corridor', '2025-09-07', (_, weekday) => weekday === 3 ? 0 : 4],
  ['alternating dense columns', '2025-09-08', (index) => Math.floor(index / 7) % 2 ? 4 : 0],
  ['seeded opposing traffic with partial weeks', '2025-09-11', (_, __, seed) => seed % 5],
]) test(`[SCENARIO] ${name} produces a valid fleet`, () => {
  const plan = planAnimation(calendar(start, choose), { repeat: false });
  assert.equal(validatePlan(plan).flights, 5);
  assert.equal(plan.ships[0].direction, -1);
  assert.ok(plan.ships[1].positions.at(-1).x > plan.ships[1].positions[0].x);
});
