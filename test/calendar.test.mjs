// The public-data contract: retained data, parser inputs, and rejection paths.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseCalendar, validateCalendar } from '../src/starship/calendar.mjs';

const snapshot = JSON.parse(await readFile(new URL('../data/contributions.json', import.meta.url), 'utf8'));
/** Give each test its own mutable calendar while preserving the retained snapshot. */
const fixture = () => structuredClone(snapshot);

/** Build a complete calendar, optionally replacing one tooltip at the input boundary. */
function calendarHtml(days, firstLabel) {
  return days.map((day, i) => {
    const label = i === 0 && firstLabel !== undefined ? firstLabel
      : `${day.count === 0 ? 'No' : day.count.toLocaleString('en-US')} contribution${day.count === 1 ? '' : 's'} on January 1st.`;
    return `<td data-level="${day.level}" id="day-${i}" data-date="${day.date}"></td><tool-tip for="day-${i}">${label}</tool-tip>`;
  }).join('');
}

test('[DATA-01] retained public snapshot is complete and internally consistent', () => {
  const calendar = validateCalendar(fixture());
  assert.ok(calendar.days.length >= 365 && calendar.days.length <= 372);
  assert.equal(new Set(calendar.days.map((day) => day.date)).size, calendar.days.length);
});

test('[DATA-02] parser accepts real calendar cell/tooltip markup and counts, independent of attribute order', () => {
  const html = calendarHtml(snapshot.days);
  assert.deepEqual(parseCalendar(html, snapshot.username, snapshot.fetchedAt).days, snapshot.days);
  assert.throws(() => parseCalendar(html.replace('for="day-0"', 'for="missing"'), snapshot.username), /Missing contribution count/);
  assert.throws(() => parseCalendar('<h1>Sign in</h1>', snapshot.username), /complete annual/);
});

test('[DATA-03] invalid data fails closed instead of fabricating a calendar', () => {
  for (const change of [
    (c) => { c.days[1].date = c.days[0].date; },
    (c) => { c.days[0].count = -1; },
    (c) => { c.days[0].level = 9; },
    (c) => { c.days[0].date = '2025-02-30'; },
    (c) => { c.username = '<script>'; },
    (c) => { c.fetchedAt = ''; },
  ]) {
    const calendar = fixture();
    change(calendar);
    assert.throws(() => validateCalendar(calendar));
  }
});

test('[DATA-04] snapshot timestamps are ISO strings with a real date and timezone', () => {
  for (const fetchedAt of [0, 123, ['2026-09-08'], '(</text>) 2026-09-08',
    '2026-02-30T12:00:00Z', '2026-09-08', '2026-09-08T12:00:00']) {
    assert.throws(() => validateCalendar({ ...fixture(), fetchedAt }), /ISO snapshot timestamp/);
  }
  for (const fetchedAt of ['2026-09-08T12:00:00Z', '2026-09-08T12:00:00.123Z', '2026-09-08T12:00:00+02:00']) {
    assert.equal(validateCalendar({ ...fixture(), fetchedAt }).fetchedAt, fetchedAt);
  }
});

test('[DATA-05] counts and their annual total remain exact safe integers', () => {
  const calendar = fixture();
  calendar.days[0] = { ...calendar.days[0], level: 4, count: 1e308 };
  assert.throws(() => validateCalendar(calendar), /Invalid contribution value/);
  calendar.days[0].count = Number.MAX_SAFE_INTEGER;
  assert.throws(() => validateCalendar(calendar), /Contribution total/);
});

test('[DATA-06] tooltip markup is rejected instead of stripped into a valid count', () => {
  const calendar = fixture();
  calendar.days[0] = { ...calendar.days[0], count: 1, level: 1 };
  for (const label of [
    '<script>1 contribution on January 1st.</script>',
    '1<script>2</script> contributions on January 1st.',
    '1<img src=x onerror=alert(1)>2 contributions on January 1st.',
    '1<!-- hidden -->2 contributions on January 1st.',
    '1 contribution on January 1st.<script',
    '1 contribution on January 1st.<ScRiPt>alert(1)</ScRiPt>',
    '1 contribution on January 1st.<scr<script>ipt>',
    '1 contribution on January 1st.&lt;script&gt;',
    '1 contribution on January 1st.&#60;script&#62;',
    '1 contribution on January 1st.&#x3c;script&#x3e;',
  ]) {
    assert.throws(() => parseCalendar(calendarHtml(calendar.days, label), calendar.username), /Missing contribution count/, label);
  }
});

test('[DATA-07] plain tooltip labels preserve zero, singular, plural and grouped counts', () => {
  for (const [count, label] of [
    [0, 'No contributions on January 1st.'],
    [1, '1 contribution on January 1st.'],
    [12, '12 contributions on January 1st.'],
    [1234, '1234 contributions on January 1st.'],
    [1234, '1,234 contributions on January 1st.'],
    [1234567, '\n  1,234,567 contributions on January 1st.\n'],
  ]) {
    const calendar = fixture();
    calendar.days[0] = { ...calendar.days[0], count, level: count === 0 ? 0 : 1 };
    assert.deepEqual(parseCalendar(calendarHtml(calendar.days, label), calendar.username, calendar.fetchedAt), calendar);
  }
});
