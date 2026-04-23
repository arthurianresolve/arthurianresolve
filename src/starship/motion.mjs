import { DISCOVERY_EXHAUST, EXIT_FADE, FLIGHT_SPEED, GAP, HULL_BOUNDS, HULL_RADII, PLAYBACK_SPEED, SHIELD } from './config.mjs';

/** A valid route has no safe departure slot; the fleet may retry another entry lane. */
export class NoDepartureError extends Error {
  constructor(id, time) {
    super(`No separated departure for ${id} at ${time.toFixed(3)} logical seconds.`);
    this.name = 'NoDepartureError';
  }
}

/**
 * Interpolate a planned pose at a logical time, clamping outside the keyframes.
 * Angles remain unwrapped so interpolation follows the chosen shortest turn.
 */
export function positionAt(ship, time) {
  // Lower-bound search keeps dense curved paths cheap and selects the first equal-time pose.
  let low = 0;
  let high = ship.positions.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (ship.positions[middle].time < time) low = middle + 1;
    else high = middle;
  }
  const index = low;
  if (index === 0) return ship.positions[0];
  if (index === ship.positions.length) return ship.positions.at(-1);
  const a = ship.positions[index - 1];
  const b = ship.positions[index];
  const fraction = (time - a.time) / (b.time - a.time);
  return { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction, angle: (a.angle ?? 90) + ((b.angle ?? 90) - (a.angle ?? 90)) * fraction };
}

/**
 * Use the separating-axis test on oriented hull (or shield) rectangles.
 * Margins conservatively include movement between sampled poses and a small gap.
 */
function hullsOverlap(a, poseA, marginA, b, poseB, marginB, time) {
  const corners = (ship, pose, margin) => {
    const shielded = ship.shields?.some((shield) => time >= shield.hit && time <= shield.hit + SHIELD.duration);
    const burning = ship.burns?.some((burn) => time >= burn.start && time <= burn.end);
    const [left, right, top, bottom] = shielded ? SHIELD.bounds : burning ? DISCOVERY_EXHAUST.bounds : HULL_BOUNDS[ship.id];
    const angle = (pose.angle ?? 90) * Math.PI / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return [[left - margin, top - margin], [right + margin, top - margin], [right + margin, bottom + margin], [left - margin, bottom + margin]]
      .map(([x, y]) => ({ x: pose.x + x * cos - y * sin, y: pose.y + x * sin + y * cos }));
  };
  const first = corners(a, poseA, marginA + 0.1);
  const second = corners(b, poseB, marginB + 0.1);
  for (const rectangle of [first, second]) for (let i = 0; i < 2; i++) {
    const dx = rectangle[i + 1].x - rectangle[i].x;
    const dy = rectangle[i + 1].y - rectangle[i].y;
    const project = (points) => points.map((p) => p.x * -dy + p.y * dx);
    const p = project(first);
    const q = project(second);
    if (Math.max(...p) < Math.min(...q) || Math.max(...q) < Math.min(...p)) return false;
  }
  return true;
}

/**
 * Check the entire interval in which both flights are visible, including exit fades.
 * An analytic circle test rejects distant motion segments. Close segments use
 * rectangles expanded to contain translation and rotation between sample times.
 * This is a continuous clearance check, not just a keyframe-position comparison.
 * @returns {?number} First overlap time in logical seconds, or null when separated.
 */
