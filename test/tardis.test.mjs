import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { planAnimation } from '../src/starship/fleet.mjs';
import { createTardisPlanner, pathClearAt, reverseTardisAt, TARDIS, waveHeight } from '../src/starship/tardis.mjs';
import { positionAt } from '../src/starship/motion.mjs';
import { HULL_BOUNDS, HULL_RADII, TARDIS_SCALE } from '../src/starship/config.mjs';
import { tardisProjection } from '../src/starship/artwork.mjs';
import { renderPlan } from '../src/starship/render.mjs';

const snapshot = JSON.parse(await readFile(new URL('../data/contributions.json', import.meta.url), 'utf8'));
const plan = planAnimation(snapshot.days);
const tardis = plan.ships.find((ship) => ship.id === 'tardis');

test('[TARDIS-01] three turns accompany each glide, including reversing legs', () => {
  assert.equal(tardis.shots.length, 0);
  assert.ok(tardis.cycles.length > 3);
  for (const [index, cycle] of tardis.cycles.entries()) {
    const start = positionAt(tardis, cycle.spinStart);
    const end = positionAt(tardis, cycle.spinEnd);
    assert.equal(cycle.turns, 3);
    assert.equal(start.angle, 0);
    assert.equal(end.angle, 0);
    assert.equal(cycle.spinStart, cycle.glideStart);
    assert.equal(cycle.spinEnd, cycle.glideEnd);
    assert.ok(cycle.spinEnd > cycle.spinStart);
    assert.ok(cycle.distance <= TARDIS.glideDistance + 1e-8);
    assert.ok(cycle.distance > 0);
    if (index) assert.ok(cycle.spinStart >= tardis.cycles[index - 1].glideEnd);
    const motion = tardis.positions.filter((p) => p.time >= cycle.glideStart && p.time <= cycle.glideEnd);
    let distance = 0;
    for (let i = 1; i < motion.length; i++) {
      distance += Math.hypot(motion[i].x - motion[i - 1].x, motion[i].y - motion[i - 1].y);
      assert.equal(motion[i].angle, motion[0].angle);
    }
    assert.ok(Math.abs(distance - cycle.distance) < 1e-6);
  }
  for (let i = 1; i < tardis.cycles.length; i++) {
    const previous = tardis.cycles[i - 1];
    const current = tardis.cycles[i];
    if (current.spinStart > previous.spinEnd + 1e-8) {
      assert.equal(positionAt(tardis, previous.spinEnd).angle, positionAt(tardis, current.spinStart).angle);
    }
  }
});

test('[TARDIS-02] appearance follows Discovery and wave crossings can reverse and retry', () => {
  const firstX = Math.min(...plan.cells.map((cell) => cell.x)) + 6;
  const arrival = plan.ships[3].positions.find((p) => p.x >= firstX).time;
  assert.ok(tardis.startAt > arrival);
  assert.equal(tardis.positions[0].x, 20);
  assert.ok(plan.fleetFlights.some((flight) => flight.id === 'tardis'
    && flight.positions.at(-1).x > Math.max(...plan.cells.map((cell) => cell.x)) + 12
    && flight.exitAt + 0.25 < plan.reset), 'A successful retry remains visible through its exit fade.');
  const changes = tardis.positions.slice(1).map((p, i) => p.y - tardis.positions[i].y);
  assert.ok(changes.some((dy) => dy > 0.01) && changes.some((dy) => dy < -0.01));
  assert.ok(Math.max(...tardis.route.map((p) => p.y)) - Math.min(...tardis.route.map((p) => p.y)) > 32);
  const top = Math.min(...plan.cells.map((cell) => cell.y + 6));
  const bottom = Math.max(...plan.cells.map((cell) => cell.y + 6));
  assert.ok(tardis.route.every((p) => p.y >= top && p.y <= bottom), 'Obstacle detours stay within the calendar rows.');
  for (const flight of plan.fleetFlights.filter((ship) => ship.id === 'tardis')) assertContinuousMovement(flight);
});

