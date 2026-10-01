# kcrw-spotify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static GitHub Pages site that shows a day's KCRW Morning Becomes Eclectic tracklist and copies the Spotify track links to the clipboard in one click.

**Architecture:** One `index.html` loads `src/app.js` as an ES module. `app.js` is the only file that touches the DOM, `fetch`, or the clipboard. Two pure modules do the thinking: `src/time.js` (Pacific-time date math) and `src/mbe.js` (KCRW URL, track filtering, copy text). Tests cover only the pure modules.

**Tech Stack:** Plain HTML/CSS/JS (ES modules, no build step). Vitest for tests. GitHub Pages for hosting. `gh` CLI for repo setup.

**Spec:** `docs/superpowers/specs/2026-10-01-kcrw-spotify-design.md`

## Global Constraints

- Cost: $0. No servers, no paid services. Hosting is GitHub Pages from `main`, root folder.
- No build step. The repo as committed is what GitHub Pages serves. `node_modules/` is never committed.
- GitHub owner is `teoucsb82` (personal account), never `leaserooster`. Check `gh auth status` before creating the repo.
- Program constant: `Morning Becomes Eclectic`. KCRW request time: `09:00`.
- "Finished airing" means Pacific time ≥ 12:05 on a Mon–Fri.
- Timezone math uses `Intl.DateTimeFormat` with `America/Los_Angeles`. No hardcoded UTC offsets anywhere.
- Copy text is `https://open.spotify.com/track/<id>` lines joined by `\n`, chronological, no trailing newline.
- Tracks without a `spotify_id` are displayed, flagged "not on Spotify", and excluded from copy text.
- Node ≥ 20 for running tests locally (PATH node is v20; fine).

## Review Focus

Inputs the spec implies but did not spell out. Each has a test pinned to the owning task.

1. **KCRW returns a non-array body** (HTML error page, `null`, an object). `parseTracks` must throw a clear `TypeError`, and `app.js` must show the error state, not a blank page. → Task 3, test `throws on non-array input`.
2. **URL hash is garbage, a weekend, or a future date** (`#foo`, `#2026-10-03`, `#2030-01-01`). The page must land on a real show date, never fetch a weekend, never show "next" past the latest finished show. → Task 2, `clampShowDate` tests.
3. **A row has a `spotify_id` but no `datetime`** or rows arrive out of order. Sort must be stable and never crash on missing fields. → Task 3, test `keeps original order for rows without datetime`.
4. **The same song is played twice in a show.** Copy text must contain it once, at its first play. → Task 3, test `dedupes by spotify_id keeping first play`.
5. **Clipboard write is blocked** (Safari without user gesture, permissions denied, `navigator.clipboard` undefined over `http://` on a LAN). Page must fall back to a visible, pre-selected textarea. → Task 5, manual check listed in its final step; code path is explicit in `copyToClipboard`.

---

## File Structure

| path | responsibility |
|---|---|
| `package.json` | `"type": "module"`, vitest devDependency, `npm test` |
| `.gitignore` | `node_modules/` |
| `.nojekyll` | tells GitHub Pages to serve files verbatim |
| `index.html` | page shell, CSS, mounts `src/app.js` |
| `src/time.js` | pure: Pacific "now", weekday math, latest finished show date, clamping, long date format |
| `src/mbe.js` | pure: KCRW URL for a date, parse/filter/dedupe/sort rows, copy text, playlist name |
| `src/app.js` | DOM rendering, fetch, hash routing, clipboard with fallback |
| `test/time.test.js` | vitest for `src/time.js` |
| `test/mbe.test.js` | vitest for `src/mbe.js` |
| `README.md` | what it is, how to use it, how to run tests |
| `.github/workflows/test.yml` | runs `npm test` on push and PR |

---

