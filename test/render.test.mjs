// SVG packaging and accessibility, including the no-activity boundary case.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderPlan, renderStarship } from '../src/starship/render.mjs';
import { planAnimation } from '../src/starship/fleet.mjs';

const snapshot = JSON.parse(await readFile(new URL('../data/contributions.json', import.meta.url), 'utf8'));
/** Give each test its own mutable calendar while preserving the retained snapshot. */
const fixture = () => structuredClone(snapshot);
// Shared read-only integration plan; mutation tests use their own cloned fixtures.
const snapshotPlan = planAnimation(snapshot.days);

test('[SVG-01] SVGs are standalone, theme-specific, accessible, and support reduced motion', () => {
  const before = JSON.stringify(snapshotPlan);
  for (const theme of ['dark', 'light']) {
    const svg = renderPlan(snapshot, snapshotPlan, theme);
    assert.match(svg, /^<svg id="play-animation" /);
    assert.match(svg, /prefers-reduced-motion:reduce/);
    assert.match(svg, /svg:not\(:target\) \.motion\{animation:none!important;opacity:1!important\}/);
    assert.match(svg, /svg:not\(:target\) \.effect,svg:not\(:target\) \.tardis-wall\{display:none!important\}/);
    const renderedShips = [...svg.matchAll(/data-ship="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(renderedShips.length, 5);
    assert.equal(new Set(renderedShips).size, 5, 'One sprite per type is reused for all repeated crossings.');
    const total = snapshot.days.reduce((sum, day) => sum + day.count, 0);
    assert.ok(svg.includes(`${total.toLocaleString('en-US')} CONTRIBUTIONS`));
    assert.match(svg, /role="img" aria-labelledby="title desc"/);
    assert.match(svg, /data-ship="scout"/);
    assert.match(svg, /data-ship="cruiser"/);
    assert.match(svg, /data-ship="discovery"/);
    assert.match(svg, /data-ship="tardis"/);
    assert.match(svg, /TARDIS blue police box/);
    assert.match(svg, /Discovery One-inspired ship/);
    assert.match(svg, /Klingon Bird of Prey/);
    assert.match(svg, /SpaceX Starflight-inspired scout/);
    assert.match(svg, /Enterprise-D-inspired cruiser/);
    const expectedDuration = (snapshotPlan.duration * 2).toFixed(3);
    const animationDurations = [...svg.matchAll(/animation:[\w-]+ ([\d.]+)s linear/g)].map((match) => match[1]);
    assert.ok(animationDurations.length > 0);
    assert.ok(animationDurations.every((seconds) => seconds === expectedDuration));
    assert.doesNotMatch(svg, /<script|<foreignObject|<image|href=|NaN|undefined/);
    const still = renderPlan(snapshot, snapshotPlan, theme, false);
    assert.equal([...still.matchAll(/data-ship=/g)].length, 5);
    assert.doesNotMatch(still, /@keyframes|style="animation:/, 'The static fallback cannot animate, even with the play fragment.');
    assert.ok(still.length < svg.length);
  }
  assert.equal(JSON.stringify(snapshotPlan), before, 'Theme and motion variants must reuse the plan without mutation.');
});

test('[SVG-02] an empty contribution year renders without shots or invalid coordinates', () => {
  const calendar = fixture();
  calendar.days.forEach((day) => { day.count = 0; day.level = 0; });
  const svg = renderStarship(calendar);
  assert.match(svg, /0 CONTRIBUTIONS/);
  assert.doesNotMatch(svg, /NaN|undefined|data-weapon=/);
});

test('[SVG-03] every TARDIS wall shares one clipped visibility owner across re-entry', () => {
  const svg = renderPlan(snapshot, snapshotPlan);
  assert.equal([...svg.matchAll(/data-ship="tardis"/g)].length, 1);
  assert.equal([...svg.matchAll(/data-visible-ship="tardis"/g)].length, 1);
  assert.equal([...svg.matchAll(/aria-label="TARDIS blue police box"/g)].length, 1);
  assert.match(svg, /data-visible-ship="tardis" visibility="hidden" clip-path="url\(#tardis-hull-clip\)"/);
  const initial = snapshotPlan.ships.find((ship) => ship.id === 'tardis').positions[0];
  assert.ok(svg.includes(`@keyframes flight-tardis-4{0%{transform:translate(${initial.x}px,${initial.y}px)`));
  const pct = (time) => `${(time / snapshotPlan.duration * 100).toFixed(4)}%`;
  for (const crossing of snapshotPlan.fleetFlights.filter((flight) => flight.id === 'tardis' && flight.startAt < snapshotPlan.reset - 0.3)) {
    const end = Math.min(crossing.exitAt, snapshotPlan.reset - 0.3);
    assert.ok(svg.includes(`${pct(crossing.startAt)}{opacity:0;visibility:hidden}`));
    assert.ok(svg.includes(`${pct(end + 0.25)}{opacity:0;visibility:hidden}`));
  }
  assert.match(svg, /svg:not\(:target\) \.tardis-visibility\{visibility:visible!important\}/, 'Reduced-motion mode still displays one static box until playback is selected.');
});

test('[SVG-04] a blocked TARDIS with no travel stays invisible instead of flashing at the entrance', () => {
  const tardis = snapshotPlan.ships.find((ship) => ship.id === 'tardis');
  const blocked = { ...tardis, exitAt: tardis.startAt, positions: [tardis.positions[0]], cycles: [] };
  const plan = { ...snapshotPlan, ships: snapshotPlan.ships.map((ship) => ship.id === 'tardis' ? blocked : ship),
    fleetFlights: [...snapshotPlan.fleetFlights.filter((ship) => ship.id !== 'tardis'), blocked] };
  const svg = renderPlan(snapshot, plan);
  assert.match(svg, /@keyframes visibility-tardis-4\{0%\{opacity:0;visibility:hidden\}100%\{opacity:0;visibility:hidden\}\}/);
  assert.equal([...svg.matchAll(/data-ship="tardis"/g)].length, 1);
  assert.doesNotMatch(svg, /NaN|undefined/);
});
