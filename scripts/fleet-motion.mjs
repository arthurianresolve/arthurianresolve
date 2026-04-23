/**
 * Compatibility exports for the original motion-module import path.
 * New code should import the owning module directly; see docs/ARCHITECTURE.md.
 */
export { FLIGHT_SPEED, HULL_RADII } from '../src/starship/config.mjs';
export { createMotion, flightsOverlap, positionAt, reserveFlight } from '../src/starship/motion.mjs';
export { planDiscovery } from '../src/starship/flights.mjs';
export { reconcileDamage } from '../src/starship/damage.mjs';
