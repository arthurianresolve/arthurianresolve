import { DAMAGE } from './config.mjs';

/** First index after all hits at or before time; simultaneous hits count together. */
function hitsThrough(hits, time) {
  let low = 0, high = hits.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (hits[middle] <= time) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * One damage timeline for a planner. Original cell levels never change; queries
 * combine all ships' hits in chronological order, regardless of who planned first.
 * Keep only the first level hits per cell: later hits cannot change its clearance.
 * Explicit clear times support callers that have a clearance schedule without hits.
 */
export function createDamageTimeline(cells, shots = [], clearTimes = new Map()) {
  const levels = new Map(cells.map((cell) => [cell.date, cell.level]));
  const hits = new Map();

  function record(shot) {
    const level = levels.get(shot.date);
    if (!level) return;
    const times = hits.get(shot.date) ?? [];
    times.splice(hitsThrough(times, shot.hit), 0, shot.hit);
    times.length = Math.min(times.length, level);
    hits.set(shot.date, times);
  }
  shots.forEach(record);

  /** Surviving density at time, including any new hits recorded by this planner. */
  function remainingAt(cell, time) {
    if ((clearTimes.get(cell.date) ?? Infinity) <= time) return 0;
    return Math.max(0, cell.level - hitsThrough(hits.get(cell.date) ?? [], time));
  }

  /** A zero-health cell stays occupied until its last-hit explosion has finished. */
  function clearedAt(cell) {
    if (!cell.level) return 0;
    const finalHit = hits.get(cell.date)?.[cell.level - 1] ?? Infinity;
    return Math.min(clearTimes.get(cell.date) ?? Infinity, finalHit + DAMAGE.clearanceDelay);
  }

  /** Snapshot of finite clearances for route planners that cannot fire. */
  function clearances() {
    return new Map(cells.filter((cell) => cell.level && Number.isFinite(clearedAt(cell)))
      .map((cell) => [cell.date, clearedAt(cell)]));
  }

  return { record, remainingAt, clearedAt, clearances };
}

/**
 * Assign one level of damage per chronological hit and one final explosion.
 * Mutate only each flight's shots array; retain flight ownership across repeat
 * crossings and exclude cosmetic combatShots from contribution damage.
 */
export function reconcileDamage(cells, ships) {
  const levels = new Map(cells.map((cell) => [cell.date, cell.level]));
  const hits = ships.flatMap((ship) => ship.shots.map((shot) => ({ ship, shot })))
    .sort((a, b) => a.shot.hit - b.shot.hit);
  for (const ship of ships) ship.shots = [];
  for (const { ship, shot } of hits) {
    const before = levels.get(shot.date);
    if (!before) continue;
    levels.set(shot.date, before - 1);
    ship.shots.push({ ...shot, before, after: before - 1,
      destroyedAt: before === 1 ? shot.hit + DAMAGE.explosionDelay : null });
  }
}
