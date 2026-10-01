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