test('[TARDIS-03] the complete rotating and gliding hull avoids surviving contribution blocks', () => {
  const clearTimes = new Map(plan.fleetFlights.flatMap((ship) => ship.shots).filter((shot) => shot.after === 0).map((shot) => [shot.date, shot.hit + 0.26]));
  for (const flight of plan.fleetFlights.filter((ship) => ship.id === 'tardis')) {
    for (let i = 1; i < flight.positions.length; i++) {
      const before = flight.positions[i - 1];
      const after = flight.positions[i];
      assert.ok(pathClearAt([before, after], plan.cells, clearTimes) <= before.time + 1e-8);
    }
  }
  const block = { date: 'solid', x: 44, y: 132, level: 4 };
  // The center misses the square, but the edge of the rotating box would strike it.
  const touchingX = block.x - HULL_BOUNDS.tardis[1];
  assert.equal(pathClearAt([{ x: touchingX + 0.5, y: 138 }], [block], new Map()), Infinity);
  assert.equal(pathClearAt([{ x: touchingX - 0.5, y: 138 }], [block], new Map()), 0);
});

test('[TARDIS-05] vertical-axis turns preserve proportions at Enterprise size and stay inside the hull', () => {
  const [left, right, top, bottom] = HULL_BOUNDS.tardis;
  const enterpriseLength = HULL_BOUNDS.cruiser[3] - HULL_BOUNDS.cruiser[2];
  const visibleLongestSide = 12.5 * TARDIS_SCALE;
  assert.equal(visibleLongestSide, enterpriseLength);
  assert.ok(Math.hypot(right, bottom) < HULL_RADII.tardis);
  for (let degrees = 0; degrees <= 360; degrees++) {
    const projection = tardisProjection(degrees / 360);
    assert.ok(Math.abs(projection.right[0] - projection.left[0]) < 1e-12, 'Left and right side walls must have equal projected widths.');
    for (const [scale, offset] of Object.values(projection)) {
      if (scale < 1e-9) continue;
      assert.ok(scale > 0, 'Visible wall signs must not be mirrored.');
      assert.ok((-3.8 * scale + offset) * TARDIS_SCALE >= left);
      assert.ok((3.8 * scale + offset) * TARDIS_SCALE <= right);
    }
  }
  assert.ok(tardisProjection(0).front[0] > 0.99);
  assert.ok(tardisProjection(0.25).right[0] > 0.5);
  assert.ok(tardisProjection(0.5).back[0] > 0.99);
  assert.ok(tardisProjection(0.75).left[0] > 0.5);
  const svg = renderPlan(snapshot, plan);
  assert.match(svg, /data-spin-axis="vertical"/);
  const matrices = [...svg.matchAll(/transform:matrix\(([^)]+)\)/g)].map((match) => match[1].split(',').map(Number));
  assert.ok(matrices.length > 100);
  assert.ok(matrices.every(([, b, c, d, , f]) => b === 0 && c === 0 && d === 1 && f === 0), 'Yaw must never tilt or squash the vertical axis.');
});

test('[TARDIS-04] the wave guide is repeatable and an open field needs no obstacle detours', () => {
  assert.equal(waveHeight(20) + HULL_BOUNDS.tardis[3], 240);
  assert.equal(waveHeight(116) + HULL_BOUNDS.tardis[2], 132);
  assert.equal(waveHeight(212), waveHeight(20));
  const cells = Array.from({ length: 14 }, (_, col) => Array.from({ length: 7 }, (_, row) => ({
    date: `${col}-${row}`, x: 44 + col * 16, y: 132 + row * 16, level: 0,
  }))).flat();
  const build = createTardisPlanner(cells, new Map(), 1);
  const first = build(1);
  assert.equal(first.detours, 0);
  assert.deepEqual(first, build(1));
  assert.ok(first.route.some((p) => Math.abs((p.y - 138) % 16) > 1), 'Glides follow curves, not only row centers.');
  assert.ok(first.route.every((p) => Math.abs(p.y - waveHeight(p.x)) < 1e-9), 'Clear space preserves the full sine wave between columns.');
  assert.ok(first.positions.every((p, i) => !i || p.time === first.positions[i - 1].time
    || Math.hypot(p.x - first.positions[i - 1].x, p.y - first.positions[i - 1].y) > 1e-8), 'An open wave adds no direction-change or glide-boundary pauses.');
  assert.ok(first.cycles.slice(0, -1).every((cycle) => Math.abs(cycle.distance - 7 * 16) < 1e-8), 'Uninterrupted glides cover seven blocks.');
});

