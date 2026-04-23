import { FLIGHT_SPEED, HULL_BOUNDS } from './config.mjs';
import { findLeastResistanceRoute } from './routes.mjs';
import { holdFlightAt, positionAt } from './motion.mjs';

export const TARDIS = { turns: 3, glideDistance: 7 * 16, speed: FLIGHT_SPEED / 3 };
const SAMPLE_STEP = 0.5;
// The crests touch the grid's top and bottom with the full projected hull inside.
const WAVE_TOP = 132 - HULL_BOUNDS.tardis[2];
const WAVE_BOTTOM = 240 - HULL_BOUNDS.tardis[3];
const SPAWN = { x: 20, y: WAVE_BOTTOM };

/** Desired wave in SVG pixels: four gentle up/down cycles across an annual grid. */
export function waveHeight(x) {
  return (WAVE_TOP + WAVE_BOTTOM) / 2
    + (WAVE_BOTTOM - WAVE_TOP) / 2 * Math.cos((x - SPAWN.x) * Math.PI / 96);
}

/** Sample a segment closely enough to conservatively check the whole moving hull. */
function sampleLine(from, to) {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / SAMPLE_STEP));
  return Array.from({ length: steps + 1 }, (_, i) => ({
    x: from.x + (to.x - from.x) * i / steps,
    y: from.y + (to.y - from.y) * i / steps,
  }));
}

/** Follow one continuous sine phase, blending endpoint detours with a smooth offset. */
function sampleWave(from, to) {
  if (from.x === to.x) return sampleLine(from, to);
  const steps = Math.ceil((Math.abs(to.x - from.x) * 2.1 + Math.abs(to.y - from.y)) / SAMPLE_STEP);
  const firstOffset = from.y - waveHeight(from.x);
  const lastOffset = to.y - waveHeight(to.x);
  return Array.from({ length: steps + 1 }, (_, i) => {
    const fraction = i / steps;
    const x = from.x + (to.x - from.x) * fraction;
    const blend = fraction * fraction * (3 - 2 * fraction);
    return { x, y: waveHeight(x) + firstOffset * (1 - blend) + lastOffset * blend };
  });
}

/** Compare partial-route states while preserving route independence first. */
function comparePartial(a, b) {
  return a.avoided - b.avoided || a.resistance - b.resistance || a.steps - b.steps || a.entryBias - b.entryBias;
}

/**
 * Earliest safe time for a sampled glide. Infinity means a permanent obstacle.
 * Sweep the upright hull envelope over each segment. These boxes contain every
 * projected side of the turning police box, including the space between samples.
 */
export function pathClearAt(points, cells, clearTimes) {
  let readyAt = 0;
  const active = cells.filter((cell) => cell.level > 0);
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[i];
    const [left, right, top, bottom] = HULL_BOUNDS.tardis;
    const swept = { left: Math.min(a.x, b.x) + left, right: Math.max(a.x, b.x) + right,
      top: Math.min(a.y, b.y) + top, bottom: Math.max(a.y, b.y) + bottom };
    for (const cell of active) if (swept.left <= cell.x + 12 && swept.right >= cell.x
      && swept.top <= cell.y + 12 && swept.bottom >= cell.y) {
      const cleared = clearTimes.get(cell.date) ?? Infinity;
      if (!Number.isFinite(cleared)) return Infinity;
      readyAt = Math.max(readyAt, cleared);
    }
  }
  return readyAt;
}

/**
 * Find a wave-shaped crossing through cells that are empty or scheduled to clear.
 * Sine segments are preferred; a blocked curve follows the connected cell route
 * around the obstacle. If no complete route exists, return the furthest safe
 * prefix so the caller can reverse at the wall. No new damage or
 * off-calendar activity is invented.
 */