### Task 1: Project scaffold with a passing smoke test

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.nojekyll`
- Create: `test/smoke.test.js` (deleted again in Task 2)

**Interfaces:**
- Produces: `npm test` runs vitest in `test/`.

- [ ] **Step 1: Write package.json**

```json
{
  "name": "kcrw-spotify",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "KCRW Morning Becomes Eclectic tracklists, one click to copy into a Spotify playlist",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 2: Write .gitignore and .nojekyll**

`.gitignore`:
```
node_modules/
.DS_Store
```

`.nojekyll` is an empty file:
```bash
touch .nojekyll
```

- [ ] **Step 3: Write a smoke test**

`test/smoke.test.js`:
```js
import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 4: Install and run**

Run: `npm install && npm test`
Expected: `1 passed`. A `package-lock.json` appears; commit it.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore .nojekyll test/smoke.test.js
git commit -m "chore: scaffold with vitest"
```

---

### Task 2: `src/time.js` — Pacific-time date math

**Files:**
- Create: `src/time.js`
- Create: `test/time.test.js`
- Delete: `test/smoke.test.js`

**Interfaces:**
- Produces (all exported from `src/time.js`):
  - `pacificNow(now = new Date()) → { date: 'YYYY-MM-DD', weekday: 0..6, minutes: 0..1439 }` — the wall clock in Los Angeles. `weekday` 0 = Sunday. `minutes` = minutes since local midnight.
  - `isValidDate(str) → boolean` — `YYYY-MM-DD` and a real calendar date.
  - `weekdayOf(dateStr) → 0..6`
  - `isWeekday(dateStr) → boolean` — Mon–Fri.
  - `addDays(dateStr, n) → 'YYYY-MM-DD'`
  - `prevWeekday(dateStr) → 'YYYY-MM-DD'` — strictly before.
  - `nextWeekday(dateStr) → 'YYYY-MM-DD'` — strictly after.
  - `latestShowDate(now = new Date()) → 'YYYY-MM-DD'` — today if weekday and `minutes >= 725` (12:05), else `prevWeekday(today)`.
  - `clampShowDate(candidate, now = new Date()) → 'YYYY-MM-DD'` — invalid or later than latest → latest; weekend → `prevWeekday`; otherwise unchanged.
  - `formatLong(dateStr) → 'Wed, Sep 30, 2026'`
  - `SHOW_END_MINUTES = 725`

Dates as strings avoid every timezone trap: the only place a `Date` object is read is `pacificNow`, and it reads it through `Intl`.

- [ ] **Step 1: Delete the smoke test**

```bash
git rm test/smoke.test.js
```

- [ ] **Step 2: Write the failing tests**

`test/time.test.js`:
```js
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, `Failed to load url ../src/time.js` (module missing).

- [ ] **Step 4: Implement `src/time.js`**

```js
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: all `time.test.js` tests PASS. If `pacificNow` DST tests fail, confirm Node has full ICU: `node -e "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone, process.versions.icu)"` — any Node ≥ 13 ships full ICU.

- [ ] **Step 6: Commit**

```bash
git add src/time.js test/time.test.js
git commit -m "feat(time): Pacific-time show date math"
```

---

### Task 3: `src/mbe.js` — KCRW URL, track parsing, copy text

**Files:**
- Create: `src/mbe.js`
- Create: `test/mbe.test.js`

**Interfaces:**
- Consumes: nothing from other modules.
- Produces (exported from `src/mbe.js`):
  - `PROGRAM = 'Morning Becomes Eclectic'`
  - `SHOW_TIME = '09:00'`
  - `kcrwUrl(dateStr) → string` — `https://tracklist-api.kcrw.com/Simulcast/date/YYYY/MM/DD?time=09%3A00`
  - `parseTracks(rows) → { onSpotify: Track[], offSpotify: Track[], host: string|null }`
    - `Track = { spotifyId: string|null, artist: string, title: string, album: string, albumImage: string|null, time: string, datetime: string|null }`
    - throws `TypeError('KCRW response was not an array')` for non-arrays
  - `copyText(tracks) → string` — one `https://open.spotify.com/track/<id>` per line, `\n` joined, no trailing newline
  - `playlistName(dateStr) → 'KCRW MBE 2026-09-30'`

KCRW row fields used: `program_title`, `host`, `artist`, `title`, `album`, `albumImage`, `albumImageLarge`, `time`, `datetime`, `spotify_id`. Verified live 2026-10-01.

- [ ] **Step 1: Write the failing tests**

`test/mbe.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { PROGRAM, SHOW_TIME, kcrwUrl, parseTracks, copyText, playlistName } from '../src/mbe.js';

const row = (over = {}) => ({
  program_title: PROGRAM,
  host: 'Novena Carmel',
  artist: 'Minyo Crusaders',
  title: 'Hanagasa Ondo',
  album: 'Hanagasa Ondo',
  albumImage: 'https://img/small.jpg',
  albumImageLarge: 'https://img/large.jpg',
  time: '11:53 AM',
  datetime: '2026-09-30T11:53:42-07:00',
  spotify_id: '4X0RMkxgKiWmGYY1UrXLkS',
  ...over,
});

describe('constants', () => {
  it('names the program and show time', () => {
    expect(PROGRAM).toBe('Morning Becomes Eclectic');
    expect(SHOW_TIME).toBe('09:00');
  });
});

describe('kcrwUrl', () => {
  it('builds the Simulcast URL with zero-padded month and day', () => {
    expect(kcrwUrl('2026-09-30')).toBe(
      'https://tracklist-api.kcrw.com/Simulcast/date/2026/09/30?time=09%3A00',
    );
    expect(kcrwUrl('2026-01-05')).toBe(
      'https://tracklist-api.kcrw.com/Simulcast/date/2026/01/05?time=09%3A00',
    );
  });
});

describe('parseTracks', () => {
  it('throws on non-array input', () => {
    expect(() => parseTracks(null)).toThrow(TypeError);
    expect(() => parseTracks({})).toThrow(/not an array/);
    expect(() => parseTracks('<html>')).toThrow(TypeError);
  });

  it('returns empty lists and null host for an empty array', () => {
    expect(parseTracks([])).toEqual({ onSpotify: [], offSpotify: [], host: null });
  });

  it('keeps only rows for the program', () => {
    const out = parseTracks([
      row({ spotify_id: 'a' }),
      row({ program_title: 'Garth Trinidad', spotify_id: 'b' }),
    ]);
    expect(out.onSpotify.map((t) => t.spotifyId)).toEqual(['a']);
  });

  it('maps row fields to Track fields', () => {
    const [t] = parseTracks([row()]).onSpotify;
    expect(t).toEqual({
      spotifyId: '4X0RMkxgKiWmGYY1UrXLkS',
      artist: 'Minyo Crusaders',
      title: 'Hanagasa Ondo',
      album: 'Hanagasa Ondo',
      albumImage: 'https://img/small.jpg',
      time: '11:53 AM',
      datetime: '2026-09-30T11:53:42-07:00',
    });
  });

  it('falls back to albumImageLarge, then null', () => {
    const [a] = parseTracks([row({ albumImage: '' })]).onSpotify;
    expect(a.albumImage).toBe('https://img/large.jpg');
    const [b] = parseTracks([row({ albumImage: '', albumImageLarge: '' })]).onSpotify;
    expect(b.albumImage).toBeNull();
  });

  it('separates tracks without a spotify_id', () => {
    const out = parseTracks([
      row({ spotify_id: 'a' }),
      row({ spotify_id: '', title: 'Rare B-side' }),
      row({ spotify_id: null, title: 'Live cut' }),
    ]);
    expect(out.onSpotify.map((t) => t.spotifyId)).toEqual(['a']);
    expect(out.offSpotify.map((t) => t.title)).toEqual(['Rare B-side', 'Live cut']);
    expect(out.offSpotify[0].spotifyId).toBeNull();
  });

  it('drops rows with no title (station breaks)', () => {
    const out = parseTracks([row({ title: '', artist: 'BREAK', spotify_id: '' })]);
    expect(out.onSpotify).toEqual([]);
    expect(out.offSpotify).toEqual([]);
  });

  it('sorts chronologically by datetime', () => {
    const out = parseTracks([
      row({ spotify_id: 'late', datetime: '2026-09-30T11:00:00-07:00' }),
      row({ spotify_id: 'early', datetime: '2026-09-30T09:05:00-07:00' }),
      row({ spotify_id: 'mid', datetime: '2026-09-30T10:00:00-07:00' }),
    ]);
    expect(out.onSpotify.map((t) => t.spotifyId)).toEqual(['early', 'mid', 'late']);
  });

  it('keeps original order for rows without datetime', () => {
    const out = parseTracks([
      row({ spotify_id: 'x', datetime: null }),
      row({ spotify_id: 'y', datetime: undefined }),
      row({ spotify_id: 'z', datetime: null }),
    ]);
    expect(out.onSpotify.map((t) => t.spotifyId)).toEqual(['x', 'y', 'z']);
    expect(out.onSpotify[0].datetime).toBeNull();
  });

  it('dedupes by spotify_id keeping first play', () => {
    const out = parseTracks([
      row({ spotify_id: 'a', datetime: '2026-09-30T09:05:00-07:00', time: '9:05 AM' }),
      row({ spotify_id: 'b', datetime: '2026-09-30T09:10:00-07:00' }),
      row({ spotify_id: 'a', datetime: '2026-09-30T11:50:00-07:00', time: '11:50 AM' }),
    ]);
    expect(out.onSpotify.map((t) => t.spotifyId)).toEqual(['a', 'b']);
    expect(out.onSpotify[0].time).toBe('9:05 AM');
  });

  it('does not dedupe offSpotify tracks (no id to compare)', () => {
    const out = parseTracks([
      row({ spotify_id: '', title: 'Live cut' }),
      row({ spotify_id: '', title: 'Live cut' }),
    ]);
    expect(out.offSpotify).toHaveLength(2);
  });

  it('reports the host from the first program row', () => {
    const out = parseTracks([
      row({ program_title: 'Other', host: 'Someone Else' }),
      row({ host: 'Novena Carmel' }),
    ]);
    expect(out.host).toBe('Novena Carmel');
  });

  it('tolerates missing optional fields', () => {
    const out = parseTracks([{ program_title: PROGRAM, title: 'Only a title', spotify_id: 'q' }]);
    expect(out.onSpotify[0]).toEqual({
      spotifyId: 'q',
      artist: '',
      title: 'Only a title',
      album: '',
      albumImage: null,
      time: '',
      datetime: null,
    });
  });
});

describe('copyText', () => {
  it('is one open.spotify.com link per line with no trailing newline', () => {
    const tracks = parseTracks([row({ spotify_id: 'a' }), row({ spotify_id: 'b' })]).onSpotify;
    expect(copyText(tracks)).toBe(
      'https://open.spotify.com/track/a\nhttps://open.spotify.com/track/b',
    );
  });
  it('is empty for no tracks', () => {
    expect(copyText([])).toBe('');
  });
});

describe('playlistName', () => {
  it('suggests a name with the date', () => {
    expect(playlistName('2026-09-30')).toBe('KCRW MBE 2026-09-30');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: `mbe.test.js` FAILS to load (`../src/mbe.js` missing); `time.test.js` still passes.

- [ ] **Step 3: Implement `src/mbe.js`**

```js
// Everything about KCRW's tracklist API and what we do with a show's rows.
// Pure: no fetch, no DOM.

export const PROGRAM = 'Morning Becomes Eclectic';
export const SHOW_TIME = '09:00';

const API_BASE = 'https://tracklist-api.kcrw.com/Simulcast/date';

/** @param {string} dateStr 'YYYY-MM-DD' */
export function kcrwUrl(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${API_BASE}/${y}/${m}/${d}?time=${encodeURIComponent(SHOW_TIME)}`;
}

/**
 * @typedef {object} Track
 * @property {string|null} spotifyId
 * @property {string} artist
 * @property {string} title
 * @property {string} album
 * @property {string|null} albumImage
 * @property {string} time       e.g. '11:53 AM'
 * @property {string|null} datetime  ISO 8601 with offset, or null
 */

function str(v) {
  return typeof v === 'string' ? v : '';
}

function toTrack(r) {
  const id = str(r.spotify_id).trim();
  return {
    spotifyId: id || null,
    artist: str(r.artist),
    title: str(r.title),
    album: str(r.album),
    albumImage: str(r.albumImage) || str(r.albumImageLarge) || null,
    time: str(r.time),
    datetime: str(r.datetime) || null,
  };
}

/**
 * Filter a day's rows down to this program, sort chronologically, dedupe
 * by Spotify id, and split by whether Spotify knows the track.
 * @param {unknown} rows the parsed JSON body from kcrwUrl()
 * @returns {{ onSpotify: Track[], offSpotify: Track[], host: string|null }}
 */
export function parseTracks(rows) {
  if (!Array.isArray(rows)) {
    throw new TypeError('KCRW response was not an array');
  }

  const programRows = rows.filter(
    (r) => r && r.program_title === PROGRAM && str(r.title).trim() !== '',
  );

  const host = programRows.length ? str(programRows[0].host) || null : null;

  // Stable sort: rows without datetime keep their relative position and sort
  // before dated rows only if they came first in the input.
  const indexed = programRows.map((r, i) => ({ t: toTrack(r), i }));
  indexed.sort((a, b) => {
    if (a.t.datetime && b.t.datetime) {
      return a.t.datetime < b.t.datetime ? -1 : a.t.datetime > b.t.datetime ? 1 : a.i - b.i;
    }
    return a.i - b.i;
  });

  const seen = new Set();
  const onSpotify = [];
  const offSpotify = [];
  for (const { t } of indexed) {
    if (!t.spotifyId) {
      offSpotify.push(t);
      continue;
    }
    if (seen.has(t.spotifyId)) continue;
    seen.add(t.spotifyId);
    onSpotify.push(t);
  }

  return { onSpotify, offSpotify, host };
}

/** @param {Track[]} tracks */
export function copyText(tracks) {
  return tracks
    .filter((t) => t.spotifyId)
    .map((t) => `https://open.spotify.com/track/${t.spotifyId}`)
    .join('\n');
}

/** Suggested playlist name shown after copying. */
export function playlistName(dateStr) {
  return `KCRW MBE ${dateStr}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all tests in both files PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mbe.js test/mbe.test.js
git commit -m "feat(mbe): parse KCRW tracklist rows and build copy text"
```

---

### Task 4: `index.html` — shell and styles

**Files:**
- Create: `index.html`

**Interfaces:**
- Produces: element ids that `src/app.js` (Task 5) binds to:
  `#program`, `#date-long`, `#host`, `#prev`, `#next`, `#date-input`, `#copy`, `#copy-hint`, `#status`, `#tracks`, `#missing`, `#fallback`, `#fallback-text`.

No tests (static markup). Verified by opening in a browser in Task 5.

- [ ] **Step 1: Write index.html**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>KCRW MBE → Spotify</title>
<meta name="description" content="Today's KCRW Morning Becomes Eclectic tracklist. One click to copy the Spotify links, paste into a playlist.">
<style>
  :root {
    color-scheme: light dark;
    --bg: #fafafa;
    --fg: #111;
    --muted: #666;
    --line: #e2e2e2;
    --accent: #1db954;
    --accent-fg: #fff;
    --warn-bg: #fff7e0;
    --warn-fg: #6b4e00;
    --err-bg: #fde8e8;
    --err-fg: #7a1a1a;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #121212;
      --fg: #eee;
      --muted: #9a9a9a;
      --line: #2a2a2a;
      --warn-bg: #3a2f10;
      --warn-fg: #ffd56b;
      --err-bg: #3a1515;
      --err-fg: #ff9a9a;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 16px;
    background: var(--bg);
    color: var(--fg);
    font: 16px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  main { max-width: 680px; margin: 0 auto; }
  header h1 { font-size: 1.1rem; margin: 0; color: var(--muted); font-weight: 500; }
  header h2 { font-size: 1.6rem; margin: 4px 0 0; }
  header .host { color: var(--muted); margin: 2px 0 0; min-height: 1.4em; }
  nav {
    display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
    margin: 16px 0;
  }
  nav button, nav input[type=date] {
    font: inherit; padding: 8px 12px; border-radius: 8px;
    border: 1px solid var(--line); background: transparent; color: var(--fg);
  }
  nav button:disabled { opacity: .4; cursor: default; }
  nav button:not(:disabled) { cursor: pointer; }
  .copy-row { display: flex; flex-direction: column; gap: 6px; margin: 16px 0; }
  #copy {
    font: inherit; font-weight: 600; font-size: 1.05rem;
    padding: 14px 18px; border: 0; border-radius: 999px;
    background: var(--accent); color: var(--accent-fg); cursor: pointer;
  }
  #copy:disabled { opacity: .5; cursor: default; }
  #copy-hint { color: var(--muted); font-size: .95rem; min-height: 1.4em; }
  #status { padding: 12px 14px; border-radius: 8px; margin: 12px 0; }
  #status[data-kind="loading"] { color: var(--muted); }
  #status[data-kind="empty"] { background: var(--warn-bg); color: var(--warn-fg); }
  #status[data-kind="error"] { background: var(--err-bg); color: var(--err-fg); }
  #status button { font: inherit; margin-left: 8px; cursor: pointer; }
  ol#tracks { list-style: none; padding: 0; margin: 0; }
  ol#tracks li {
    display: grid; grid-template-columns: 48px 1fr auto; gap: 12px;
    align-items: center; padding: 10px 0; border-bottom: 1px solid var(--line);
  }
  ol#tracks img, ol#tracks .noart {
    width: 48px; height: 48px; border-radius: 4px; background: var(--line); object-fit: cover;
  }
  ol#tracks .title { font-weight: 600; }
  ol#tracks .artist { color: var(--muted); }
  ol#tracks .time { color: var(--muted); font-variant-numeric: tabular-nums; font-size: .9rem; }
  ol#tracks li.off { opacity: .55; }
  ol#tracks li.off .title::after { content: " · not on Spotify"; font-weight: 400; color: var(--muted); }
  #missing { color: var(--muted); font-size: .95rem; margin: 12px 0; }
  #fallback { margin: 12px 0; }
  #fallback textarea {
    width: 100%; height: 160px; font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
    padding: 8px; border-radius: 8px; border: 1px solid var(--line);
    background: transparent; color: var(--fg);
  }
  footer { margin: 32px 0 8px; color: var(--muted); font-size: .85rem; }
  footer a { color: inherit; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<main>
  <header>
    <h1 id="program">Morning Becomes Eclectic · KCRW</h1>
    <h2 id="date-long">&nbsp;</h2>
    <p class="host" id="host"></p>
  </header>

  <nav aria-label="Show date">
    <button id="prev" type="button" aria-label="Previous show">◀ Prev</button>
    <input id="date-input" type="date" aria-label="Show date">
    <button id="next" type="button" aria-label="Next show">Next ▶</button>
  </nav>

  <div class="copy-row">
    <button id="copy" type="button" disabled>Copy tracks for Spotify</button>
    <div id="copy-hint"></div>
  </div>

  <div id="status" data-kind="loading" hidden></div>

  <div id="fallback" hidden>
    <p>Your browser blocked the clipboard. Select all below and copy it (Cmd+C / Ctrl+C):</p>
    <textarea id="fallback-text" readonly></textarea>
  </div>

  <ol id="tracks"></ol>
  <p id="missing" hidden></p>

  <footer>
    Then in Spotify desktop: New playlist → click into it → paste (Cmd+V / Ctrl+V).
    Tracklist from <a href="https://www.kcrw.com/music/shows/morning-becomes-eclectic">KCRW</a>.
    Not affiliated with KCRW or Spotify.
  </footer>
</main>
<script type="module" src="./src/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Serve it and confirm it renders**

Run: `npx -y serve -l 5173 .` (or `python3 -m http.server 5173`)
Open `http://localhost:5173/`. Expected: header, nav, a disabled green button, footer. A console 404 for `src/app.js` is fine at this point.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(ui): page shell and styles"
```

---

### Task 5: `src/app.js` — wire it up

**Files:**
- Create: `src/app.js`

**Interfaces:**
- Consumes: from `src/time.js`: `latestShowDate`, `clampShowDate`, `prevWeekday`, `nextWeekday`, `formatLong`. From `src/mbe.js`: `kcrwUrl`, `parseTracks`, `copyText`, `playlistName`. Element ids from Task 4.
- Produces: a working page. No exports.

No unit tests (DOM + fetch + clipboard). Manual checks in Step 3.

- [ ] **Step 1: Write `src/app.js`**

```js
import {
  latestShowDate,
  clampShowDate,
  prevWeekday,
  nextWeekday,
  formatLong,
} from './time.js';
import { kcrwUrl, parseTracks, copyText, playlistName } from './mbe.js';

const $ = (id) => document.getElementById(id);
const el = {
  dateLong: $('date-long'),
  host: $('host'),
  prev: $('prev'),
  next: $('next'),
  dateInput: $('date-input'),
  copy: $('copy'),
  copyHint: $('copy-hint'),
  status: $('status'),
  tracks: $('tracks'),
  missing: $('missing'),
  fallback: $('fallback'),
  fallbackText: $('fallback-text'),
};

let current = { date: null, onSpotify: [], offSpotify: [] };
let requestSeq = 0; // ignore stale fetch results after fast navigation

// ---------- routing ----------

function dateFromHash() {
  return decodeURIComponent(location.hash.replace(/^#/, ''));
}

function goTo(dateStr, { replace = false } = {}) {
  const target = clampShowDate(dateStr);
  if (target !== dateFromHash()) {
    if (replace) history.replaceState(null, '', `#${target}`);
    else location.hash = target; // fires hashchange → load()
    if (replace) load(target);
    return;
  }
  load(target);
}

window.addEventListener('hashchange', () => load(clampShowDate(dateFromHash())));

// ---------- rendering ----------

function setStatus(kind, text, { retry = false } = {}) {
  el.status.hidden = false;
  el.status.dataset.kind = kind;
  el.status.textContent = text;
  if (retry) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Retry';
    b.addEventListener('click', () => load(current.date));
    el.status.appendChild(b);
  }
}

function clearStatus() {
  el.status.hidden = true;
  el.status.textContent = '';
}

function renderHeader(dateStr, host) {
  el.dateLong.textContent = formatLong(dateStr);
  el.host.textContent = host ? `Host: ${host}` : '';
  el.dateInput.value = dateStr;
  el.dateInput.max = latestShowDate();
  el.next.disabled = nextWeekday(dateStr) > latestShowDate();
}

function trackItem(t, off) {
  const li = document.createElement('li');
  if (off) li.classList.add('off');

  if (t.albumImage) {
    const img = document.createElement('img');
    img.src = t.albumImage;
    img.alt = '';
    img.loading = 'lazy';
    li.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.className = 'noart';
    li.appendChild(ph);
  }

  const text = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = t.title;
  const artist = document.createElement('div');
  artist.className = 'artist';
  artist.textContent = t.album ? `${t.artist} · ${t.album}` : t.artist;
  text.append(title, artist);
  li.appendChild(text);

  const time = document.createElement('div');
  time.className = 'time';
  time.textContent = t.time;
  li.appendChild(time);

  return li;
}

function renderTracks({ onSpotify, offSpotify }) {
  el.tracks.replaceChildren();
  // Merge for display in chronological order; parseTracks already sorted each list.
  const all = [...onSpotify.map((t) => [t, false]), ...offSpotify.map((t) => [t, true])];
  all.sort((a, b) => {
    const da = a[0].datetime, db = b[0].datetime;
    if (da && db) return da < db ? -1 : da > db ? 1 : 0;
    return 0;
  });
  for (const [t, off] of all) el.tracks.appendChild(trackItem(t, off));

  const n = onSpotify.length;
  el.copy.disabled = n === 0;
  el.copy.textContent = n === 1 ? 'Copy 1 track for Spotify' : `Copy ${n} tracks for Spotify`;
  el.copyHint.textContent = '';
  el.fallback.hidden = true;

  if (offSpotify.length) {
    el.missing.hidden = false;
    el.missing.textContent =
      offSpotify.length === 1
        ? '1 track isn’t on Spotify and won’t be copied.'
        : `${offSpotify.length} tracks aren’t on Spotify and won’t be copied.`;
  } else {
    el.missing.hidden = true;
  }
}

// ---------- loading ----------

async function load(dateStr) {
  const seq = ++requestSeq;
  current = { date: dateStr, onSpotify: [], offSpotify: [] };
  renderHeader(dateStr, null);
  el.tracks.replaceChildren();
  el.missing.hidden = true;
  el.copy.disabled = true;
  el.copy.textContent = 'Copy tracks for Spotify';
  el.copyHint.textContent = '';
  el.fallback.hidden = true;
  setStatus('loading', 'Loading…');

  let parsed;
  try {
    const res = await fetch(kcrwUrl(dateStr), { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`KCRW responded ${res.status}`);
    parsed = parseTracks(await res.json());
  } catch (err) {
    if (seq !== requestSeq) return;
    setStatus('error', `Couldn’t load the tracklist (${err.message}).`, { retry: true });
    return;
  }
  if (seq !== requestSeq) return;

  current = { date: dateStr, ...parsed };
  renderHeader(dateStr, parsed.host);

  if (parsed.onSpotify.length === 0 && parsed.offSpotify.length === 0) {
    setStatus('empty', 'No tracklist for this date yet. KCRW usually posts within the hour.');
    return;
  }
  clearStatus();
  renderTracks(parsed);
}

// ---------- clipboard ----------

async function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through to textarea */
    }
  }
  return false;
}