test('[TARDIS-07] occupied ship routes cannot flatten the wave on an open annual grid', () => {
  const cells = Array.from({ length: 53 }, (_, column) => Array.from({ length: 7 }, (_, row) => ({
    date: `${column}-${row}`, x: 44 + column * 16, y: 132 + row * 16, level: 0,
  }))).flat();
  const avoid = new Set(cells.filter((cell) => cell.y !== 180).map((cell) => `${cell.x},${cell.y}`));
  const flight = createTardisPlanner(cells, new Map(), 1, avoid)(1);
  assert.equal(flight.detours, 0, 'Ship routes do not force a straight row through clear space.');
  for (let cycle = 0; cycle < 4; cycle++) {
    for (const [offset, expectedY] of [[0, 240 - HULL_BOUNDS.tardis[3]], [48, 186], [96, 132 - HULL_BOUNDS.tardis[2]], [144, 186]]) {
      const x = 20 + cycle * 192 + offset;
      const nearest = flight.route.reduce((best, point) => Math.abs(point.x - x) < Math.abs(best.x - x) ? point : best);
      assert.ok(Math.abs(nearest.y - expectedY) < 0.3, 'Each visible wave keeps its crests, troughs, and midline crossings.');
    }
  }
});

test('[TARDIS-06] an uncrossable wall immediately reverses the same cleared wave', () => {
  const cells = Array.from({ length: 14 }, (_, column) => Array.from({ length: 7 }, (_, row) => ({
    date: `${column}-${row}`, x: 44 + column * 16, y: 132 + row * 16, level: column === 4 ? 4 : 0,
  }))).flat();
  const flight = createTardisPlanner(cells, new Map(), 1)(1);
  assert.equal(flight.reversals.length, 1);
  assert.equal(flight.reversals[0].blockedDate, '4-6');
  assert.equal(flight.reversals[0].reverseStart, flight.reversals[0].blockedAt);
  assert.equal(flight.positions.at(-1).x, 20);
  assert.ok(flight.positions.some((position, i) => i && position.x < flight.positions[i - 1].x));
  assertContinuousMovement(flight);
  const turn = flight.reversals[0].reverseStart;
  for (let offset = 0; offset < turn - flight.startAt; offset += 0.1) {
    const outward = positionAt(flight, turn - offset);
    const backward = positionAt(flight, turn + offset);
    assert.ok(Math.hypot(outward.x - backward.x, outward.y - backward.y) < 1e-7, 'Reverse motion preserves every detour and sine phase.');
  }
});

/** A visible TARDIS may turn around, but it cannot accumulate stationary wait frames. */
function assertContinuousMovement(flight) {
  for (let i = 1; i < flight.positions.length; i++) {
    const before = flight.positions[i - 1];
    const after = flight.positions[i];
    const elapsed = after.time - before.time;
    assert.ok(elapsed >= 0);
    if (elapsed < 1e-8) continue;
    const distance = Math.hypot(after.x - before.x, after.y - before.y);
    assert.ok(Math.abs(distance / elapsed - TARDIS.speed) < 1e-6, 'Translation keeps its speed through every visible interval.');
  }
}

test('[TARDIS-08] yielding retraces the wave and returns without mutating the reserved flight', () => {
  const cells = Array.from({ length: 14 }, (_, col) => Array.from({ length: 7 }, (_, row) => ({
    date: `${col}-${row}`, x: 44 + col * 16, y: 132 + row * 16, level: 0,
  }))).flat();
  const original = createTardisPlanner(cells, new Map(), 1)(1);
  const before = structuredClone(original);
  const at = original.cycles[1].glideStart;
  const yielded = reverseTardisAt(original, at, 3);
  const reversal = yielded.reversals[0];
  assert.ok(yielded.exitAt - original.exitAt >= 3);
  assert.equal(reversal.blockedAt, reversal.reverseStart);
  const resume = positionAt(yielded, reversal.returnedAt);
  const start = positionAt(original, at);
  assert.ok(Math.hypot(resume.x - start.x, resume.y - start.y) < 1e-8);
  for (let time = at; time <= reversal.turnedAt; time += 0.05) {
    const oldPose = positionAt(original, at - (time - at));
    const reversePose = positionAt(yielded, time);
    assert.ok(Math.hypot(oldPose.x - reversePose.x, oldPose.y - reversePose.y) < 1e-7);
    assert.ok(Math.abs(reversePose.y - waveHeight(reversePose.x)) < 0.001);
  }
  assertContinuousMovement(yielded);
  assert.deepEqual(original, before);
  assert.equal(reverseTardisAt(original, original.startAt, 3), null, 'No cleared prefix means appearance must wait.');
});
