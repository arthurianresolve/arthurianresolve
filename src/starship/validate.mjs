import { DAMAGE, EXIT_FADE, HULL_BOUNDS } from './config.mjs';
import { createDamageTimeline } from './damage.mjs';
import { firstFollowingAt, firstOverlapAt, positionAt } from './motion.mjs';
import { pathClearAt } from './tardis.mjs';

const EPSILON = 1e-7;
const near = (a, b) => Math.abs(a - b) <= EPSILON;

/** A failed output contract, with coordinates/time useful to a diagnostic caller. */
export class InvalidPlanError extends Error {
  constructor(code, message, context = {}) {
    super(`${code}: ${message}${context.ship ? ` (${context.ship})` : ''}${context.time != null ? ` at ${context.time.toFixed(3)} logical seconds` : ''}`);
    this.name = 'InvalidPlanError';
    this.code = code;
    this.context = context;
  }
}

function requirePlan(condition, code, message, context) {
  if (!condition) throw new InvalidPlanError(code, message, context);
}

/** True when a calendar center lies on an orthogonal motion or weapon segment. */
function crossesCenter(a, b, cell) {
  const x = cell.x + 6, y = cell.y + 6;
  return near(a.x, b.x)
    ? near(x, a.x) && y >= Math.min(a.y, b.y) - EPSILON && y <= Math.max(a.y, b.y) + EPSILON
    : near(a.y, b.y) && near(y, a.y) && x >= Math.min(a.x, b.x) - EPSILON && x <= Math.max(a.x, b.x) + EPSILON;
}

/**
 * Check the completed plan before output. Reuse the planner's hull and damage
 * geometry, but inspect final event order and every crossing independently.
 * No mutation, rendering or file writes occur here. Failure preserves the last
 * generated assets; tests exercise both accepted plans and deliberately corrupt ones.
 */
