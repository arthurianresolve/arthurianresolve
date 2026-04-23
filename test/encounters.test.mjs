import test from 'node:test';
import assert from 'node:assert/strict';
import { stageFlybyEncounters } from '../src/starship/encounters.mjs';
import { firstOverlapAt, positionAt } from '../src/starship/motion.mjs';

const flight = (id, y, startAt = 0, distance = 0) => ({ id, muzzle: 10, startAt, exitAt: startAt + 8,
  shots: [], events: [], positions: [{ x: 200, y, angle: 90, time: startAt },
    { x: 200 + distance, y, angle: 90, time: startAt + 8 }] });

test('[ENCOUNTER-02] nearby parallel and waiting ships trade fire without altering their routes or damage', () => {
  for (const distance of [0, 200]) {
    const pair = [flight('cruiser', 150, 0, distance), flight('bird', 230, 0, distance)];
    const before = structuredClone(pair);
    stageFlybyEncounters(pair, 8);
    for (const [index, ship] of pair.entries()) {
      assert.ok(ship.combatShots.length >= 2, 'A long in-range crossing can exchange again after recovery.');
      assert.deepEqual(ship.positions, before[index].positions);
      assert.deepEqual(ship.shots, before[index].shots);
      assert.equal(ship.exitAt, before[index].exitAt);
      const target = pair[1 - index];
      for (const shot of ship.combatShots) {
        const aim = positionAt(target, shot.hit);
        assert.equal(shot.x + 6, aim.x); assert.equal(shot.y + 6, aim.y);
        assert.ok(target.shields.some((shield) => shield.hit === shot.hit));
        assert.ok(!('date' in shot) && !('after' in shot));
      }
    }
    assert.ok(pair[1].combatShots.every((shot) => shot.weapon === 'green-torpedo'));
    assert.ok(pair[1].combatShots[0].hit < pair[0].combatShots[0].fire);
    assert.equal(firstOverlapAt(...pair), null);
  }
});

test('[ENCOUNTER-03] every crossing can retaliate while previous effects remain paired and spaced apart', () => {
  const flights = [flight('cruiser', 150), flight('bird', 230), flight('cruiser', 150, 9), flight('bird', 230, 9)];
  stageFlybyEncounters(flights, 17);
  assert.ok(flights.every((ship) => ship.combatShots.length >= 2));
  const before = structuredClone(flights);
  stageFlybyEncounters(flights, 17);
  assert.deepEqual(flights, before, 'Revisiting a reserved exchange must not overwrite or duplicate it.');
  for (const ship of flights) for (let i = 1; i < ship.combatShots.length; i++) {
    assert.ok(ship.combatShots[i].fire - ship.combatShots[i - 1].hit >= 2);
  }
});

test('[ENCOUNTER-04] shield conflicts, active grid weapons and out-of-range targets still suppress combat', () => {
  const blocked = [flight('cruiser', 150), flight('bird', 230), flight('scout', 170)];
  assert.equal(firstOverlapAt(blocked[0], blocked[2]), null, 'The hull fits; the shield would not.');
  const busy = [flight('cruiser', 150), flight('bird', 230)];
  busy[1].shots = [{ fire: 0, hit: 8 }];
  const distant = [flight('cruiser', 100), flight('bird', 230)];
  const departing = [flight('cruiser', 150, 0, 1000), flight('bird', 230)];
  for (const ships of [blocked, busy, distant, departing]) {
    const before = structuredClone(ships);
    stageFlybyEncounters(ships, 8);
    assert.deepEqual(ships, before, 'Rejected candidates must not change any flight.');
  }
  const late = [flight('cruiser', 150), flight('bird', 230)];
  stageFlybyEncounters(late, 1);
  assert.ok(late.every((ship) => !ship.combatShots), 'Both impacts and shield fades must finish before reset.');
});

test('[ENCOUNTER-05] dense volleys leave short launcher gaps for retaliation without overlapping grid fire', () => {
  const pair = [flight('cruiser', 150), flight('bird', 230)];
  for (const ship of pair) ship.shots = Array.from({ length: 20 }, (_, i) => ({ fire: i * 0.4, hit: i * 0.4 + 0.1 }));
  const before = structuredClone(pair);
  stageFlybyEncounters(pair, 8);
  for (const [index, ship] of pair.entries()) {
    assert.ok(ship.combatShots.length, 'A volley must not suppress the entire in-range encounter.');
    assert.deepEqual(ship.shots, before[index].shots);
    for (const combat of ship.combatShots) assert.ok(ship.shots.every((shot) =>
      shot.fire > combat.hit || shot.hit < combat.fire), 'Grid shots and combat use separate launcher windows.');
  }
});
