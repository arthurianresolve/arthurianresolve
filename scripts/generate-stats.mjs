import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { THEMES } from '../src/themes.mjs';
import { prepareStatsCard } from '../src/stats/card.mjs';

// Keep the original import path for callers as well as the CLI command.
export { splitStatsCard } from '../src/stats/card.mjs';

const ORDER = 'contributions,hours,commits,issues,prs,trend,avg,repos,followers,stars';

/** Request one provider snapshot, so the numbers and grade cannot drift apart. */
function cardUrl(username) {
  const palette = THEMES.dark;
  const params = new URLSearchParams({ username, hide_border: 'true', border_radius: '8.5',
    custom_title: "George Dietrichsbruckner (MacArthur)'s stats", hide: 'streak,week,active_day,grade',
    order: ORDER, show_ring: 'true', bg: palette.bg.slice(1), text: palette.text.slice(1),
    title_color: palette.accent.slice(1), icon_color: palette.accent.slice(1), border_color: palette.border.slice(1) });
  return `https://ghstats.dev/api/card?${params}`;
}

/** Generate all variants before writing, leaving prior output intact on API/layout failure. */
export async function generateStats({ username = 'arthurianresolve', out = 'assets', input, snapshot } = {}) {
  let source;
  if (input) source = await readFile(input, 'utf8');
  else {
    const response = await fetch(cardUrl(username), { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`ghstats.dev returned HTTP ${response.status}.`);
    source = await response.text();
  }
  const card = prepareStatsCard(source);
  const variants = ['dark', 'light'].flatMap((theme) => [false, true].map((compact) => ({
    name: `github-stats-panels-${theme}${compact ? '-compact' : ''}.svg`, svg: card.render(theme, compact),
  })));
  await mkdir(out, { recursive: true });
  for (const { name, svg } of variants) await writeFile(resolve(out, name), svg);
  if (snapshot) await writeFile(resolve(snapshot), card.source);
  console.log('Generated four stats-panel SVGs from one ghstats.dev snapshot.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: Object.fromEntries(['username', 'out', 'input', 'snapshot'].map((name) => [name, { type: 'string' }])) });
  generateStats(values).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
