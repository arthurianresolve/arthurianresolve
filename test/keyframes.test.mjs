import test from 'node:test';
import assert from 'node:assert/strict';
import { compactMotionFrames } from '../src/starship/keyframes.mjs';

const pose = (time, x, y = 0, angle = 90) => ({ time, x, y, angle });

test('[EXPORT-01] remove redundant translation/hold frames while preserving turns and reversals', () => {
  const frames = [pose(0, 0), pose(1, 10), pose(2, 20), pose(3, 20), pose(4, 20), pose(5, 10), pose(6, 0)];
  const original = structuredClone(frames);
  assert.deepEqual(compactMotionFrames(frames, 10).map((frame) => frame.time), [0, 2, 4, 6]);
  assert.deepEqual(compactMotionFrames([pose(0, 0), pose(1, 10, 1), pose(2, 20)], 10).length, 3, 'Curved geometry is retained.');
  assert.equal(compactMotionFrames([pose(0, 0), pose(1, 10, 0, 180), pose(2, 20)], 10).length, 3);
  assert.deepEqual(frames, original);
});

test('[EXPORT-02] CSS offset rounding and duplicate declarations keep their original behavior', () => {
  const rounded = [pose(0, 0), pose(1 / 3, 1), pose(1, 3)];
  assert.equal(compactMotionFrames(rounded, 1).length, 3, 'Rounded offsets change the interpolation; retain that frame.');
  const duplicates = [pose(0, 0), pose(0.0000001, 4), pose(1, 10)];
  assert.equal(compactMotionFrames(duplicates, 1000)[0].x, 4, 'Last CSS declaration wins at the same offset.');
});
