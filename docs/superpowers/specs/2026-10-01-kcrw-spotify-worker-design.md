# kcrw-spotify — design

Date: 2026-10-01
Status: approved in conversation, awaiting spec review

## Goal

Resurrect the 2019–2021 Rails app `teoucsb82/PublicRadioPlaylists` as a
Cloudflare Worker. Every weekday after KCRW's Morning Becomes Eclectic (MBE)
finishes, create a playlist of that show's tracks in each connected user's
Spotify account.

Users: Teo plus one friend. Hard cap of 5 (Spotify Development Mode). All
users and the app owner must hold Spotify Premium.

## Constraints that shaped this

- Spotify Development Mode (as of 2026-03-09): max 5 allowlisted users, all
  Premium, owner Premium. Extended quota is organisations-only. So no public
  signup; users are allowlisted by email in the Spotify dashboard.
- Spotify refresh tokens expire 6 months after the user's consent, regardless
  of use. Users must re-authorize twice a year.
- Spotify search is capped at 10 results. Not needed: KCRW's tracklist API
  returns a `spotify_id` per track.
- Cloudflare Workers cannot run Rails. The Rails logic that matters is small
  (KCRW fetch, Spotify playlist create, token refresh) and is ported, not
  reused.
- Hosting budget: free. Workers free tier + D1 free tier + Cron Triggers.

## Non-goals (v1)

- Programs other than MBE. Per-user program picks.
- Email or push notification when re-auth is needed.
- "Popular playlists", monthly favourites, admin pages, Devise-style accounts.
- Custom domain (workers.dev subdomain is fine).

## Architecture

One Worker, TypeScript, Hono router, D1 database, one Cron Trigger.

```
Browser ──> Worker (Hono)
              ├─ GET  /                 landing, "Connect Spotify"
              ├─ GET  /auth/login       302 to Spotify authorize
              ├─ GET  /auth/callback    exchange code, upsert user, set cookie
              ├─ GET  /me               status page (needs cookie)
              ├─ POST /auth/logout      clear cookie
              └─ POST /run?date=…       admin: deliver for a date (bearer token)

Cron ───────> scheduled() ──> deliver(today in PT)

deliver(date):
  KCRW tracklist API ──> tracks for MBE on date
  for each active user:
     Spotify token refresh (if expired)
     create playlist, add tracks
     record delivery
```

### Modules (src/)

| file | responsibility | depends on |
|---|---|---|
| `index.ts` | Hono app, routes, `scheduled` export | everything below |
| `kcrw.ts` | fetch + parse KCRW tracklist for a date; filter to MBE; dedupe | fetch |
| `spotify.ts` | OAuth URL, code exchange, token refresh, create playlist, add tracks | fetch, env secrets |
| `deliver.ts` | orchestrates one delivery run for a date across users | kcrw, spotify, db |
| `db.ts` | typed D1 queries: users, deliveries | D1 binding |
| `time.ts` | Pacific-time date math: today-in-PT, has MBE finished, is weekday | Intl |
| `session.ts` | HMAC-signed cookie with spotify_user_id | SESSION_SECRET |
| `pages.ts` | HTML strings for `/` and `/me` | none |

Each module exports plain functions taking explicit inputs (env, date,
user). No module reads globals.

## Data model (D1)

```sql
CREATE TABLE users (
  spotify_user_id   TEXT PRIMARY KEY,
  display_name      TEXT,
  refresh_token     TEXT NOT NULL,
  access_token      TEXT NOT NULL,
  access_expires_at INTEGER NOT NULL,   -- unix seconds
  consent_at        INTEGER NOT NULL,   -- unix seconds; refresh token dies ~6 months after
  status            TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'needs_reauth'
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE deliveries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  spotify_user_id TEXT NOT NULL REFERENCES users(spotify_user_id),
  show_date       TEXT NOT NULL,        -- 'YYYY-MM-DD' in Pacific time
  playlist_id     TEXT NOT NULL,
  track_count     INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  UNIQUE (spotify_user_id, show_date)
);
```

Re-authorizing overwrites the user row (new tokens, new `consent_at`,
status back to `active`).

## Flows

### Connect / re-authorize

1. `/auth/login` builds the Spotify authorize URL with scopes
   `playlist-modify-public playlist-modify-private`, a random `state` stored
   in a short-lived cookie, and redirect URI `<origin>/auth/callback`.
2. `/auth/callback` verifies `state`, exchanges the code, calls `GET /v1/me`
   for id and display name, upserts the user, sets the session cookie,
   redirects to `/me`.
3. Spotify rejects users not on the dashboard allowlist; the callback shows
   that error plainly.

