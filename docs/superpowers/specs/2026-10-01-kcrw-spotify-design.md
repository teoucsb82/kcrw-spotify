# kcrw-spotify — design

Date: 2026-10-01
Status: approved in conversation, awaiting spec review
Supersedes: the Cloudflare Worker + OAuth design drafted earlier today.

## Goal

A free web page that shows the tracklist of KCRW's Morning Becomes Eclectic
(MBE) for a day and lets anyone copy the Spotify track links in one click,
then paste them into a playlist in the Spotify desktop app.

Replaces the 2019–2021 Rails app `teoucsb82/PublicRadioPlaylists`, which
created playlists through the Spotify Web API.

## Why not the API

- Spotify Development Mode (since 2026-03-09): max 5 allowlisted users, every
  user and the app owner must hold Premium. Extended quota is
  organisations-only (250k MAU). Teo and his friend are on free accounts.
- Spotify desktop accepts a multi-line paste of track links into a playlist.
  Teo confirmed this works for him.
- KCRW's tracklist API returns a `spotify_id` per track and sends
  `Access-Control-Allow-Origin: *`, so a browser can call it directly.

Result: no backend, no auth, no database, no cost.

## Constraints

- Cost: $0. GitHub Pages on `teoucsb82/kcrw-spotify`.
- No build step. Plain HTML, CSS, JS modules. Nothing to install to deploy.
- Works on a phone (read the list) and on desktop (copy + paste).
- Honest about gaps: tracks without a `spotify_id` are shown but marked
  "not on Spotify".

## Non-goals (v1)

- Automatic playlist creation in anyone's account.
- Other programs. Per-user settings. Accounts of any kind.
- Server-side caching, cron, notifications.
- Custom domain.

## User flow

1. Open `https://teoucsb82.github.io/kcrw-spotify/`.
2. Page shows the most recent finished MBE show (weekday, after 12:00 PT).
   Header: "Morning Becomes Eclectic — Wed Sep 30, 2026 — host".
3. Click **Copy 18 tracks for Spotify**. Button text changes to
   "Copied — paste into a Spotify playlist (Cmd+V)".
4. In Spotify desktop: New playlist → Cmd+V. Done.
5. ◀ ▶ arrows or a date input move between shows. URL hash
   (`#2026-09-30`) keeps the date shareable.

## Architecture

```
index.html        shell, styles, mounts app
src/app.js        DOM: render header, list, copy button, date nav; reads hash
src/mbe.js        pure: KCRW URL for a date, filter/dedupe/sort tracks,
                  copy text, playlist name
src/time.js       pure: today in Pacific, latest finished show date,
                  prev/next weekday, DST-safe
test/*.test.js    vitest for mbe.js and time.js
```

`app.js` is the only file that touches `document`, `fetch`, `navigator`.
`mbe.js` and `time.js` take plain inputs and return plain values.

### KCRW request

`https://tracklist-api.kcrw.com/Simulcast/date/YYYY/MM/DD?time=09%3A00`

Response: array of rows. Keep rows where
`program_title === "Morning Becomes Eclectic"`. Dedupe by `spotify_id`
(first occurrence wins). Sort by `datetime` ascending. Rows with empty
`spotify_id` stay in the display list, flagged, and are excluded from the
copy text.

### Copy text

Newline-separated `https://open.spotify.com/track/<id>`, chronological.
Written with `navigator.clipboard.writeText`. Fallback: a visible
`<textarea>` with the text selected, so the user can Cmd+C on browsers that
block clipboard writes.

### Date rules (`time.js`)

- "Now in Pacific" via `Intl.DateTimeFormat('en-US', { timeZone:
  'America/Los_Angeles', ... })`. No hardcoded offsets.
- Latest finished show: today if Mon–Fri and PT time ≥ 12:05, else the
  previous weekday.
- Prev/next skip weekends. Next is disabled when it would pass the latest
  finished show. Prev has no floor (KCRW's archive goes back years).

### States

- Loading: header with date, "Loading…".
- Empty: 0 MBE rows → "No tracklist for this date yet. KCRW usually posts
  within the hour." Copy button hidden.
- Error: fetch failed → message with a Retry button.
- Partial: N tracks, M without Spotify → button says "Copy N tracks", a
  line under the list says "M tracks aren't on Spotify".

## Testing

Vitest, `npm test`. Pure modules only; no DOM tests in v1.

`mbe.js`
- builds the KCRW URL with zero-padded month/day
- drops non-MBE rows, dedupes by id, keeps chronological order
- separates tracks with and without `spotify_id`
- copy text is one link per line, no trailing newline

`time.js`
- latest finished show on: a weekday morning (→ previous weekday), a weekday
  afternoon (→ today), Saturday (→ Friday), Monday 11:00 PT (→ Friday)
- DST boundary days (2026-03-08, 2026-11-01) resolve to the right PT date
- prev/next weekday across a weekend

Manual check before first release: copy from the page, paste into a Spotify
desktop playlist, count matches.

## Deployment

- GitHub repo `teoucsb82/kcrw-spotify` (personal account, not leaserooster).
- GitHub Pages, branch `main`, folder `/` (root). Enabled once in repo
  settings.
- Every push to `main` is live within a minute. No CI needed for deploy.
- Optional: a GitHub Action running `npm test` on push.

## Follow-ups (not v1)

- Other KCRW programs (one constant per program; a program picker).
- "Open in Spotify" per-track links in the list (cheap, maybe v1.1).
- Custom domain.