function wavePath(cells, clearTimes, avoid) {
  const available = cells.filter((cell) => cell.level === 0 || clearTimes.has(cell.date));
  const weighted = available.map((cell) => ({
    ...cell, level: 0.02 + ((cell.y + 6 - waveHeight(cell.x + 6)) / 16) ** 2,
  }));
  let route;
  try {
    route = findLeastResistanceRoute(weighted, SPAWN.y - 6, { avoid }).route;
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('No forward route')) throw error;
    // A solid wall can make a complete crossing impossible. Find the furthest
    // reachable clear cell so the planner can stop at the obstacle and reverse
    // instead of throwing away the whole visible TARDIS flight.
    const key = (cell) => `${cell.x},${cell.y}`;
    const byKey = new Map(available.map((cell) => [key(cell), cell]));
    const left = Math.min(...available.map((cell) => cell.x));
    const states = new Map();
    const pending = [];
    for (const cell of available.filter((candidate) => candidate.x === left)) {
      const state = { cell, avoided: Number(avoid.has(key(cell))), resistance: cell.level, steps: 1,
        entryBias: Math.abs(cell.y - (SPAWN.y - 6)), previous: null };
      states.set(key(cell), state);
      pending.push(state);
    }
    while (pending.length) {
      pending.sort(comparePartial);
      const current = pending.shift();
      for (const [dx, dy] of [[16, 0], [0, -16], [0, 16]]) {
        const cell = byKey.get(`${current.cell.x + dx},${current.cell.y + dy}`);
        if (!cell) continue;
        const candidate = { cell, avoided: current.avoided + Number(avoid.has(key(cell))),
          resistance: current.resistance + cell.level, steps: current.steps + 1, entryBias: current.entryBias, previous: current };
        const old = states.get(key(cell));
        if (!old || comparePartial(candidate, old) < 0) { states.set(key(cell), candidate); pending.push(candidate); }
      }
    }
    const reachable = [...states.values()];
    const furthestX = reachable.length ? Math.max(...reachable.map((state) => state.cell.x)) : left;
    const endpoint = reachable.filter((state) => state.cell.x === furthestX).sort(comparePartial)[0];
    const partial = [];
    for (let state = endpoint; state; state = state.previous) partial.unshift(state.cell);
    route = partial;
    const obstacle = cells.filter((cell) => cell.level > 0 && !clearTimes.has(cell.date) && cell.x >= furthestX)
      .sort((a, b) => a.x - b.x || Math.abs(a.y - (endpoint?.cell.y ?? SPAWN.y)) - Math.abs(b.y - (endpoint?.cell.y ?? SPAWN.y)))[0];
    return buildWavePoints(route, cells, clearTimes, { avoid, complete: false, obstacle });
  }
  return buildWavePoints(route, cells, clearTimes, { avoid, complete: true });
}

/**
 * Use the cell route only as an escape corridor around obstacles. Connect the
 * furthest safe waypoints with the continuous sine curve instead of anchoring
 * every column to a row center, which would cancel most of the wave's amplitude.
 * An open board follows the exact guide even when other ships have used its cells.
 */