el.copy.addEventListener('click', async () => {
  const text = copyText(current.onSpotify);
  if (!text) return;
  const ok = await copyToClipboard(text);
  if (ok) {
    el.fallback.hidden = true;
    el.copyHint.textContent = `Copied. In Spotify: New playlist → paste (Cmd+V). Name it “${playlistName(current.date)}”.`;
    const label = el.copy.textContent;
    el.copy.textContent = 'Copied ✓';
    setTimeout(() => { el.copy.textContent = label; }, 1500);
  } else {
    el.fallback.hidden = false;
    el.fallbackText.value = text;
    el.fallbackText.focus();
    el.fallbackText.select();
    el.copyHint.textContent = 'Clipboard blocked — copy from the box below.';
  }
});

// ---------- nav ----------

el.prev.addEventListener('click', () => goTo(prevWeekday(current.date)));
el.next.addEventListener('click', () => goTo(nextWeekday(current.date)));
el.dateInput.addEventListener('change', () => {
  if (el.dateInput.value) goTo(el.dateInput.value);
});

// ---------- boot ----------

goTo(dateFromHash() || latestShowDate(), { replace: true });
```

- [ ] **Step 2: Serve and smoke-test in a browser**

Run: `npx -y serve -l 5173 .`
Open `http://localhost:5173/`.