### Status page `/me`

Shows: display name, status, last delivery (date, link to playlist, track
count), `consent_at + 6 months` as "re-authorize by", a Re-authorize button.
If status is `needs_reauth` or the deadline is within 14 days, show a red
banner.

### Daily delivery

Cron string: `30 19-23 * * 1-5` (UTC). The handler, not the cron, decides:

1. `date = todayInPacific()`. If not Mon–Fri, return.
2. If `nowInPacific < 12:05`, return (MBE runs 09:00–12:00 PT).
3. Fetch KCRW: `https://tracklist-api.kcrw.com/Simulcast/date/YYYY/MM/DD?time=09%3A00`.
   Keep rows where `program_title == "Morning Becomes Eclectic"` and
   `spotify_id` is non-empty. Dedupe by `spotify_id`, keep chronological
   order by `datetime`.
4. If fewer than 5 tracks, log and return (next hourly slot retries).
5. For each user with `status = 'active'` and no `deliveries` row for
   `date`:
   a. If `access_expires_at <= now + 60s`, refresh. On `invalid_grant`,
      set `status = 'needs_reauth'`, log, continue to next user.
   b. `POST /v1/users/{id}/playlists` with name `KCRW MBE – YYYY-MM-DD`,
      public true, description "Morning Becomes Eclectic, KCRW, <date>".
   c. `POST /v1/playlists/{playlist_id}/tracks` in chunks of 100 URIs.
   d. Insert `deliveries` row.
   e. Any other Spotify error: log with status and body, do not record a
      delivery, continue. The next hourly slot retries this user.
6. Because step 5 checks `deliveries`, every slot is idempotent.

Hourly slots 12:30–4:30pm PT cover DST shifts and late KCRW tracklist
updates. The last slot that finds nothing to do exits in milliseconds.

### Admin run

`POST /run?date=YYYY-MM-DD` with `Authorization: Bearer <ADMIN_TOKEN>`
calls the same `deliver(date)`. Used for backfill and manual testing. Returns
a JSON summary: tracks found, per-user outcome.

## Configuration

Secrets (via `wrangler secret put`): `SPOTIFY_CLIENT_ID`,
`SPOTIFY_CLIENT_SECRET`, `SESSION_SECRET`, `ADMIN_TOKEN`.

`wrangler.toml`: D1 binding `DB`, cron trigger, `compatibility_date`.

No per-user config. Program is hardcoded in `kcrw.ts` as a constant so a
second program is a one-line change later.

## Error handling

- All Spotify and KCRW calls go through one `fetchJson` helper that throws
  a typed error carrying HTTP status and body. 429s respect `Retry-After`
  once, then give up for this slot.
- Delivery loop never lets one user's failure stop another's.
- `scheduled()` catches everything and logs; Workers logs are the audit
  trail. No alerting in v1.

## Testing

Vitest with `@cloudflare/vitest-pool-workers` so D1 and bindings are real.
`fetch` is mocked per test for KCRW and Spotify.

Unit:
- `kcrw.ts`: filters non-MBE rows, drops missing `spotify_id`, dedupes,
  orders chronologically; handles empty array and non-JSON body.
- `time.ts`: PT date across DST boundaries and midnight UTC; weekday check;
  "finished airing" check.
- `spotify.ts`: refresh path, `invalid_grant` mapping, 100-URI chunking,
  playlist name format.
- `session.ts`: sign/verify round trip, tamper rejection.

Integration (vitest pool):
- `deliver()` with two users: one delivered, one `invalid_grant` → first has
  a `deliveries` row, second is `needs_reauth`.
- Running `deliver()` twice for the same date creates nothing the second
  time.
- `/auth/callback` with bad `state` is rejected.

## Deployment

1. `npm create cloudflare@latest` scaffold (Hono template), Node 20+.
2. `wrangler login` (Teo, interactive, once).
3. `wrangler d1 create kcrw-spotify`, apply `migrations/0001_init.sql`.
4. Set the four secrets.
5. `wrangler deploy`. Note the workers.dev URL.
6. Spotify dashboard: app with redirect URI `<url>/auth/callback`; add both
   users' emails under User Management.
7. Visit `/`, connect both accounts. `POST /run?date=<last weekday>` to
   verify end to end.

## Repo

`~/Code/kcrw-spotify`, GitHub `teoucsb82/kcrw-spotify` (personal account,
not leaserooster). Old Rails repo stays archived as reference.

## Follow-ups (not v1)

- Re-auth notification (Resend free tier, or a webhook).
- Additional programs and per-user selection.
- Custom domain.
