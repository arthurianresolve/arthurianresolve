import { THEMES } from '../themes.mjs';
import { sanitizeStatsSvg } from './svg.mjs';

const CREDIT = `<!-- Stats SVG adapted from https://github.com/rowkav09/GitHub-profile-stats
MIT License
Copyright (c) 2026 rowkav09

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
-->`;

/** Validate once and keep normalized fragments private to all theme/layout renders. */
export function prepareStatsCard(source) {
  source = sanitizeStatsSvg(source);
  const root = source.match(/^<svg\b[^>]*viewBox="0 0 495 (\d+)"[^>]*>/);
  const ring = source.match(/\s*(<circle cx="425" cy="([\d.]+)" r="40"[\s\S]*class="ring-pct">[^<]+<\/text>)\s*<\/svg>\s*$/);
  if (!root || !ring || !ring[1].includes('class="ring-progress"')
    || !ring[1].includes('class="ring-grade"') || (source.match(/class="value"/g) ?? []).length !== 10) {
    throw new Error('The ghstats.dev card layout changed; existing stats assets were preserved.');
  }
  const height = Number(root[1]);
  const body = source.slice(root[0].length, ring.index);
  const background = body.match(/<rect x="0\.5" y="0\.5"[^>]*\/>/);
  const values = [...body.matchAll(/(<text x=")350("[^>]*class="value")/g)];
  if (!background || values.length !== 10) throw new Error('The ghstats.dev stat positions changed; existing stats assets were preserved.');
  return { source, render(theme = 'dark', compact = false) {
    const palette = THEMES[theme];
    // Wide: grade 280 + gap 20 + stats 640 = the contribution SVG's 940px width.
    // Narrow: keep the provider's readable text size, with the grade above stats.
    const statsWidth = compact ? 495 : 640;
    const width = compact ? 495 : 940;
    const statsX = compact ? 0 : 300;
    const statsY = compact ? 200 : 0;
    const grade = compact
      ? { x: 0, y: 0, width: 495, height: 180, cx: 375, cy: 90, scale: 1.4 }
      : { x: 0, y: 0, width: 280, height, cx: 140, cy: height / 2 + 15, scale: 1.7 };
    const totalHeight = compact ? height + 200 : height;
    const panel = (x, y, w, h) => `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" rx="8" fill="${palette.bg}" stroke="${palette.border}"/>`;
    const statsBody = body.replace(background[0], panel(0, 0, statsWidth, height))
      .replace(/(<text x=")350("[^>]*class="value")/g, (_, a, b) => `${a}${statsWidth - 25}${b}`);
    const gradeTitleX = grade.x + 25;
    const gradeTitleY = compact ? grade.y + 83 : 43;
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${totalHeight}" viewBox="0 0 ${width} ${totalHeight}" role="img" aria-label="GitHub statistics and separate activity grade">
${CREDIT}
<g data-panel="stats" transform="translate(${statsX} ${statsY})">${statsBody}</g>
${panel(grade.x, grade.y, grade.width, grade.height)}
<text x="${gradeTitleX}" y="${gradeTitleY}" class="title">Activity grade</text>
<g data-panel="grade" transform="translate(${grade.cx} ${grade.cy}) scale(${grade.scale}) translate(-425 -${ring[2]})">${ring[1]}</g>
</svg>`;
    // Both themes come from that same response. Preserve semantic trend colours.
    for (const key of ['bg', 'text', 'accent', 'border']) svg = svg.replaceAll(THEMES.dark[key], palette[key]);
    return svg;
  } };
}

/** One-off rendering uses exactly the same validation as batch generation. */
export function splitStatsCard(source, theme = 'dark', compact = false) {
  return prepareStatsCard(source).render(theme, compact);
}