export function firstOverlapAt(a, b) {
  const start = Math.max(a.startAt, b.startAt);
  const end = Math.min(a.exitAt + EXIT_FADE, b.exitAt + EXIT_FADE);
  if (end < start) return null;
  const shieldTimes = [a, b].flatMap((ship) => (ship.shields ?? []).flatMap((shield) => [shield.hit, shield.hit + SHIELD.duration]));
  const burnTimes = [a, b].flatMap((ship) => (ship.burns ?? []).flatMap((burn) => [burn.start, burn.end]));
  const times = [...new Set([start, end, ...a.positions.map((p) => p.time), ...b.positions.map((p) => p.time), ...shieldTimes, ...burnTimes])]
    .filter((time) => time >= start && time <= end).sort((x, y) => x - y);
  const radiusA = a.shields?.length ? SHIELD.radius : a.burns?.length ? DISCOVERY_EXHAUST.radius : HULL_RADII[a.id];
  const radiusB = b.shields?.length ? SHIELD.radius : b.burns?.length ? DISCOVERY_EXHAUST.radius : HULL_RADII[b.id];
  const clearance = radiusA + radiusB + GAP;
  for (let i = 0; i < times.length; i++) {
    const first = times[i];
    const last = times[i + 1] ?? first;
    const a0 = positionAt(a, first);
    const b0 = positionAt(b, first);
    const a1 = positionAt(a, last);
    const b1 = positionAt(b, last);
    const x = a0.x - b0.x;
    const y = a0.y - b0.y;
    const dx = a1.x - b1.x - x;
    const dy = a1.y - b1.y - y;
    const distanceSquared = dx * dx + dy * dy;
    const fraction = distanceSquared ? Math.max(0, Math.min(1, -(x * dx + y * dy) / distanceSquared)) : 0;
    if (Math.hypot(x + dx * fraction, y + dy * fraction) >= clearance) continue;
    const travelA = Math.hypot(a1.x - a0.x, a1.y - a0.y);
    const travelB = Math.hypot(b1.x - b0.x, b1.y - b0.y);
    const turnA = Math.abs((a1.angle ?? 90) - (a0.angle ?? 90)) * Math.PI / 180;
    const turnB = Math.abs((b1.angle ?? 90) - (b0.angle ?? 90)) * Math.PI / 180;
    const slices = Math.max(1, Math.ceil(Math.max(travelA, travelB) / 0.5), Math.ceil(Math.max(turnA, turnB) / 0.02));
    // Expanded midpoint boxes contain all translation and rotation throughout each slice.
    const marginA = (travelA + radiusA * turnA) / (2 * slices);
    const marginB = (travelB + radiusB * turnB) / (2 * slices);
    for (let slice = 0; slice < slices; slice++) {
      const time = first + (last - first) * (slice + 0.5) / slices;
      if (hullsOverlap(a, positionAt(a, time), marginA, b, positionAt(b, time), marginB, time)) return time;
    }
  }
  return null;
}

/** Boolean form of the continuous collision query, used by tests and reservations. */
export function flightsOverlap(a, b) {
  return firstOverlapAt(a, b) !== null;
}

/**
 * First time either moving ship would trail the other in the same lane within six
 * grid spaces. Solve relative-motion rectangle intersections between pose boundaries.
 * Actual velocity also covers the upright TARDIS; stationary waiting ships can yield.
 * For the TARDIS, use the other ship's wake and a full grid-space half-width so
 * diagonal parts of its wave cannot slip through a parallel-heading-only check.
 */
export function firstFollowingAt(a, b) {
  const weaving = (a.id === 'tardis') !== (b.id === 'tardis');
  const start = Math.max(a.startAt, b.startAt);
  const end = Math.min(a.exitAt, b.exitAt);
  const times = [...new Set([start, end, ...a.positions.map((p) => p.time), ...b.positions.map((p) => p.time)])]
    .filter((time) => time >= start && time <= end).sort((x, y) => x - y);
  for (let i = 1; i < times.length; i++) {
    const first = times[i - 1];
    const last = times[i];
    const a0 = positionAt(a, first), a1 = positionAt(a, last);
    const b0 = positionAt(b, first), b1 = positionAt(b, last);
    const travelA = Math.hypot(a1.x - a0.x, a1.y - a0.y);
    const travelB = Math.hypot(b1.x - b0.x, b1.y - b0.y);
    if (travelA < 1e-8 || travelB < 1e-8) continue;
    const ax = (a1.x - a0.x) / travelA, ay = (a1.y - a0.y) / travelA;
    const bx = (b1.x - b0.x) / travelB, by = (b1.y - b0.y) / travelB;
    if (ax * bx + ay * by < (weaving ? 0.5 : 0.99)) continue;
    // The ship's wake stays fixed while the TARDIS weaves; other pairs use the
    // mean heading. Both choices give the same answer when arguments are swapped.
    const length = Math.hypot(ax + bx, ay + by);
    const dx = weaving ? (a.id === 'tardis' ? bx : ax) : (ax + bx) / length;
    const dy = weaving ? (a.id === 'tardis' ? by : ay) : (ay + by) / length;
    const project = (s, d) => [(d.x - s.x) * dx + (d.y - s.y) * dy, (d.x - s.x) * -dy + (d.y - s.y) * dx];
    const from = project(a0, b0), to = project(a1, b1);
    let enter = 0, leave = 1;
    const halfWidth = weaving ? 16 : 6;
    for (const [axis, low, high] of [[0, -96, 96], [1, -halfWidth, halfWidth]]) {
      const change = to[axis] - from[axis];
      if (Math.abs(change) < 1e-9) {
        if (from[axis] <= low || from[axis] >= high) { leave = -1; break; }
      } else {
        const p = (low - from[axis]) / change, q = (high - from[axis]) / change;
        enter = Math.max(enter, Math.min(p, q));
        leave = Math.min(leave, Math.max(p, q));
      }
    }
    if (enter < leave) return first + (last - first) * enter;
  }
  return null;
}

