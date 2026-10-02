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