function buildWavePoints(route, cells, clearTimes, { complete, obstacle = null }) {
  if (!route.length) return { points: [{ ...SPAWN }], detours: 0, complete, obstacle };
  const centers = route.map((cell) => ({ x: cell.x + 6, y: cell.y + 6 }));
  const waypoints = [SPAWN, { x: SPAWN.x, y: centers[0].y }, ...centers];
  if (complete) waypoints.push({ x: centers.at(-1).x + 20, y: centers.at(-1).y });
  const top = Math.min(SPAWN.y, ...cells.map((cell) => cell.y + 6));
  const bottom = Math.max(SPAWN.y, ...cells.map((cell) => cell.y + 6));
  const points = [{ ...SPAWN }];
  let current = 0;
  let detours = 0;
  while (current < waypoints.length - 1) {
    const from = points.at(-1);
    let segment;
    let target;
    // Prefer returning to the guide before extending an offset detour. Keep a
    // clear connection to the cell corridor in case the next curve is blocked.
    for (const rejoinWave of [true, false]) {
      for (let next = waypoints.length - 1; next > current; next--) {
        if (waypoints[next].x <= from.x) continue;
        const destination = rejoinWave
          ? { x: waypoints[next].x, y: waveHeight(waypoints[next].x) }
          : waypoints[next];
        if (next < waypoints.length - 1
          && !Number.isFinite(pathClearAt(sampleLine(destination, waypoints[next]), cells, clearTimes))) continue;
        const candidate = sampleWave(from, destination);
        if (candidate.every((point) => point.y >= top && point.y <= bottom)
          && Number.isFinite(pathClearAt(candidate, cells, clearTimes))) {
          segment = candidate;
          target = next;
          break;
        }
      }
      if (segment) break;
    }
    if (!segment) {
      // Reconnect a projected wave point before taking a tight corridor corner.
      const anchor = waypoints[current];
      target = Math.hypot(from.x - anchor.x, from.y - anchor.y) > 1e-8 ? current : current + 1;
      segment = sampleLine(from, waypoints[target]);
      if (!Number.isFinite(pathClearAt(segment, cells, clearTimes))) {
        return { points, detours, complete: false, obstacle };
      }
    }
    if (segment.some((point) => Math.abs(point.y - waveHeight(point.x)) > 1)) detours++;
    points.push(...segment.slice(1));
    current = target;
  }
  return { points, detours, complete, obstacle };
}

/** Split a leg into seven-grid-space glides; a turn or exit may end a shorter glide. */
function splitGlides(points) {
  const glides = [];
  let glide = { points: [points[0]], distance: 0 };
  for (const target of points.slice(1)) {
    let from = glide.points.at(-1);
    let distance = Math.hypot(target.x - from.x, target.y - from.y);
    while (distance > 1e-9) {
      const step = Math.min(distance, TARDIS.glideDistance - glide.distance);
      const next = { x: from.x + (target.x - from.x) * step / distance, y: from.y + (target.y - from.y) * step / distance };
      glide.points.push(next);
      glide.distance += step;
      if (glide.distance >= TARDIS.glideDistance - 1e-9) {
        glides.push(glide);
        glide = { points: [next], distance: 0 };
      }
      from = next;
      distance = Math.hypot(target.x - from.x, target.y - from.y);
    }
  }
  if (glide.distance > 1e-9) glides.push(glide);
  return glides;
}

/**
 * Yield by retracing already-cleared geometry and returning along the same wave.
 * Reusing the actual points preserves the sine phase and any necessary detours.
 * Traffic reservations still check the entire maneuver before accepting it.
 * No traveled prefix means there is nowhere to reverse; delay appearance instead.
 */
export function reverseTardisAt(flight, at, minimumDuration, reason = 'traffic') {
  const pose = positionAt(flight, at);
  const backward = [{ x: pose.x, y: pose.y }];
  const requested = Math.max(TARDIS.glideDistance, minimumDuration * TARDIS.speed / 2);
  let distance = 0;
  for (const previous of flight.positions.filter((point) => point.time < at).reverse()) {
    const from = backward.at(-1);
    const length = Math.hypot(previous.x - from.x, previous.y - from.y);
    if (length < 1e-9) continue;
    const step = Math.min(length, requested - distance);
    backward.push({ x: from.x + (previous.x - from.x) * step / length,
      y: from.y + (previous.y - from.y) * step / length });
    distance += step;
    if (distance >= requested - 1e-8) break;
  }
  if (distance < 1e-8) return null;
  const roundTrip = [...backward, ...backward.slice(0, -1).reverse()];
  const glides = splitGlides(roundTrip);
  const trips = Math.max(1, Math.ceil(minimumDuration / (distance * 2 / TARDIS.speed)));
  const positions = [{ ...pose, time: at }];
  const cycles = [];
  let time = at;
  for (let trip = 0; trip < trips; trip++) for (const glide of glides) {
    const start = time;
    for (const next of glide.points.slice(1)) {
      const current = positions.at(-1);
      time += Math.hypot(next.x - current.x, next.y - current.y) / TARDIS.speed;
      positions.push({ ...next, angle: 0, time });
    }
    cycles.push({ spinStart: start, spinEnd: time, glideStart: start, glideEnd: time,
      turns: TARDIS.turns, distance: glide.distance });
  }
  const delay = time - at;
  const candidate = holdFlightAt(flight, at, delay, { reason: `${reason}-reversal` });
  candidate.positions = [...flight.positions.filter((point) => point.time < at), ...positions,
    ...flight.positions.filter((point) => point.time > at).map((point) => ({ ...point, time: point.time + delay }))];
  candidate.cycles.push(...cycles);
  candidate.cycles.sort((a, b) => a.glideStart - b.glideStart);
  candidate.reversals ??= [];
  candidate.reversals.push({ reason, blockedAt: at, reverseStart: at,
    turnedAt: at + distance / TARDIS.speed, returnedAt: time });
  candidate.reversals.sort((a, b) => a.reverseStart - b.reverseStart);
  return candidate;
}