/** Reservations enforce both physical clearance and independent fleet travel. */
export function trafficConflictAt(a, b) {
  const conflicts = [firstOverlapAt(a, b), firstFollowingAt(a, b)].filter((time) => time !== null);
  return conflicts.length ? Math.min(...conflicts) : null;
}

/** Insert a stationary traffic hold and shift future events without changing damage. */
export function holdFlightAt(flight, time, delay, detail = { reason: 'traffic' }) {
  const copy = structuredClone(flight);
  const pose = positionAt(flight, time);
  copy.positions = [
    ...copy.positions.filter((p) => p.time < time), { ...pose, time },
    { ...pose, time: time + delay },
    ...copy.positions.filter((p) => p.time >= time).map((p) => ({ ...p, time: p.time + delay })),
  ];
  for (const event of [...copy.shots, ...(copy.combatShots ?? [])]) {
    for (const key of ['fire', 'hit', 'destroyedAt']) if (event[key] != null && event[key] >= time) event[key] += delay;
  }
  for (const beam of copy.beams ?? []) for (const key of ['fire', 'end']) if (beam[key] >= time) beam[key] += delay;
  for (const burn of copy.burns ?? []) {
    if (burn.start >= time) burn.start += delay;
    if (burn.end > time) burn.end += delay;
  }
  for (const burst of copy.bursts ?? []) {
    if (burst.startAt >= time) burst.startAt += delay;
    if (burst.endAt > time) burst.endAt += delay;
  }
  for (const shield of copy.shields ?? []) if (shield.hit >= time) shield.hit += delay;
  for (const retry of copy.retries ?? []) for (const key of ['pausedAt', 'retreatAt', 'returnedAt', 'retryAt']) if (retry[key] >= time) retry[key] += delay;
  for (const reversal of copy.reversals ?? []) {
    for (const key of ['blockedAt', 'reverseStart', 'turnedAt', 'returnedAt']) if (reversal[key] > time) reversal[key] += delay;
  }
  for (const cycle of copy.cycles ?? []) {
    for (const key of ['spinStart', 'glideStart']) if (cycle[key] >= time) cycle[key] += delay;
    for (const key of ['spinEnd', 'glideEnd']) if (cycle[key] > time) cycle[key] += delay;
  }
  // Split an interrupted activity: a traffic wait must not inherit its reason.
  copy.events = (flight.events ?? []).flatMap((event) => {
    if (event.start >= time) return [{ ...event, start: event.start + delay, end: event.end + delay }];
    if (event.end <= time) return [{ ...event }];
    return [{ ...event, end: time }, { ...event, start: time + delay, end: event.end + delay }];
  });
  copy.events.push({ start: time, end: time + delay, ...detail });
  copy.events.sort((a, b) => a.start - b.start);
  copy.exitAt += delay;
  return copy;
}

/** Choose only pause points that cannot stretch an in-flight weapon or partial spin. */
export function canHoldAt(flight, time) {
  if (flight.cycles && !flight.cycles.some((cycle) => cycle.spinStart === time || cycle.glideStart === time)) return false;
  if (flight.shots.some((shot) => shot.fire < time && shot.hit >= time)) return false;
  if (flight.burns?.some((burn) => burn.start < time && burn.end > time)) return false;
  return !(flight.beams ?? []).some((beam) => beam.fire < time && beam.end >= time);
}

/**
 * Resolve traffic at safe intermediate poses instead of trapping a returning ship
 * in its launch bay. Each accepted hold or reversal clears the entire prefix.
 * Never move earlier: existing block-clearance guarantees remain conservative.
 */
