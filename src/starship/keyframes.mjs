/**
 * Remove only redundant SVG motion frames. Compare the rounded CSS offsets,
 * not logical times: rounding can make otherwise collinear poses non-redundant.
 * The last declaration wins at duplicate offsets, matching CSS keyframe rules.
 * Curves, turn boundaries and holds retain their original coordinates and timing.
 */
export function compactMotionFrames(frames, duration) {
  const kept = [];
  for (const frame of frames) {
    const offset = Number((frame.time / duration * 100).toFixed(4));
    if (kept.at(-1)?.offset === offset) kept.pop();
    kept.push({ frame, offset });
    while (kept.length >= 3) {
      const [a, b, c] = kept.slice(-3);
      const fraction = (b.offset - a.offset) / (c.offset - a.offset);
      if (!['x', 'y', 'angle'].every((key) => a.frame[key] + (c.frame[key] - a.frame[key]) * fraction === b.frame[key])) break;
      kept.splice(kept.length - 2, 1);
    }
  }
  return kept.map(({ frame }) => frame);
}
