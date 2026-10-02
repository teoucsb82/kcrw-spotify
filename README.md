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