function reserveWithStops(initial, earlierShips, yieldAt, maxWait) {
  let flight = initial;
  const trafficEnd = Math.max(...earlierShips.map((ship) => ship.exitAt + 0.5));
  for (let adjustment = 0; adjustment < 1000; adjustment++) {
    const conflicts = earlierShips.map((ship) => ({ ship, time: trafficConflictAt(flight, ship) })).filter(({ time }) => time !== null);
    if (!conflicts.length) return flight;
    const { ship: blocker, time: conflict } = conflicts.sort((a, b) => a.time - b.time)[0];
    const segmentEnd = flight.positions.find((p) => p.time > conflict)?.time ?? flight.exitAt;
    const stops = [...new Set(flight.positions.filter((p) => p.time <= conflict && canHoldAt(flight, p.time)).map((p) => p.time))].reverse();
    let resolved;
    for (const stop of stops) {
      let previousExit = -Infinity;
      for (let delay = 0.25; stop + delay <= trafficEnd + 0.25 && delay <= maxWait; delay += 0.25) {
        const candidate = yieldAt(flight, stop, delay);
        if (!candidate) break;
        // A moving yield can take longer than the requested delay. Avoid
        // checking an identical round trip at every quarter-second increment.
        if (candidate.exitAt <= previousExit + 1e-8) continue;
        previousExit = candidate.exitAt;
        const actualDelay = candidate.exitAt - flight.exitAt;
        const end = segmentEnd + actualDelay;
        // The collision query includes the exit fade after this prefix endpoint.
        const prefix = { ...candidate, exitAt: end - EXIT_FADE,
          positions: [...candidate.positions.filter((p) => p.time <= end), { ...positionAt(candidate, end), time: end }] };
        const hits = earlierShips.map((other) => trafficConflictAt(prefix, other)).filter((time) => time !== null);
        if (!hits.length) {
          const event = candidate.events?.find((event) => event.start === stop && event.end === stop + actualDelay);
          if (event) { event.otherShip = blocker.id; event.otherStartAt = blocker.startAt; }
          resolved = candidate;
          break;
        }
        if (yieldAt === holdFlightAt && Math.min(...hits) <= stop + actualDelay) break;
      }
      if (resolved) break;
    }
    if (!resolved) return null;
    flight = resolved;
  }
  return null;
}

/**
 * Find a collision-free departure by rebuilding the flight at quarter-second steps.
 * When spawnAt is supplied, the ship is visible from that fixed time and waits at
 * its entry pose until departure; that hold is checked for collisions as well.
 * Earlier flights are not mutated. Throw if no safe departure can be reserved.
 * allowStops enables safe intermediate traffic holds before trying departure delays.
 * yieldAt can replace a hold with a checked maneuver, such as a TARDIS wave reversal.
 */
export function reserveFlight(build, earlierShips, earliest = 0, spawnAt, allowStops = false, yieldAt = holdFlightAt, { maxWaitSeconds = Infinity } = {}) {
  const maxWait = maxWaitSeconds * PLAYBACK_SPEED;
  const showFrom = (flight) => {
    if (spawnAt !== undefined && spawnAt < flight.startAt) {
      flight.events ??= [];
      flight.events.unshift({ start: spawnAt, end: flight.startAt, reason: 'departure-traffic' });
      flight.positions.unshift({ ...flight.positions[0], time: spawnAt });
      flight.startAt = spawnAt;
    }
    return flight;
  };
  if (allowStops) {
    const initial = showFrom(build(earliest));
    const stopped = reserveWithStops(initial, earlierShips, yieldAt, maxWait);
    if (stopped) return stopped;
  }
  const latest = Math.max(earliest, ...earlierShips.map((ship) => ship.exitAt + 0.5));
  // Reserve a complete safe departure slot, including holds, rotations and retreats.
  for (let startAt = earliest; startAt <= latest + 0.25 && startAt - earliest <= maxWait; startAt += 0.25) {
    const flight = showFrom(build(startAt));
    if (earlierShips.every((other) => trafficConflictAt(flight, other) === null)) return flight;
  }
  throw new NoDepartureError(build(earliest).id, earliest);
}

/**
 * Build mutable, chronological keyframes for one flight.
 * face records the shortest turn, move records constant-speed translation, and
 * hold advances logical time without translation. Call face before move.
 */
export function createMotion(start, speed = FLIGHT_SPEED, startAt = 0) {
  let position = { ...start, angle: start.angle ?? 90 };
  let time = startAt;
  const positions = [{ ...position, time }];
  const events = [];
  const hold = (seconds, reason = 'pause', detail = {}) => {
    const start = time;
    time += seconds;
    positions.push({ ...position, time });
    if (seconds > 0) events.push({ start, end: time, reason, ...detail });
  };
  const face = (next) => {
    const heading = Math.atan2(next.x - position.x, position.y - next.y) * 180 / Math.PI;
    const turn = ((heading - position.angle + 540) % 360 + 360) % 360 - 180;
    if (turn) { position.angle += turn; hold(0.075, 'turn'); }
  };
  const move = (next) => {
    time += Math.hypot(next.x - position.x, next.y - position.y) / speed;
    position = { ...position, ...next };
    positions.push({ ...position, time });
  };
  return { positions, events, hold, face, move, get position() { return position; }, get time() { return time; } };
}
