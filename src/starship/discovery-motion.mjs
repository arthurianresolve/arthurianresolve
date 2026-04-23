import { FLIGHT_SPEED, PLAYBACK_SPEED } from './config.mjs';
import { createMotion } from './motion.mjs';

export const DISCOVERY_BURSTS = { blocks: [7, 5, 3], pauseSeconds: 0.6 };

/**
 * Wrap ordinary movement with repeating 7/5/3-grid-space bursts. Distance includes
 * entry alignment and retreats; obstacle waits do not consume a burst. Every move
 * records an exhaust interval, so the flame is off during turns, waits and firing.
 */
export function createDiscoveryMotion(spawn, startAt) {
  const motion = createMotion(spawn, FLIGHT_SPEED / 3, startAt);
  const burns = [];
  const bursts = [];
  let burst;
  /** Split a requested segment at burst boundaries without changing its direction or speed. */
  function move(target) {
    let distance = Math.hypot(target.x - motion.position.x, target.y - motion.position.y);
    while (distance > 1e-9) {
      if (!burst || burst.distance >= burst.blocks * 16 - 1e-9) {
        if (burst) motion.hold(DISCOVERY_BURSTS.pauseSeconds * PLAYBACK_SPEED, 'burst-recharge');
        burst = { blocks: DISCOVERY_BURSTS.blocks[bursts.length % DISCOVERY_BURSTS.blocks.length],
          distance: 0, startAt: motion.time, endAt: motion.time };
        bursts.push(burst);
      }
      const step = Math.min(distance, burst.blocks * 16 - burst.distance);
      const next = { x: motion.position.x + (target.x - motion.position.x) * step / distance,
        y: motion.position.y + (target.y - motion.position.y) * step / distance };
      const start = motion.time;
      motion.move(next);
      burns.push({ start, end: motion.time });
      burst.distance += step;
      burst.endAt = motion.time;
      distance = Math.hypot(target.x - motion.position.x, target.y - motion.position.y);
    }
  }
  return { positions: motion.positions, events: motion.events, hold: motion.hold, face: motion.face, move, burns, bursts,
    get position() { return motion.position; }, get time() { return motion.time; } };
}
