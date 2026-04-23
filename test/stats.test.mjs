import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateStats, splitStatsCard } from '../scripts/generate-stats.mjs';
import { THEMES } from '../src/themes.mjs';

const source = await readFile(new URL('../data/github-stats-source.svg', import.meta.url), 'utf8');
const text = (svg, kind) => [...svg.matchAll(new RegExp(`<text[^>]*class="${kind}"[^>]*>([^<]+)</text>`, 'g'))].map((match) => match[1]);

test('[STATS-01] separate panels preserve provider values and grade in both themes and layouts', () => {
  for (const theme of ['dark', 'light']) for (const compact of [false, true]) {
    const svg = splitStatsCard(source, theme, compact);
    for (const kind of ['label', 'value', 'ring-grade', 'ring-pct']) assert.deepEqual(text(svg, kind), text(source, kind));
    assert.equal((svg.match(/data-panel="grade"/g) ?? []).length, 1);
    assert.equal((svg.match(/<rect /g) ?? []).length, 2);
    assert.ok(svg.includes(`fill="${THEMES[theme].bg}" stroke="${THEMES[theme].border}"`));
    if (compact) {
      assert.match(svg, /viewBox="0 0 495 530"/);
      assert.match(svg, /data-panel="stats" transform="translate\(0 200\)"/);
    }
    else {
      assert.match(svg, /viewBox="0 0 940 330"/);
      assert.match(svg, /data-panel="stats" transform="translate\(300 0\)"/);
      assert.match(svg, /x="0.5" y="0.5" width="639" height="329"/);
      assert.match(svg, /x="0.5" y="0.5" width="279" height="329"/);
    }
  }
});

test('[STATS-02] a changed or error response is rejected instead of hiding or inventing statistics', () => {
  assert.throws(() => splitStatsCard('<svg><text>Service unavailable</text></svg>'), /layout changed/);
  assert.throws(() => splitStatsCard(source.replace('class="ring-grade"', 'class="changed-grade"')), /layout changed|unsupported/);
  assert.throws(() => splitStatsCard(source.replace(/x="350"/g, 'x="351"')), /positions changed/);
});

test('[STATS-03] active or externally referenced provider markup is rejected', () => {
  const attacks = [
    source.replace('<title>', '<script>alert(1)</script><title>'),
    source.replace('<rect ', '<foreignObject><div>unsafe</div></foreignObject><rect '),
    source.replace('<rect ', '<rect onload="alert(1)" '),
    source.replace('<path ', '<path href="https://attacker.invalid/payload" '),
    source.replace('xmlns="http://www.w3.org/2000/svg"', 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'),
    source.replace('<path ', '<path fill="url(&#104;ttps://attacker.invalid/pixel)" '),
    source.replace('<rect ', '<rect x="1" '),
    source.replace('<title>', '<title>&unknown;'),
    '<!DOCTYPE svg [<!ENTITY payload SYSTEM "file:///local">]>' + source,
    '<?xml-stylesheet href="https://attacker.invalid/style"?>' + source,
    ' '.repeat(256 * 1024) + source,
  ];
  for (const attack of attacks) assert.throws(() => splitStatsCard(attack), /unsupported|unsafe|duplicate/);
});

test('[STATS-04] provider CSS is replaced before panels and the reproducible snapshot are written', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'profile-stats-'));
  const input = join(directory, 'provider.svg');
  const snapshot = join(directory, 'snapshot.svg');
  const hostile = source.replace('</style>', '.value { fill: url(https://attacker.invalid/pixel) }</style>');
  try {
    await writeFile(input, hostile);
    await generateStats({ input, out: directory, snapshot });
    const panels = ['dark', 'light'].flatMap((theme) => ['', '-compact'].map((suffix) => join(directory, `github-stats-panels-${theme}${suffix}.svg`)));
    for (const file of [snapshot, ...panels]) {
      const generated = await readFile(file, 'utf8');
      assert.doesNotMatch(generated, /attacker\.invalid|url\(/);
      assert.match(generated, /@media \(prefers-reduced-motion: reduce\)/);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('[STATS-05] rejected batch input preserves every existing panel and retained snapshot', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'profile-stats-'));
  const input = join(directory, 'provider.svg');
  const snapshot = join(directory, 'snapshot.svg');
  const outputs = ['dark', 'light'].flatMap((theme) => ['', '-compact'].map((suffix) => join(directory, `github-stats-panels-${theme}${suffix}.svg`)));
  try {
    for (const file of [...outputs, snapshot]) await writeFile(file, 'existing valid asset');
    await writeFile(input, source.replace('<title>', '<script>alert(1)</script><title>'));
    await assert.rejects(generateStats({ input, out: directory, snapshot }), /unsupported/);
    for (const file of [...outputs, snapshot]) assert.equal(await readFile(file, 'utf8'), 'existing valid asset');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