Expected:
- Header shows the latest finished weekday, e.g. "Wed, Sep 30, 2026", host filled in after load.
- A list of tracks with art, title, artist · album, time.
- Button reads "Copy N tracks for Spotify" with N ≥ 10 on a normal day.
- "Next" is disabled. "Prev" moves to the previous weekday and updates `#` in the URL.

- [ ] **Step 3: Manual edge checks (Review Focus 2 and 5)**

Each line is a URL to open and what must happen:

| open | expect |
|---|---|
| `/#foo` | hash rewritten to latest show date, tracks load |
| `/#2026-10-03` (Saturday) | hash becomes `2026-10-02` |
| `/#2030-01-01` | hash becomes latest show date |
| `/#2026-09-15` | loads that day; Next enabled |
| `/#2015-01-05` | either tracks or the yellow "No tracklist" box; no red error |
| Toggle Wi-Fi off, click Retry | red error with Retry; Retry works when back online |
| Click Copy | hint says "Copied…", button flashes "Copied ✓" |
| Open over `http://<lan-ip>:5173` (not localhost) and click Copy | textarea fallback appears with links selected |

Then the end-to-end check the spec requires:
1. Click **Copy N tracks for Spotify**.
2. Spotify desktop → New playlist → click into the empty list → Cmd+V.
3. Count: N tracks appear, in show order.

