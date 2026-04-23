import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { parseCalendar, validateCalendar } from '../src/starship/calendar.mjs';
import { renderPlan } from '../src/starship/render.mjs';
import { planAnimation } from '../src/starship/fleet.mjs';
import { validatePlan } from '../src/starship/validate.mjs';
import { createDiagnostics } from '../src/starship/diagnostics.mjs';

// Preserve the original import surface while implementation lives with its owner.
export { parseCalendar, validateCalendar } from '../src/starship/calendar.mjs';
export { findHighDensityRoute, findLeastResistanceRoute, findRandomDensityRoute } from '../src/starship/routes.mjs';
export { planAnimation } from '../src/starship/fleet.mjs';
export { shipArtwork, pixels } from '../src/starship/artwork.mjs';
export { renderStarship, escapeXml } from '../src/starship/render.mjs';

/**
 * CLI I/O: load a snapshot or public HTML, validate it, and write four SVG variants.
 * Only this entry point fetches GitHub data or writes generator artifacts.
 * Failure is reported to the caller; no fabricated calendar fallback is used.
 */
export async function generate({ input, html, username = 'arthurianresolve', out = 'assets', snapshot = 'data/contributions.json', diagnostics } = {}) {
  let calendar;
  if (input) calendar = validateCalendar(JSON.parse(await readFile(input, 'utf8')));
  else {
    let content;
    if (html) content = await readFile(html, 'utf8');
    else {
      if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(username)) throw new Error('Invalid GitHub username.');
      const response = await fetch(`https://github.com/users/${username}/contributions`, { headers: { 'User-Agent': 'contribution-invaders', 'Accept-Language': 'en-US' }, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`GitHub calendar request failed: HTTP ${response.status}`);
      content = await response.text();
    }
    calendar = parseCalendar(content, username);
  }
  // All four variants share one plan; rendering must not alter its events or poses.
  const plan = planAnimation(calendar.days);
  return writePlan(calendar, plan, { out, snapshot, diagnostics });
}

/** Validate and render everything before replacing any previously valid asset. */
export async function writePlan(calendar, plan, { out, snapshot, diagnostics }) {
  const validation = validatePlan(plan);
  const artifacts = [];
  for (const theme of ['dark', 'light']) for (const animated of [true, false]) {
    artifacts.push({ name: `github-contribution-grid-starship-${theme}${animated ? '' : '-static'}.svg`,
      svg: renderPlan(calendar, plan, theme, animated) });
  }
  const report = diagnostics ? createDiagnostics(calendar, plan, validation, artifacts) : null;
  await mkdir(out, { recursive: true });
  for (const { name, svg } of artifacts) await writeFile(resolve(out, name), svg);
  for (const [file, value] of [[snapshot, calendar], [diagnostics, report]]) if (file) {
    await mkdir(resolve(file, '..'), { recursive: true });
    await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
  }
  console.log(`Generated four SVGs: ${calendar.days.length} days, ${calendar.days.reduce((sum, day) => sum + day.count, 0)} contributions; snapshot ${calendar.fetchedAt}.`);
  console.log(`Validated ${validation.flights} flights, ${validation.shots} damage events and ${validation.checkedPairs} ship pairs.`);
  return { validation, diagnostics: report };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { input: { type: 'string' }, html: { type: 'string' }, username: { type: 'string', default: 'arthurianresolve' }, out: { type: 'string', default: 'assets' }, snapshot: { type: 'string', default: 'data/contributions.json' }, diagnostics: { type: 'string' } } });
  try { await generate(values); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
