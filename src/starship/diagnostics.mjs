import { createHash } from 'node:crypto';
import { PLAYBACK_SPEED } from './config.mjs';

export const artifactHash = (text) => createHash('sha256').update(text).digest('hex');

/**
 * Export an opt-in review timeline in playback seconds. It contains decisions
 * recorded by planners, not guesses inferred from a frozen ship's position.
 * Artifact hashes prevent seeking an old timeline against a newer SVG.
 */
export function createDiagnostics(calendar, plan, validation, artifacts) {
  const toSeconds = (time) => time / PLAYBACK_SPEED;
  const events = [];
  const crossings = new Map();
  for (const flight of plan.fleetFlights) {
    // An unsuccessful no-travel attempt has no visible appearance to inspect.
    if (flight.exitAt === flight.startAt) continue;
    const crossing = (crossings.get(flight.id) ?? 0) + 1;
    crossings.set(flight.id, crossing);
    const append = (event) => {
      if (event.start >= plan.reset - 0.3) return;
      events.push({ ...event, ship: flight.id, crossing,
        otherStartAt: event.otherStartAt === undefined ? undefined : toSeconds(event.otherStartAt),
        start: toSeconds(event.start), end: toSeconds(Math.min(event.end, plan.reset - 0.3)) });
    };
    append({ start: flight.startAt, end: flight.startAt, reason: 'appearance' });
    for (const event of flight.events ?? []) {
      // Reconciliation may cancel a volley after another ship clears its target.
      // Its conservative time reservation remains, but no shot will be rendered.
      const cancelled = event.reason === 'firing' && !flight.shots.some((shot) => shot.date === event.date
        && shot.fire >= event.start - 1e-8 && shot.fire < event.end);
      append({ ...event, reason: cancelled ? 'reserved-clearance' : event.reason });
    }
    for (const retry of flight.retries ?? []) append({ start: retry.retreatAt, end: retry.returnedAt,
      reason: 'retreat', date: retry.blockedDate });
    append({ start: flight.exitAt, end: flight.exitAt, reason: 'exit' });
  }
  events.sort((a, b) => a.start - b.start || a.ship.localeCompare(b.ship));
  return { version: 1, username: calendar.username, snapshot: calendar.fetchedAt,
    durationSeconds: toSeconds(plan.duration), validation,
    artifacts: Object.fromEntries(artifacts.map(({ name, svg }) => [name, artifactHash(svg)])),
    events };
}
