import test from 'node:test';
import assert from 'node:assert/strict';
import { firstOverlapAt } from '../src/starship/motion.mjs';
import { SHIELD } from '../src/starship/config.mjs';

test('[CLEARANCE-07] a shield outside a close pass cannot change that pass\'s rotation clearance', () => {
  // Minimized from run #34: Discovery passes Enterprise during a tight turn,
  // well before Enterprise's next shield flash. The physical hulls remain apart.
  const discovery = { id: 'discovery', startAt: 2, exitAt: 2.07456989247313,
    burns: [{ start: 2, end: 2.07456989247313 }], positions: [
      { x: 658, y: 189.85277777778, angle: 0, time: 2 },
      { x: 658, y: 186, angle: 0, time: 2.07456989247313 },
    ] };
  const cruiser = { id: 'cruiser', startAt: 0, exitAt: 4, positions: [
    { x: 642, y: 170, angle: 90, time: 0 },
    { x: 642, y: 170, angle: 90, time: 2 },
    { x: 642, y: 170, angle: 0, time: 2.075 },
    { x: 642, y: 0, angle: 0, time: 3 },
    { x: 642, y: 0, angle: 0, time: 4 },
  ] };
  assert.equal(firstOverlapAt(discovery, cruiser), null);
  for (const hit of [0.5, 3.5]) {
    const shielded = { ...cruiser, shields: [{ hit }] };
    assert.equal(firstOverlapAt(discovery, shielded), null);
    assert.equal(firstOverlapAt(shielded, discovery), null, 'Pair ordering must not change clearance.');
  }
});

test('[CLEARANCE-08] active shields and exhaust still obstruct an otherwise clear pass', () => {
  const stationary = (id, x, y) => ({ id, startAt: 0, exitAt: 3,
    positions: [{ x, y, angle: 0, time: 0 }, { x, y, angle: 0, time: 3 }] });
  for (const [ship, other, effect, end] of [
    [stationary('cruiser', 0, 0), stationary('scout', 20, 0), { shields: [{ hit: 1 }] }, 1 + SHIELD.duration],
    [stationary('discovery', 0, 0), stationary('scout', 0, 30), { burns: [{ start: 1, end: 2 }] }, 2],
  ]) {
    assert.equal(firstOverlapAt(ship, other), null);
    const active = { ...ship, ...effect };
    const hit = firstOverlapAt(active, other);
    assert.ok(hit >= 1 && hit <= end, 'The active effect must still reserve its full envelope.');
    assert.equal(firstOverlapAt(other, active), hit);
  }
});