- [ ] **Step 4: Run the test suite one more time**

Run: `npm test`
Expected: all PASS (nothing in this task should change them).

- [ ] **Step 5: Commit**

```bash
git add src/app.js
git commit -m "feat(app): render tracklist, date nav, copy to clipboard"
```

---

### Task 6: README, CI, GitHub repo, Pages

**Files:**
- Create: `README.md`
- Create: `.github/workflows/test.yml`

**Interfaces:**
- Consumes: the whole repo.
- Produces: live site at `https://teoucsb82.github.io/kcrw-spotify/`.

- [ ] **Step 1: Write README.md**

```markdown
# kcrw-spotify

KCRW's *Morning Becomes Eclectic* tracklist for any show day, with one button
that copies the Spotify track links. Paste them into a playlist in the Spotify
desktop app and you have the show.

**Live:** https://teoucsb82.github.io/kcrw-spotify/

## Use it

1. Open the page. It shows the most recent finished show.
2. Click **Copy N tracks for Spotify**.
3. In Spotify desktop: **New playlist** → click into it → **Cmd+V** (Ctrl+V on Windows).
4. Use ◀ ▶ or the date box for other days. The URL hash (`#2026-09-30`) is shareable.

Tracks KCRW couldn't match to Spotify are listed but greyed out and not copied.

