import { DAY } from './config.mjs';

/** Parse an actual ISO day, rejecting Date.parse's rollover of impossible dates. */
function isoDayTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : NaN;
}

/**
 * Read the double-quoted attributes used by GitHub contribution cells and tooltips.
 */
function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
}

/**
 * Parse GitHub public-calendar HTML into a validated, date-ordered snapshot.
 * Counts come from tooltips; levels come from cells. Missing counts fail generation
 * so a markup change cannot silently turn real activity into zero activity.
 * @param {string} html Public contribution-calendar response, fetched in English.
 * @returns {object} Validated snapshot containing username, source, fetchedAt and days.
 */
export function parseCalendar(html, username, fetchedAt = new Date().toISOString()) {
  const tooltips = new Map([...html.matchAll(/<tool-tip\b([^>]*)>([\s\S]*?)<\/tool-tip>/g)].map((match) => [attributes(match[1]).for, match[2].trim()]));
  const days = [...html.matchAll(/<td\b[^>]*data-date="[^"]*"[^>]*>/g)].map(([tag]) => {
    const attrs = attributes(tag);
    const label = tooltips.get(attrs.id) ?? '';
    // GitHub emits plain text. Stripping tags can join digits or leave markup behind.
    const count = label.match(/^(No|[\d,]+) contributions? on [^<>&\r\n]+$/);
    if (!count) throw new Error(`Missing contribution count for ${attrs['data-date']}; GitHub markup may have changed.`);
    return { date: attrs['data-date'], count: count[1] === 'No' ? 0 : Number(count[1].replaceAll(',', '')), level: Number(attrs['data-level']) };
  }).sort((a, b) => a.date.localeCompare(b.date));
  return validateCalendar({ username, fetchedAt, source: `https://github.com/users/${username}/contributions`, days });
}

/**
 * Validate an annual snapshot without changing it; return the same object.
 * Reject invalid values, duplicate/missing dates, and impossible calendar dates.
 * Both downloaded HTML and retained JSON pass through this data contract.
 */
export function validateCalendar(calendar) {
  if (!calendar || typeof calendar.username !== 'string' || !/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(calendar.username)) throw new Error('Invalid GitHub username.');
  if (typeof calendar.fetchedAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(calendar.fetchedAt)
    || !Number.isFinite(isoDayTimestamp(calendar.fetchedAt.slice(0, 10)))
    || !Number.isFinite(Date.parse(calendar.fetchedAt))) throw new Error('Missing or invalid ISO snapshot timestamp.');
  if (!Array.isArray(calendar.days) || calendar.days.length < 365 || calendar.days.length > 372) throw new Error('Expected a complete annual contribution calendar (365–372 days).');
  calendar.days.forEach((day, i) => {
    const timestamp = isoDayTimestamp(day?.date);
    if (!Number.isFinite(timestamp)) throw new Error('Invalid contribution date.');
    if (!Number.isSafeInteger(day.count) || day.count < 0 || !Number.isInteger(day.level) || day.level < 0 || day.level > 4 || (day.count === 0) !== (day.level === 0)) throw new Error(`Invalid contribution value on ${day.date}.`);
    if (i && timestamp - Date.parse(`${calendar.days[i - 1].date}T00:00:00Z`) !== DAY) throw new Error('Calendar dates must be contiguous and unique.');
  });
  if (!Number.isSafeInteger(calendar.days.reduce((total, day) => total + day.count, 0))) throw new Error('Contribution total exceeds the safe integer range.');
  return calendar;
}
