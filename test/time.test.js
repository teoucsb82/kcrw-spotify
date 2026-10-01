import { describe, it, expect } from 'vitest';
import {
  pacificNow,
  isValidDate,
  weekdayOf,
  isWeekday,
  addDays,
  prevWeekday,
  nextWeekday,
  latestShowDate,
  clampShowDate,
  formatLong,
  SHOW_END_MINUTES,
} from '../src/time.js';

// Helper: a Date for a given Pacific wall-clock time, built via UTC offset.
// PDT (Mar–Nov) is UTC-7, PST is UTC-8. Tests pass the UTC instant explicitly
// so they never depend on the machine's zone.
const utc = (iso) => new Date(iso);

describe('pacificNow', () => {
  it('converts a UTC instant to the Pacific wall clock during PDT', () => {
    // 2026-09-30T19:00:00Z is 12:00 PDT, Wednesday
    const p = pacificNow(utc('2026-09-30T19:00:00Z'));
    expect(p).toEqual({ date: '2026-09-30', weekday: 3, minutes: 12 * 60 });
  });

  it('converts during PST', () => {
    // 2026-12-02T20:00:00Z is 12:00 PST, Wednesday
    const p = pacificNow(utc('2026-12-02T20:00:00Z'));
    expect(p).toEqual({ date: '2026-12-02', weekday: 3, minutes: 12 * 60 });
  });

  it('rolls the date back when UTC is already tomorrow', () => {
    // 2026-10-02T05:30:00Z is 2026-10-01 22:30 PDT, Thursday
    const p = pacificNow(utc('2026-10-02T05:30:00Z'));
    expect(p).toEqual({ date: '2026-10-01', weekday: 4, minutes: 22 * 60 + 30 });
  });

  it('handles the spring-forward day (2026-03-08)', () => {
    // 2026-03-08T10:30:00Z is 03:30 PDT (clocks jumped from 02:00 to 03:00 at 10:00Z)
    const p = pacificNow(utc('2026-03-08T10:30:00Z'));
    expect(p).toEqual({ date: '2026-03-08', weekday: 0, minutes: 3 * 60 + 30 });
  });

  it('handles the fall-back day (2026-11-01)', () => {
    // 2026-11-01T09:30:00Z is 01:30 PST (second 01:30 of the day)
    const p = pacificNow(utc('2026-11-01T09:30:00Z'));
    expect(p).toEqual({ date: '2026-11-01', weekday: 0, minutes: 90 });
  });

  it('reports midnight as 0 minutes, not 1440', () => {
    // 2026-09-30T07:00:00Z is 00:00 PDT
    const p = pacificNow(utc('2026-09-30T07:00:00Z'));
    expect(p.minutes).toBe(0);
    expect(p.date).toBe('2026-09-30');
  });
});

describe('isValidDate', () => {
  it('accepts real dates', () => {
    expect(isValidDate('2026-09-30')).toBe(true);
    expect(isValidDate('2024-02-29')).toBe(true);
  });
  it('rejects bad shapes and impossible dates', () => {
    expect(isValidDate('foo')).toBe(false);
    expect(isValidDate('2026-9-30')).toBe(false);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('2026-02-30')).toBe(false);
    expect(isValidDate('')).toBe(false);
    expect(isValidDate(undefined)).toBe(false);
  });
});

describe('weekdays', () => {
  it('weekdayOf uses the calendar date, not the machine zone', () => {
    expect(weekdayOf('2026-09-30')).toBe(3); // Wed
    expect(weekdayOf('2026-10-03')).toBe(6); // Sat
    expect(weekdayOf('2026-10-04')).toBe(0); // Sun
  });
  it('isWeekday is true Mon–Fri only', () => {
    expect(isWeekday('2026-09-28')).toBe(true);  // Mon
    expect(isWeekday('2026-10-02')).toBe(true);  // Fri
    expect(isWeekday('2026-10-03')).toBe(false); // Sat
    expect(isWeekday('2026-10-04')).toBe(false); // Sun
  });
  it('addDays crosses month and year boundaries', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('prevWeekday skips weekends', () => {
    expect(prevWeekday('2026-10-05')).toBe('2026-10-02'); // Mon → Fri
    expect(prevWeekday('2026-10-04')).toBe('2026-10-02'); // Sun → Fri
    expect(prevWeekday('2026-10-01')).toBe('2026-09-30'); // Thu → Wed
  });
  it('nextWeekday skips weekends', () => {
    expect(nextWeekday('2026-10-02')).toBe('2026-10-05'); // Fri → Mon
    expect(nextWeekday('2026-10-03')).toBe('2026-10-05'); // Sat → Mon
    expect(nextWeekday('2026-09-30')).toBe('2026-10-01'); // Wed → Thu
  });
});

describe('latestShowDate', () => {
  it('is today on a weekday afternoon', () => {
    // Wed 2026-09-30 12:05 PDT = 19:05Z
    expect(latestShowDate(utc('2026-09-30T19:05:00Z'))).toBe('2026-09-30');
  });
  it('is the previous weekday on a weekday morning', () => {
    // Wed 2026-09-30 11:59 PDT = 18:59Z
    expect(latestShowDate(utc('2026-09-30T18:59:00Z'))).toBe('2026-09-29');
  });
  it('is Friday on a Monday morning', () => {
    // Mon 2026-10-05 11:00 PDT = 18:00Z
    expect(latestShowDate(utc('2026-10-05T18:00:00Z'))).toBe('2026-10-02');
  });
  it('is Friday all weekend', () => {
    expect(latestShowDate(utc('2026-10-03T20:00:00Z'))).toBe('2026-10-02'); // Sat
    expect(latestShowDate(utc('2026-10-04T20:00:00Z'))).toBe('2026-10-02'); // Sun
  });
  it('uses the SHOW_END_MINUTES threshold exactly', () => {
    expect(SHOW_END_MINUTES).toBe(12 * 60 + 5);
    // 12:04 PDT = 19:04Z → yesterday; 12:05 → today
    expect(latestShowDate(utc('2026-09-30T19:04:00Z'))).toBe('2026-09-29');
    expect(latestShowDate(utc('2026-09-30T19:05:00Z'))).toBe('2026-09-30');
  });
});

describe('clampShowDate', () => {
  const now = utc('2026-09-30T20:00:00Z'); // Wed 13:00 PDT → latest is 2026-09-30

  it('returns a valid past weekday unchanged', () => {
    expect(clampShowDate('2026-09-15', now)).toBe('2026-09-15');
  });
  it('returns latest for garbage', () => {
    expect(clampShowDate('foo', now)).toBe('2026-09-30');
    expect(clampShowDate('', now)).toBe('2026-09-30');
    expect(clampShowDate(undefined, now)).toBe('2026-09-30');
  });
  it('returns latest for a future date', () => {
    expect(clampShowDate('2030-01-01', now)).toBe('2026-09-30');
    expect(clampShowDate('2026-10-01', now)).toBe('2026-09-30');
  });
  it('moves a weekend back to the preceding Friday', () => {
    expect(clampShowDate('2026-09-26', now)).toBe('2026-09-25'); // Sat
    expect(clampShowDate('2026-09-27', now)).toBe('2026-09-25'); // Sun
  });
  it('returns latest itself when asked for latest', () => {
    expect(clampShowDate('2026-09-30', now)).toBe('2026-09-30');
  });
});

describe('formatLong', () => {
  it('formats as weekday, short month, day, year', () => {
    expect(formatLong('2026-09-30')).toBe('Wed, Sep 30, 2026');
    expect(formatLong('2026-01-05')).toBe('Mon, Jan 5, 2026');
  });
});
