/**
 * Shared geometry and timing. Positions use SVG pixels; planning uses logical
 * seconds. The renderer divides logical durations by PLAYBACK_SPEED.
 * See docs/ARCHITECTURE.md for the coordinate and event contracts.
 */
export const DAY = 86_400_000;
export const PLAYBACK_SPEED = 0.5;
export const FLIGHT_SPEED = 155;
// Explosion begins shortly after impact; ships wait until its full envelope clears.
export const DAMAGE = { explosionDelay: 0.06, clearanceDelay: 0.26 };
export const EXIT_FADE = 0.25;
// These thresholds are visible playback seconds; planners convert them once.
// Try another entrance before accepting a longer, collision-safe traffic wait.
export const TRAFFIC = { preferredWaitSeconds: 6, encounterDelaySeconds: 4 };
// Lead ships use two-thirds of their previous traversal speed for a calmer
// opening pass. Keeping the factor named makes the requested motion change
// visible to planners, tests, and future maintainers.
export const LEAD_SPEED_FACTOR = 2 / 3;
export const STARFLIGHT_SPEED = FLIGHT_SPEED * 0.6 * LEAD_SPEED_FACTOR;
export const ENTERPRISE_SPEED = FLIGHT_SPEED * LEAD_SPEED_FACTOR;
// Match Enterprise's 24px length while scaling every police-box dimension together.
export const TARDIS_SCALE = 24 / 12.5;

// Hull rectangles include strokes and artwork scaling: [left, right, top, bottom].
// Radii enclose those rectangles at every heading; GAP is added by the broad test.
export const HULL_RADII = { scout: 14, cruiser: 17, bird: 16, discovery: 20, tardis: 16 };
export const HULL_BOUNDS = {
  scout: [-7, 7, -6, 12],
  cruiser: [-8.5, 8.5, -10, 14],
  bird: [-9.8, 9.8, -11.2, 7.98],
  discovery: [-5.5, 5.5, -11, 19],
  // Includes the widest vertical-axis projection, strokes, and the roof lamp.
  tardis: [-4.4, 4.4, -6.5, 6.5].map((value) => value * TARDIS_SCALE),
};
export const GAP = 2;
export const BIRD_SCALE = 1.4;

// One owner for the shield's visible envelope and collision lifetime.
export const SHIELD = { bounds: [-16.5, 16.5, -18.5, 24.5], radius: 30, duration: 0.48 };
// Discovery's orange exhaust is part of its occupied space only during movement.
export const DISCOVERY_EXHAUST = { bounds: [-5.5, 5.5, -11, 25], radius: 26 };