export function validatePlan(plan) {
  requirePlan(Number.isFinite(plan.duration) && Number.isFinite(plan.reset)
    && plan.reset > 0 && plan.duration > plan.reset, 'PLAN-TIME', 'Invalid round timing.');
  const { cells, ships, fleetFlights } = plan;
  requirePlan(cells?.length && ships?.length && fleetFlights?.length, 'PLAN-EMPTY', 'A calendar and fleet are required.');
  const byDate = new Map(cells.map((cell) => [cell.date, cell]));
  requirePlan(byDate.size === cells.length && cells.every((cell) => typeof cell.date === 'string'
    && [cell.x, cell.y].every(Number.isFinite) && Number.isInteger(cell.level)
    && cell.level >= 0 && cell.level <= 4), 'PLAN-CELL', 'Invalid or duplicate calendar cells.');
  const ids = new Set(ships.map((ship) => ship.id));
  requirePlan(ids.size === ships.length, 'PLAN-SPRITE', 'Each ship type must have one sprite owner.');
  requirePlan(ships.every((ship) => fleetFlights.some((flight) => flight.id === ship.id
    && flight.startAt === ship.startAt && flight.exitAt === ship.exitAt)),
  'PLAN-OWNER', 'A sprite owner is missing from the flight schedule.');

  for (const flight of fleetFlights) {
    const context = { ship: flight.id, startAt: flight.startAt };
    requirePlan(HULL_BOUNDS[flight.id] && ids.has(flight.id), 'PLAN-SHIP', 'Unknown ship type.', context);
    requirePlan([flight.startAt, flight.exitAt].every(Number.isFinite)
      && flight.startAt >= 0 && flight.exitAt >= flight.startAt, 'PLAN-TIME', 'Invalid flight interval.', context);
    requirePlan(flight.positions?.length && Array.isArray(flight.shots), 'PLAN-FLIGHT', 'Missing motion or shots.', context);
    for (const [index, pose] of flight.positions.entries()) {
      requirePlan([pose.x, pose.y, pose.angle, pose.time].every(Number.isFinite), 'PLAN-POSE', 'Non-finite pose.', context);
      requirePlan(pose.time >= flight.startAt - EPSILON && pose.time <= flight.exitAt + EPSILON,
        'PLAN-TIME', 'Pose lies outside its flight.', { ...context, time: pose.time });
      if (!index) continue;
      const previous = flight.positions[index - 1];
      requirePlan(pose.time >= previous.time, 'PLAN-ORDER', 'Movement time went backwards.', context);
      requirePlan(pose.time > previous.time || (near(pose.x, previous.x) && near(pose.y, previous.y) && near(pose.angle, previous.angle)),
        'PLAN-TELEPORT', 'A visible ship teleported between equal-time poses.', context);
      if (flight.id !== 'tardis') requirePlan(near(pose.x, previous.x) || near(pose.y, previous.y),
        'PLAN-ROUTE', 'A grid-following ship cut a diagonal corner.', context);
    }
    requirePlan(near(flight.positions[0].time, flight.startAt) && near(flight.positions.at(-1).time, flight.exitAt),
      'PLAN-ENDPOINT', 'Flight endpoints do not match its poses.', context);
    for (const event of flight.events ?? []) requirePlan([event.start, event.end].every(Number.isFinite)
      && event.start >= flight.startAt - EPSILON && event.end >= event.start && event.end <= flight.exitAt + EPSILON
      && typeof event.reason === 'string', 'PLAN-EVENT', 'Invalid diagnostic activity interval.', context);
    for (const [events, startKey, endKey] of [[flight.beams, 'fire', 'end'], [flight.burns, 'start', 'end'], [flight.cycles, 'spinStart', 'spinEnd']]) {
      for (const event of events ?? []) requirePlan([event[startKey], event[endKey]].every(Number.isFinite)
        && event[startKey] >= flight.startAt - EPSILON && event[endKey] > event[startKey]
        && event[endKey] <= flight.exitAt + EPSILON, 'PLAN-EFFECT', 'Invalid effect interval.', context);
    }
    for (const shot of [...flight.shots, ...(flight.combatShots ?? [])]) {
      requirePlan([shot.fire, shot.hit, shot.from?.x, shot.from?.y, shot.x, shot.y, shot.dx, shot.dy].every(Number.isFinite)
        && shot.shipId === flight.id && shot.fire >= flight.startAt - EPSILON && shot.hit > shot.fire && shot.hit <= flight.exitAt + EPSILON,
      'PLAN-SHOT', 'Invalid projectile time or coordinates.', context);
      const pose = positionAt(flight, shot.fire);
      requirePlan(near(shot.from.x, pose.x + shot.dx * flight.muzzle) && near(shot.from.y, pose.y + shot.dy * flight.muzzle),
        'PLAN-MUZZLE', 'Projectile starts away from its firing ship.', { ...context, time: shot.fire });
      const dx = shot.x + 6 - shot.from.x, dy = shot.y + 6 - shot.from.y;
      requirePlan(near(Math.hypot(shot.dx, shot.dy), 1) && near(dx * shot.dy - dy * shot.dx, 0)
        && dx * shot.dx + dy * shot.dy > 0, 'PLAN-AIM', 'Projectile direction does not point at its target.', context);
    }
    for (const shot of flight.combatShots ?? []) requirePlan(!('date' in shot) && !('after' in shot)
      && ids.has(shot.targetShipId), 'PLAN-COMBAT', 'Cosmetic combat must not damage contributions.', context);
    for (const shield of flight.shields ?? []) requirePlan(Number.isFinite(shield.hit)
      && shield.hit >= flight.startAt && shield.hit <= flight.exitAt, 'PLAN-SHIELD', 'Invalid shield impact.', context);
  }

  const shots = fleetFlights.flatMap((flight) => flight.shots).sort((a, b) => a.hit - b.hit);
  const levels = new Map(cells.map((cell) => [cell.date, cell.level]));
  for (const shot of shots) {
    const cell = byDate.get(shot.date);
    const before = levels.get(shot.date);
    requirePlan(cell && before > 0 && shot.before === before && shot.after === before - 1
      && near(shot.x, cell.x) && near(shot.y, cell.y), 'PLAN-DAMAGE', 'Damage does not match the surviving cell.',
    { ship: shot.shipId, date: shot.date, time: shot.hit });
    requirePlan(before === 1 ? near(shot.destroyedAt, shot.hit + DAMAGE.explosionDelay) : shot.destroyedAt === null,
      'PLAN-EXPLOSION', 'Only the final hit may destroy a cell.', { date: shot.date, time: shot.hit });
    levels.set(shot.date, before - 1);
  }
  const clearTimes = createDamageTimeline(cells, shots).clearances();
  const active = cells.filter((cell) => cell.level > 0);
  for (const flight of fleetFlights) {
    for (let index = 1; index < flight.positions.length; index++) {
      const before = flight.positions[index - 1], after = flight.positions[index];
      if (flight.id === 'tardis') {
        requirePlan(pathClearAt([before, after], active, clearTimes) <= before.time + EPSILON,
          'PLAN-BLOCK', 'TARDIS hull enters an uncleared block.', { ship: flight.id, time: before.time });
      } else for (const cell of active) if (crossesCenter(before, after, cell)) {
        requirePlan((clearTimes.get(cell.date) ?? Infinity) <= before.time + EPSILON,
          'PLAN-BLOCK', 'Movement begins before the block explosion clears.', { ship: flight.id, date: cell.date, time: before.time });
      }
    }
    for (const shot of flight.shots) if (shot.weapon !== 'discovery-laser') {
      const target = { x: shot.x + 6, y: shot.y + 6 };
      for (const cell of active) if (cell.date !== shot.date && crossesCenter(shot.from, target, cell)) {
        requirePlan((clearTimes.get(cell.date) ?? Infinity) <= shot.fire + EPSILON,
          'PLAN-OBSTRUCTED-SHOT', 'An ordinary weapon crosses an uncleared block.', { ship: flight.id, date: cell.date, time: shot.fire });
      }
    }
  }

  // No-travel attempts are invisible in the renderer and reserve no sprite time.
  const visible = fleetFlights.filter((flight) => flight.exitAt > flight.startAt);
  for (const flights of Map.groupBy(visible, (flight) => flight.id).values()) {
    flights.sort((a, b) => a.startAt - b.startAt);
    for (let i = 1; i < flights.length; i++) requirePlan(flights[i].startAt >= flights[i - 1].exitAt + EXIT_FADE - EPSILON,
      'PLAN-DUPLICATE', 'Two appearances of the same ship overlap in time.', { ship: flights[i].id, time: flights[i].startAt });
  }
  let checkedPairs = 0;
  for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++) {
    const a = visible[i], b = visible[j];
    const overlap = firstOverlapAt(a, b);
    requirePlan(overlap === null, 'PLAN-COLLISION', 'Ship, shield or exhaust envelopes overlap.', { ship: a.id, otherShip: b.id, time: overlap });
    const following = firstFollowingAt(a, b);
    requirePlan(following === null, 'PLAN-FOLLOWING', 'Ships travel in the same close wake.', { ship: a.id, otherShip: b.id, time: following });
    checkedPairs++;
  }
  return { cells: cells.length, flights: fleetFlights.length, shots: shots.length, checkedPairs };
}