/**
 * Precompute obstacle-safe geometry, then return a cheap departure-time builder.
 * Each glide carries the three-turn animation. A blocked glide reverses along
 * the cleared wave rather than waiting. Before any path has been cleared, the
 * appearance can be delayed. Fleet reservations also use reverseTardisAt.
 */
export function createTardisPlanner(cells, clearTimes, visibleAt, avoid = new Set()) {
  const { points, detours, complete, obstacle } = wavePath(cells, clearTimes, avoid);
  const glides = splitGlides(points).map((glide) => ({ ...glide, readyAt: pathClearAt(glide.points, cells, clearTimes) }));
  return function planTardis(departureAt = visibleAt) {
    // A delayed reservation changes when the sprite appears; it never creates
    // an entry hold that could be mistaken for an obstacle pause.
    let startAt = Math.max(visibleAt, departureAt);
    let time = startAt;
    // Yaw is rendered by projecting the box's faces; its screen-space pose stays upright.
    const angle = 0;
    let position = { ...SPAWN };
    let positions = [{ ...position, angle, time }];
    let cycles = [];
    let reversals = [];
    let events = [];
    const moveGlide = (glide, allowObstacleWait = true) => {
      const readyAt = allowObstacleWait ? Math.max(time, glide.readyAt) : time;
      if (readyAt > time) {
        const reversed = reverseTardisAt({ id: 'tardis', startAt, exitAt: time, positions,
          cycles, reversals, events, shots: [] }, time, readyAt - time, 'contribution');
        if (reversed) {
          positions = reversed.positions;
          cycles = reversed.cycles;
          reversals = reversed.reversals;
          events = reversed.events;
          time = reversed.exitAt;
        } else {
          // Stay invisible until there is a clear first glide.
          startAt = time = readyAt;
          positions[0].time = time;
        }
      }
      // Rotation remains coupled to translation in both directions.
      const glideStart = time;
      const spinStart = glideStart;
      for (const next of glide.points.slice(1)) {
        time += Math.hypot(next.x - position.x, next.y - position.y) / TARDIS.speed;
        position = next;
        positions.push({ ...position, angle, time });
      }
      const spinEnd = time;
      cycles.push({ spinStart, spinEnd, glideStart, glideEnd: time, turns: TARDIS.turns, distance: glide.distance });
    };
    for (const glide of glides) moveGlide(glide);
    if (!complete) {
      // A permanent obstacle turns the TARDIS back along the identical wave,
      // with no stationary direction-change pause.
      const reverseStart = time;
      const reverseGlides = splitGlides([...points].reverse());
      for (const glide of reverseGlides) moveGlide(glide, false);
      reversals.push({ reason: 'wall', blockedDate: obstacle?.date ?? null,
        blockedAt: reverseStart, reverseStart, returnedAt: time });
      if (time > reverseStart) events.push({ start: reverseStart, end: time, reason: 'wall-reversal', date: obstacle?.date });
    }
    return { id: 'tardis', startAt, exitAt: time, positions, route: points,
      shots: [], cycles, reversals, events, detours, speed: TARDIS.speed };
  };
}
