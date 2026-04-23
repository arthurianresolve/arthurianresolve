import test from 'node:test';
import assert from 'node:assert/strict';
import { createMotion, holdFlightAt, NoDepartureError, reserveFlight } from '../src/starship/motion.mjs';
import { createDiagnostics, artifactHash } from '../src/starship/diagnostics.mjs';
import { stageEncounter } from '../src/starship/encounters.mjs';

test('[TRACE-01] a traffic interruption preserves each activity reason and its original duration', () => {
  const motion = createMotion({ x: 0, y: 0 });
  motion.hold(1, 'launch');
  motion.hold(1, 'firing', { date: 'a' });
  const flight = { id: 'bird', startAt: 0, exitAt: 2, positions: motion.positions, events: motion.events, shots: [] };
  const held = holdFlightAt(flight, 1.5, 2, { reason: 'traffic', otherShip: 'cruiser' });
  const invisible = { id: 'tardis', startAt: 2, exitAt: 2, events: [], shots: [] };
  assert.deepEqual(held.events.map(({ reason, start, end }) => [reason, start, end]),
    [['launch', 0, 1], ['firing', 1, 1.5], ['traffic', 1.5, 3.5], ['firing', 3.5, 4]]);
  assert.equal(flight.events.length, 2, 'Rejected reservation candidates must not alter the original trace.');
  const report = createDiagnostics({ username: 'example', fetchedAt: '2026-09-08T00:00:00Z' },
    { reset: 10, duration: 11, fleetFlights: [held, invisible] }, { flights: 2 }, [{ name: 'test.svg', svg: '<svg/>' }]);
  const traffic = report.events.find((event) => event.reason === 'traffic');
  assert.equal(traffic.start, 3); assert.equal(traffic.end, 7);
  assert.equal(traffic.otherShip, 'cruiser');
  assert.ok(report.events.some((event) => event.reason === 'reserved-clearance'));
  assert.ok(report.events.every((event) => event.ship !== 'tardis'), 'An invisible attempt must not be presented as an appearance.');
  assert.equal(report.artifacts['test.svg'], artifactHash('<svg/>'));
});

test('[RECOVERY-01] a bounded reservation rejects a long dock wait and accepts another entrance', () => {
  const blocker = { id: 'cruiser', startAt: 0, exitAt: 8, positions: [{ x: 0, y: 0, angle: 90, time: 0 }] };
  const build = (y) => (startAt) => ({ id: 'bird', startAt, exitAt: startAt + 1, shots: [], events: [],
    positions: [{ x: 0, y, angle: 90, time: startAt }, { x: 100, y, angle: 90, time: startAt + 1 }] });
  assert.throws(() => reserveFlight(build(0), [blocker], 0, undefined, true, undefined, { maxWaitSeconds: 1 }), NoDepartureError);
  const recovered = reserveFlight(build(80), [blocker], 0, 0, true, undefined, { maxWaitSeconds: 1 });
  assert.equal(recovered.startAt, 0); assert.equal(recovered.exitAt, 1);
});

test('[RECOVERY-02] optional combat is skipped when it exceeds the configured delay budget', () => {
  const cruiser = { id: 'cruiser' }, bird = { id: 'bird' };
  assert.deepEqual(stageEncounter(cruiser, bird, [], { maxDelaySeconds: 1 }), [cruiser, bird]);
});
