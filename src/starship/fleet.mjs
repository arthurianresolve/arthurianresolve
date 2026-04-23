import { DAY, ENTERPRISE_SPEED, FLIGHT_SPEED, PLAYBACK_SPEED, STARFLIGHT_SPEED, TRAFFIC } from './config.mjs';
import { findHighDensityRoute, findLeastResistanceRoute, findRandomDensityRoute } from './routes.mjs';
import { enterpriseWeapon, planDiscovery, planFlight } from './flights.mjs';
import { NoDepartureError, reserveFlight } from './motion.mjs';
import { createTardisPlanner, reverseTardisAt } from './tardis.mjs';
import { createDamageTimeline, reconcileDamage } from './damage.mjs';
import { stageEncounter, stageFlybyEncounters } from './encounters.mjs';

export { reconcileDamage } from './damage.mjs';

/**
 * Plan a deterministic fleet round from validated contribution days.
 * Order matters: Starflight, Enterprise, Klingon/encounter, Discovery, then
 * the TARDIS and repeat crossings. Reconcile shared damage, add in-range combat
 * without moving reservations, then continue Enterprise’s weapon cycle.
 * ships contains first crossings; fleetFlights contains every scheduled crossing.
 * The top-level scout fields are retained for existing generator callers.
 */
export function planAnimation(days, { repeat = true } = {}) {
  const start = Date.parse(`${days[0].date}T00:00:00Z`);
  const startSunday = start - new Date(start).getUTCDay() * DAY;
  const cells = days.map((day) => {
    const date = new Date(`${day.date}T00:00:00Z`);
    return { ...day, x: 44 + Math.floor((date.getTime() - startSunday) / DAY / 7) * 16, y: 132 + date.getUTCDay() * 16 };
  });
  const { route, resistance } = findLeastResistanceRoute(cells, 132 + 4 * 16, { direction: -1 });
  const scout = planFlight(cells, route, { id: 'scout', startY: 138 + 4 * 16,
    speed: STARFLIGHT_SPEED, spawnX: 920, direction: -1 });
  const highDensity = findHighDensityRoute(cells, route, 132 + 2 * 16);
  // Resolve later encounters along the route so Enterprise can leave the left
  // bay promptly while Starflight enters from the opposite edge.
  let cruiser = reserveFlight((startAt) => planFlight(cells, highDensity.route, { id: 'cruiser', muzzle: 10, sharedShots: scout.shots, startY: 138 + 2 * 16, startAt, speed: ENTERPRISE_SPEED, spawnX: 20 }), [scout], 0, 0, true);
  cruiser.targets = highDensity.targets;
  // Convert one playback second into logical time. Both arrivals must have happened.
  const supportStartAt = Math.max(gridArrivalAt(scout, cells), gridArrivalAt(cruiser, cells)) + PLAYBACK_SPEED;
  const shotsFrom = (flights) => flights.flatMap((ship) => ship.shots);
  const clearTimes = (flights) => createDamageTimeline(cells, shotsFrom(flights)).clearances();
  const leadShots = shotsFrom([scout, cruiser]);
  let bird, birdRoute, birdError;
  // Opposing Starflight traffic can trap an entrance. Keep the shared launch
  // time but try another interior height, away from Discovery's middle row.
  let birdAttempts = 0;
  birdLaunch: for (const maxWaitSeconds of [TRAFFIC.preferredWaitSeconds, Infinity]) for (const row of [1, 5, 4]) {
    birdRoute = findRandomDensityRoute(cells, 132 + row * 16, start / DAY, [...route, ...highDensity.route]).route;
    try {
      bird = reserveFlight((startAt) => planFlight(cells, birdRoute, { id: 'bird', muzzle: 11.2,
        sharedShots: leadShots, startY: 138 + row * 16, startAt,
        speed: FLIGHT_SPEED * 2 / 3, spawnX: 20 }), [scout, cruiser], supportStartAt, supportStartAt, true, undefined, { maxWaitSeconds });
      if (birdAttempts) bird.events.unshift({ start: supportStartAt, end: supportStartAt,
        reason: Number.isFinite(maxWaitSeconds) ? 'alternate-entrance' : 'extended-traffic-wait', attempts: birdAttempts });
      break birdLaunch;
    } catch (error) { if (!(error instanceof NoDepartureError)) throw error; birdError = error; birdAttempts++; }
  }
  if (!bird) throw birdError;
  // An early shield flash must not cover Discovery's newly visible waiting pose.
  const discoveryDock = {
    id: 'discovery', startAt: supportStartAt, exitAt: Math.max(cruiser.exitAt, bird.exitAt),
    positions: [{ x: 20, y: 186, angle: 90, time: supportStartAt }],
  };
  // An empty contribution year has no visible grid activity to frame a combat
  // exchange, so keep its SVG free of cosmetic weapon markers.
  if (cells.some((cell) => cell.level > 0)) [cruiser, bird] = stageEncounter(cruiser, bird, [scout, discoveryDock]);
  const armed = [scout, cruiser, bird];
  const armedShots = shotsFrom(armed);
  const armedClearTimes = clearTimes(armed);
  let discovery, discoveryError;
  // A narrow calendar can trap the initial dock too. Use the same outer-bay
  // recovery as repeat crossings while preserving the requested launch time.
  for (const entryX of [20, 0, -20]) {
    try {
      discovery = reserveFlight((startAt) => planDiscovery(cells, armedClearTimes, [route, highDensity.route, birdRoute], findLeastResistanceRoute, startAt, armedShots, 2 * PLAYBACK_SPEED, entryX), armed, supportStartAt, supportStartAt, true);
      if (entryX !== 20) discovery.events.unshift({ start: supportStartAt, end: supportStartAt, reason: 'alternate-entrance' });
      break;
    } catch (error) { if (!(error instanceof NoDepartureError)) throw error; discoveryError = error; }
  }
  if (!discovery) throw discoveryError;
  const firstFour = [...armed, discovery];
  const tardisStartAt = gridArrivalAt(discovery, cells) + 0.25;
  const tardisAvoid = new Set(firstFour.flatMap((flight) => routeCells(flight, cells)).map((cell) => `${cell.x},${cell.y}`));
  // Keep the sine route independent of the armed lanes. Reserve its whole hull
  // and the wider wake clearance needed while it weaves near another ship.
  const tardis = reserveFlight(createTardisPlanner(cells, clearTimes(firstFour), tardisStartAt, tardisAvoid), firstFour, tardisStartAt, undefined, true, reverseTardisAt);
  const ships = [...firstFour, tardis];
  const fleetFlights = [...ships];
  let roundEnd = Math.max(repeat ? 90 : 0, ...ships.map((ship) => ship.exitAt + 0.45));
  const rightEdge = Math.max(...cells.map((cell) => cell.x)) + 12;
  let tardisCrossed = tardis.positions.at(-1).x > rightEdge;
  let tardisRetries = 0;
  const latest = new Map(ships.map((ship) => [ship.id, ship]));
  const entries = { scout: 4, cruiser: 2, bird: 1, discovery: 3 };
  // Always schedule the next ship to finish; respawns never wait for the whole fleet.
  if (repeat) for (let pass = 0; pass < 100; pass++) {
    const previous = [...latest.values()].sort((a, b) => a.exitAt - b.exitAt)[0];
    const spawnAt = previous.exitAt + 0.3;
    if (spawnAt >= roundEnd) break;
    const id = previous.id;
    const sharedShots = shotsFrom(fleetFlights);
    const damage = createDamageTimeline(cells, sharedShots);
    const currentCells = cells.map((cell) => {
      const level = damage.remainingAt(cell, spawnAt);
      return { ...cell, level, count: level ? cell.count : 0 };
    });
    const scheduled = damage.clearances();
    const otherRoutes = [...latest.values()].filter((flight) => flight.id !== id).map((flight) => routeCells(flight, cells));
    const reserved = otherRoutes.flat();
    const avoid = new Set(reserved.map((cell) => `${cell.x},${cell.y}`));
    // Keep reappearance immediate. If a fixed entrance is trapped by traffic, try
    // another interior lane and re-plan the route instead of queueing behind a ship.
    const entryRows = id === 'tardis' || id === 'discovery' ? [entries[id]] : [...new Set([entries[id], 1, 2, 3, 4, 5])];
    const entranceX = id === 'scout' ? 920 : id === 'cruiser' ? 0 : 20;
    // An opposing ship can occupy the normal bay during its exit fade. A bay
    // just outside the frame leaves space to re-enter without overlapping it.
    const entranceXs = id === 'tardis' ? [20] : [entranceX, id === 'scout' ? 940 : entranceX - 20];
    let flight, lastError, attempts = 0;
    // Exhaust shorter safe entrance options before accepting an extended wait.
    // The TARDIS already yields by moving, so its reversals need no idle budget.
    const waitBudgets = id === 'tardis' ? [Infinity] : [TRAFFIC.preferredWaitSeconds, Infinity];
    departure: for (const maxWaitSeconds of waitBudgets) for (const { row, entryX } of entranceXs.flatMap((entryX) => entryRows.map((row) => ({ row, entryX })))) {
      const entryY = 132 + row * 16;
      let build;
      if (id === 'tardis') build = createTardisPlanner(cells, scheduled, spawnAt, avoid);
      else if (id === 'discovery') build = (startAt) => planDiscovery(cells, scheduled, otherRoutes, findLeastResistanceRoute, startAt, sharedShots, 2 * PLAYBACK_SPEED, entryX);
      else {
        const path = id === 'scout' ? findLeastResistanceRoute(currentCells, entryY, { avoid, direction: -1 }).route
          : id === 'cruiser' ? findHighDensityRoute(currentCells, reserved, entryY).route
          : findRandomDensityRoute(currentCells, entryY, start / DAY + pass + 1, reserved).route;
        build = (startAt) => planFlight(cells, path, { id, muzzle: previous.muzzle, sharedShots,
          startY: 138 + row * 16, startAt, speed: previous.speed,
          spawnX: entryX,
          direction: id === 'scout' ? -1 : 1, launchHold: 0 });
      }
      try {
        // The TARDIS yields by reversing its wave; other ships can hold.
        flight = id === 'tardis' ? reserveFlight(build, fleetFlights, spawnAt, undefined, true, reverseTardisAt)
          : reserveFlight(build, fleetFlights, spawnAt, spawnAt, true, undefined, { maxWaitSeconds });
        if (attempts) flight.events.unshift({ start: flight.startAt, end: flight.startAt,
          reason: Number.isFinite(maxWaitSeconds) ? 'alternate-entrance' : 'extended-traffic-wait', attempts });
        break departure;
      }
      catch (error) { if (!(error instanceof NoDepartureError)) throw error; lastError = error; attempts++; }
    }
    if (!flight) throw lastError;
    fleetFlights.push(flight);
    latest.set(id, flight);
    // A larger TARDIS may return left and retry. Let its first successful
    // crossing finish before resetting the board; later laps do not extend it.
    if (id === 'tardis' && !tardisCrossed) {
      tardisRetries++;
      tardisCrossed = flight.positions.at(-1).x > rightEdge;
      // Keep up to three retries visible even when a full-height wave needs
      // more of the board cleared. A permanently blocked board still resets.
      if (tardisCrossed || tardisRetries <= 3) roundEnd = Math.max(roundEnd, flight.exitAt + 0.6);
    }
  }
  // Later emergency hits can invalidate earlier reservations; discard redundant damage.
  reconcileDamage(cells, fleetFlights);
  if (cells.some((cell) => cell.level > 0)) stageFlybyEncounters(fleetFlights, roundEnd - 0.3);
  fleetFlights.filter((flight) => flight.id === 'cruiser').flatMap((flight) => [...flight.shots, ...(flight.combatShots ?? [])]).sort((a, b) => a.fire - b.fire).forEach((shot, index) => { shot.weapon = enterpriseWeapon(index); });
  return { ...scout, cells, resistance, ships, fleetFlights, reset: roundEnd, duration: roundEnd + 0.6 };
}

/** Map a ship's center path (including curved samples) back to actual calendar cells. */
function routeCells(flight, cells) {
  const occupied = new Set(flight.route.map((point) => `${44 + Math.round((point.x - 50) / 16) * 16},${132 + Math.round((point.y - 138) / 16) * 16}`));
  return cells.filter((cell) => occupied.has(`${cell.x},${cell.y}`));
}

/** Return first arrival inside the grid, from either launch edge. */
function gridArrivalAt(flight, cells) {
  const firstCenterX = Math.min(...cells.map((cell) => cell.x)) + 6;
  const lastCenterX = Math.max(...cells.map((cell) => cell.x)) + 6;
  return flight.positions.find((position) => position.x >= firstCenterX && position.x <= lastCenterX).time;
}