## Why not an automatic playlist?

The old version of this ([PublicRadioPlaylists](https://github.com/teoucsb82/PublicRadioPlaylists))
used the Spotify Web API. Since March 2026 Spotify's Development Mode caps an
app at 5 users and requires Premium for every one of them. This page needs no
Spotify account at all on the server side.

## How it works

Static HTML + ES modules, no build. The browser calls KCRW's tracklist API
directly (it allows cross-origin requests and returns a `spotify_id` per track).

- `src/time.js` — Pacific-time date math (what counts as the latest finished show)
- `src/mbe.js` — KCRW URL, row filtering, dedupe, copy text
- `src/app.js` — DOM, fetch, clipboard

## Develop

```bash
npm install
npm test            # vitest on time.js and mbe.js
npx -y serve -l 5173 .   # then open http://localhost:5173/
```

Deploy = push to `main`. GitHub Pages serves the repo root.

## License

MIT. Tracklist data © KCRW. Not affiliated with KCRW or Spotify.
```

- [ ] **Step 2: Write the CI workflow**

`.github/workflows/test.yml`:
```yaml
name: test
on:
  push:
    branches: [main]
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm test
```

- [ ] **Step 3: Commit**

```bash
git add README.md .github/workflows/test.yml
git commit -m "docs: README and CI"
```

- [ ] **Step 4: Create the GitHub repo under the personal account**

Check which account is active first; `gh repo create` follows the active one.

```bash
gh auth status 2>&1 | grep -B1 'Active account: true'
gh auth switch --user teoucsb82
gh repo create teoucsb82/kcrw-spotify --public --source . --remote origin --push \
  --description "KCRW Morning Becomes Eclectic tracklists, one click to copy into a Spotify playlist"
gh auth switch --user leaserooster
```

Expected: `✓ Created repository teoucsb82/kcrw-spotify on GitHub` and a push of `main`.

- [ ] **Step 5: Enable GitHub Pages from main, root**

```bash
gh auth switch --user teoucsb82
gh api --method POST repos/teoucsb82/kcrw-spotify/pages \
  -f "source[branch]=main" -f "source[path]=/"
gh auth switch --user leaserooster
```

Expected: HTTP 201 with `"html_url": "https://teoucsb82.github.io/kcrw-spotify/"`. If it returns 409, Pages is already enabled; that is fine.

- [ ] **Step 6: Verify the live site**

Wait about a minute, then:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://teoucsb82.github.io/kcrw-spotify/
curl -s -o /dev/null -w "%{http_code}\n" https://teoucsb82.github.io/kcrw-spotify/src/app.js
```

Expected: `200` for both. Open the URL in a browser, repeat the copy → paste check from Task 5 Step 3 once against the live site.

- [ ] **Step 7: Confirm CI is green**

```bash
gh run list --repo teoucsb82/kcrw-spotify --limit 1
```

Expected: `completed  success  test`.

---

## Self-review notes

- **Spec coverage:** user flow (Tasks 4–5), KCRW request and filtering (Task 3), copy text and fallback (Tasks 3, 5), date rules (Task 2), states loading/empty/error/partial (Task 5), tests listed in spec (Tasks 2–3), deployment (Task 6), README (Task 6). Spec's "Open in Spotify per-track links" is a listed follow-up, not v1.
- **Type consistency:** `Track` fields (`spotifyId`, `artist`, `title`, `album`, `albumImage`, `time`, `datetime`) are identical in Task 3 implementation, Task 3 tests, and Task 5 rendering. `parseTracks` return shape `{ onSpotify, offSpotify, host }` is used verbatim in Task 5.
- **Review Focus:** each of the five lines names its task and test; item 5 is a manual check because it needs a real browser clipboard.
