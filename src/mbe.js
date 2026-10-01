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
