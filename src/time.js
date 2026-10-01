// Pacific-time date math. Dates travel as 'YYYY-MM-DD' strings; the only
// Date object we ever read is in pacificNow, and we read it through Intl so
// DST and the viewer's own timezone never matter.

const TZ = 'America/Los_Angeles';

/** Minutes after local midnight when MBE is considered finished (12:05). */
export const SHOW_END_MINUTES = 12 * 60 + 5;

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
});

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * The wall clock in Los Angeles for a given instant.
 * @param {Date} now
 * @returns {{ date: string, weekday: number, minutes: number }}
 */
export function pacificNow(now = new Date()) {
  const parts = {};
  for (const { type, value } of partsFormatter.formatToParts(now)) {
    parts[type] = value;
  }
  // Some engines render hour 0 as "24" even with h23; normalise.
  const hour = Number(parts.hour) % 24;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAY_INDEX[parts.weekday],
    minutes: hour * 60 + Number(parts.minute),
  };
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for 'YYYY-MM-DD' strings naming a real calendar date. */
export function isValidDate(str) {
  if (typeof str !== 'string') return false;
  const m = DATE_RE.exec(str);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function toUtcDate(dateStr) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d));
}

function fromUtcDate(dt) {
  const y = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

/** 0 = Sunday … 6 = Saturday, from the calendar date alone. */
export function weekdayOf(dateStr) {
  return toUtcDate(dateStr).getUTCDay();
}

export function isWeekday(dateStr) {
  const w = weekdayOf(dateStr);
  return w >= 1 && w <= 5;
}

export function addDays(dateStr, n) {
  const dt = toUtcDate(dateStr);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fromUtcDate(dt);
}

/** The closest Mon–Fri strictly before dateStr. */
export function prevWeekday(dateStr) {
  let d = addDays(dateStr, -1);
  while (!isWeekday(d)) d = addDays(d, -1);
  return d;
}

/** The closest Mon–Fri strictly after dateStr. */
export function nextWeekday(dateStr) {
  let d = addDays(dateStr, 1);
  while (!isWeekday(d)) d = addDays(d, 1);
  return d;
}

/** Most recent MBE show that has finished airing, as of `now`. */
export function latestShowDate(now = new Date()) {
  const p = pacificNow(now);
  const todayIsWeekday = p.weekday >= 1 && p.weekday <= 5;
  if (todayIsWeekday && p.minutes >= SHOW_END_MINUTES) return p.date;
  return prevWeekday(p.date);
}

/**
 * Turn whatever came out of the URL into a date we can show:
 * invalid or future → latest; weekend → preceding Friday.
 */
export function clampShowDate(candidate, now = new Date()) {
  const latest = latestShowDate(now);
  if (!isValidDate(candidate)) return latest;
  if (candidate > latest) return latest; // ISO strings compare lexically
  if (!isWeekday(candidate)) return prevWeekday(candidate);
  return candidate;
}

const longFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

/** 'Wed, Sep 30, 2026' */
export function formatLong(dateStr) {
  return longFormatter.format(toUtcDate(dateStr));
}
