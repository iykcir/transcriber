// Turns Spotify and Apple Podcasts episode links into the episode's public
// audio URL. Main process only. The parsers and the matcher at the top are
// pure so they can be tested with saved responses.

/**
 * @typedef {{title: string, date: number | null, durationSec: number | null, mediaUrl: string | null}} Episode
 * @typedef {{title: string, date: number | null, durationSec: number | null}} EpisodeTarget
 */

const { podcastLinkKind } = require('./ui-logic');

const DAY_MS = 86400000;

/** @param {string} s */
function decodeEntities(s) {
  const named = /** @type {Record<string, string>} */ ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' });
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return named[code.toLowerCase()] ?? whole;
  });
}

/** Attributes of a single tag, e.g. `<meta property="x" content="y">`. */
function tagAttributes(tag) {
  /** @type {Record<string, string>} */
  const attrs = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? '');
  }
  return attrs;
}

/** Content of the <meta> whose property or name is `key`, or null. */
function metaContent(html, key) {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = tagAttributes(m[0]);
    if ((a.property === key || a.name === key) && a.content != null) return a.content.trim();
  }
  return null;
}

/** @param {string | null | undefined} s */
function parseDate(s) {
  if (!s) return null;
  const t = Date.parse(s.trim());
  return Number.isFinite(t) ? t : null;
}

/** Seconds from "1430", "25:00" or "1:02:03"; null otherwise. */
function parseDuration(s) {
  if (s == null) return null;
  const parts = String(s).trim().split(':');
  if (!parts.length || parts.length > 3 || !parts.every((p) => /^\d+(\.\d+)?$/.test(p))) return null;
  return parts.reduce((total, p) => total * 60 + Number(p), 0);
}

/**
 * @param {string} html
 * @returns {EpisodeTarget & {show: string} | null}
 */
function parseSpotifyEpisodePage(html) {
  const title = metaContent(html, 'og:title');
  const description = metaContent(html, 'og:description') ?? '';
  const show = description.split(' · ')[0].trim();
  if (!title || !show || !description.includes(' · ')) return null;
  return {
    title,
    show,
    date: parseDate(metaContent(html, 'music:release_date')),
    durationSec: parseDuration(metaContent(html, 'music:duration')),
  };
}

/** @param {string} html */
function parseAppleEpisodeTitle(html) {
  return metaContent(html, 'og:title') || null;
}

/**
 * @param {any} json  a parsed iTunes lookup response
 * @returns {{show: string, feedUrl: string | null, episodes: (Episode & {trackId: string})[]}}
 */
function parseAppleLookup(json) {
  const results = Array.isArray(json?.results) ? json.results : [];
  const showRow = results.find((r) => r?.kind === 'podcast') ?? results.find((r) => r?.collectionName);
  const episodes = results
    .filter((r) => r?.kind === 'podcast-episode' && typeof r.trackName === 'string')
    .map((r) => ({
      trackId: String(r.trackId),
      title: r.trackName,
      date: parseDate(r.releaseDate),
      durationSec: typeof r.trackTimeMillis === 'number' ? Math.round(r.trackTimeMillis / 1000) : null,
      mediaUrl: typeof r.episodeUrl === 'string' && r.episodeUrl ? r.episodeUrl : null,
    }));
  return {
    show: showRow?.collectionName ?? '',
    feedUrl: typeof showRow?.feedUrl === 'string' ? showRow.feedUrl : null,
    episodes,
  };
}

/** Text of the first <name>…</name> in `xml`, CDATA unwrapped and decoded. */
function elementText(xml, name) {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  if (!m) return null;
  const raw = m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  return decodeEntities(raw).trim();
}

/**
 * @param {string} xml  an RSS feed
 * @returns {Episode[]}
 */
function parseRssItems(xml) {
  const items = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const body = m[1];
    const enclosure = /<enclosure\b[^>]*>/i.exec(body);
    items.push({
      title: elementText(body, 'title') ?? '',
      date: parseDate(elementText(body, 'pubDate')),
      durationSec: parseDuration(elementText(body, 'itunes:duration')),
      mediaUrl: enclosure ? tagAttributes(enclosure[0]).url || null : null,
    });
  }
  return items;
}

/** @param {string} s */
function normalizeTitle(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * The episode that confidently matches `target`, or null if none does or
 * several do. Never guesses between equally good candidates.
 * @template {Episode} E
 * @param {EpisodeTarget} target
 * @param {E[]} episodes
 * @returns {E | null}
 */
function matchEpisode(target, episodes) {
  const byTitle = titleMatches(target, episodes);
  if (byTitle.sameTitle) return byTitle.near.length === 1 ? byTitle.near[0] : null;
  const close = lengthMatches(target, episodes);
  return close.length === 1 ? close[0] : null;
}

/**
 * Episodes with the target's title, and those of them within 2 days of it.
 * @template {Episode} E @param {EpisodeTarget} target @param {E[]} episodes
 */
function titleMatches(target, episodes) {
  const want = normalizeTitle(target.title);
  const same = episodes.filter((e) => normalizeTitle(e.title) === want);
  const near = same.filter((e) => e.date == null || target.date == null || Math.abs(e.date - target.date) <= 2 * DAY_MS);
  return { sameTitle: same.length > 0, near };
}

/**
 * Episodes within a day of the target with nearly the same length.
 * @template {Episode} E @param {EpisodeTarget} target @param {E[]} episodes
 */
function lengthMatches(target, episodes) {
  if (target.date == null || target.durationSec == null) return [];
  const tolerance = Math.max(target.durationSec * 0.05, 30);
  return episodes.filter((e) => e.date != null && e.durationSec != null
    && Math.abs(e.date - target.date) <= DAY_MS
    && Math.abs(e.durationSec - target.durationSec) <= tolerance);
}

// ── Resolving a link ──────────────────────────────────────────────────────────

const MESSAGES = {
  SHOW_LINK: 'This is a link to a whole show. Paste a link to a single episode.',
  SPOTIFY_UNREADABLE: 'Couldn\'t read this Spotify link. Check that it\'s a podcast episode.',
  SHOW_NOT_FOUND: 'Couldn\'t find this show in a public podcast directory. Spotify-only shows can\'t be transcribed.',
  EPISODE_NOT_FOUND: 'Couldn\'t find this episode in the show\'s public feed.',
  SUBSCRIBERS_ONLY: 'This episode is only available to subscribers, so it can\'t be transcribed.',
  NETWORK: 'Couldn\'t reach the podcast service. Check your internet connection.',
  OTHER: 'Couldn\'t load this podcast link.',
};

const TIMEOUT_MS = 15000;
const MAX_FEED_BYTES = 20 * 1024 * 1024;
const MAX_CANDIDATE_SHOWS = 3;

/** Thrown for every failure; the message is written for people. */
class PodcastLinkError extends Error {
  /** @param {keyof typeof MESSAGES} code @param {{cause?: unknown}} [options] */
  constructor(code, options) {
    super(MESSAGES[code], options);
    this.name = 'PodcastLinkError';
    this.code = code;
  }
}

/** @param {unknown} err */
function podcastErrorMessage(err) {
  return err instanceof PodcastLinkError ? err.message : MESSAGES.OTHER;
}

/**
 * @typedef {(url: string, init?: any) => Promise<any>} FetchLike
 * @typedef {{fetch: FetchLike, signal?: AbortSignal}} Http
 */

/**
 * GET `url`. Network failures, timeouts and 5xx become NETWORK; other non-2xx
 * answers (the page doesn't exist) become `missingCode`.
 * @param {Http} http @param {string} url @param {keyof typeof MESSAGES} [missingCode]
 */
async function get(http, url, missingCode = 'NETWORK') {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = http.signal ? AbortSignal.any([http.signal, timeout]) : timeout;
  let res;
  try {
    res = await http.fetch(url, { redirect: 'follow', signal });
  } catch (err) {
    throw new PodcastLinkError('NETWORK', { cause: err });
  }
  if (!res.ok) {
    const code = res.status >= 500 || res.status === 429 ? 'NETWORK' : missingCode;
    throw new PodcastLinkError(code, { cause: new Error(`HTTP ${res.status} for ${url}`) });
  }
  return res;
}

/** @param {Http} http @param {string} url @param {keyof typeof MESSAGES} [missingCode] */
async function getText(http, url, missingCode) {
  const res = await get(http, url, missingCode);
  try { return await res.text(); } catch (err) { throw new PodcastLinkError('NETWORK', { cause: err }); }
}

async function getJson(http, url) {
  const text = await getText(http, url);
  try { return JSON.parse(text); } catch (err) { throw new PodcastLinkError('NETWORK', { cause: err }); }
}

/** Episodes from a feed, or [] when the feed can't be read or is too big. */
async function feedEpisodes(http, feedUrl) {
  if (!feedUrl) return [];
  let res;
  try { res = await get(http, feedUrl); } catch { return []; }
  if (Number(res.headers?.get?.('content-length') ?? 0) > MAX_FEED_BYTES) return [];
  let xml;
  try { xml = await res.text(); } catch { return []; }
  if (xml.length > MAX_FEED_BYTES) return [];
  return parseRssItems(xml);
}

/** @param {Http} http @param {string} showId @param {string} country */
async function lookupShow(http, showId, country) {
  const url = `https://itunes.apple.com/lookup?id=${encodeURIComponent(showId)}&entity=podcastEpisode&limit=200&country=${encodeURIComponent(country)}`;
  return parseAppleLookup(await getJson(http, url));
}

/** @param {Episode} episode @param {string} show @param {'Spotify' | 'Apple Podcasts'} service */
function found(episode, show, service) {
  if (!episode.mediaUrl) throw new PodcastLinkError('SUBSCRIBERS_ONLY');
  // Feeds are publisher-controlled; only web addresses go on to ffmpeg.
  if (!/^https?:\/\//i.test(episode.mediaUrl)) throw new PodcastLinkError('EPISODE_NOT_FOUND');
  return { mediaUrl: episode.mediaUrl, title: episode.title, show, service };
}

async function resolveApple(http, url, { showId, episodeId, country }) {
  const lookup = await lookupShow(http, showId, country);
  const hit = lookup.episodes.find((e) => e.trackId === episodeId);
  if (hit) return found(hit, lookup.show, 'Apple Podcasts');
  const title = parseAppleEpisodeTitle(await getText(http, url, 'EPISODE_NOT_FOUND'));
  if (!title) throw new PodcastLinkError('EPISODE_NOT_FOUND');
  const match = matchEpisode({ title, date: null, durationSec: null }, await feedEpisodes(http, lookup.feedUrl));
  if (!match) throw new PodcastLinkError('EPISODE_NOT_FOUND');
  return found(match, lookup.show, 'Apple Podcasts');
}

async function resolveSpotify(http, episodeId, regions) {
  const target = parseSpotifyEpisodePage(await getText(http, `https://open.spotify.com/episode/${episodeId}`, 'SPOTIFY_UNREADABLE'));
  if (!target) throw new PodcastLinkError('SPOTIFY_UNREADABLE');
  const wantShow = normalizeTitle(target.show);
  let sawShow = false;
  for (const region of regions) {
    const search = await getJson(http, `https://itunes.apple.com/search?term=${encodeURIComponent(target.show)}`
      + `&media=podcast&entity=podcast&limit=10&country=${encodeURIComponent(region)}`);
    const candidates = (Array.isArray(search?.results) ? search.results : [])
      .filter((r) => r?.collectionId != null && normalizeTitle(r.collectionName) === wantShow)
      .slice(0, MAX_CANDIDATE_SHOWS);
    if (!candidates.length) continue;
    sawShow = true;
    // Shows with the same name can each hold a plausible episode, so every
    // candidate is weighed together: a title match anywhere beats a
    // date-and-length match anywhere, and a tie is never broken by guessing.
    /** @type {(Episode & {show: string})[]} */
    const pool = [];
    const add = (episodes, show) => {
      for (const e of episodes) if (!pool.some((p) => sameEpisode(p, e))) pool.push({ ...e, show });
    };
    const shows = [];
    for (const c of candidates) {
      const lookup = await lookupShow(http, String(c.collectionId), region);
      const show = lookup.show || c.collectionName;
      shows.push({ feedUrl: lookup.feedUrl ?? c.feedUrl ?? null, show });
      add(lookup.episodes, show);
    }
    let pick = pickByTitle(target, pool);
    if (!pick) {
      for (const { feedUrl, show } of shows) add(await feedEpisodes(http, feedUrl), show);
      pick = pickByTitle(target, pool);
    }
    if (!pick) {
      const close = lengthMatches(target, pool);
      if (close.length === 1) pick = close[0];
    }
    if (pick) return found(pick, pick.show, 'Spotify');
  }
  throw new PodcastLinkError(sawShow ? 'EPISODE_NOT_FOUND' : 'SHOW_NOT_FOUND');
}

/**
 * The one episode in `pool` with the target's title near its date; null when
 * there is none. Several equally good ones fail rather than guess.
 * @template {Episode} E @param {EpisodeTarget} target @param {E[]} pool
 */
function pickByTitle(target, pool) {
  const { near } = titleMatches(target, pool);
  if (near.length > 1) throw new PodcastLinkError('EPISODE_NOT_FOUND');
  return near[0] ?? null;
}

/** The same episode seen twice, e.g. in Apple's list and in the feed. */
function sameEpisode(a, b) {
  if (a.mediaUrl && a.mediaUrl === b.mediaUrl) return true;
  return a.date != null && b.date != null && Math.abs(a.date - b.date) <= 3600000
    && a.durationSec != null && b.durationSec != null && Math.abs(a.durationSec - b.durationSec) <= 2;
}

/** Follows a spotify.link short link to the open.spotify.com URL it stands for. */
async function expandSpotifyShortLink(http, url) {
  const res = await get(http, url, 'SPOTIFY_UNREADABLE');
  const finalKind = podcastLinkKind(res.url ?? '');
  if (finalKind && finalKind.service !== 'spotify-short') return finalKind;
  let body = '';
  try { body = await res.text(); } catch { /* fall through */ }
  const m = /https:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:episode|show)\/[A-Za-z0-9]{22}/i.exec(body);
  const kind = m ? podcastLinkKind(m[0]) : null;
  if (!kind) throw new PodcastLinkError('SPOTIFY_UNREADABLE');
  return kind;
}

/**
 * @param {string} url  a Spotify or Apple Podcasts link
 * @param {{fetch: FetchLike, regions?: string[], signal?: AbortSignal}} deps
 * @returns {Promise<{mediaUrl: string, title: string, show: string, service: 'Spotify' | 'Apple Podcasts'}>}
 */
async function resolvePodcastLink(url, { fetch, regions = ['us'], signal }) {
  const http = { fetch, signal };
  try {
    let kind = podcastLinkKind(url);
    if (kind?.service === 'spotify-short') kind = await expandSpotifyShortLink(http, url);
    if (!kind) throw new PodcastLinkError('OTHER');
    if (kind.service === 'spotify-show' || kind.service === 'apple-show') throw new PodcastLinkError('SHOW_LINK');
    if (kind.service === 'apple') return await resolveApple(http, url, kind);
    if (kind.service === 'spotify') {
      const list = [...new Set(regions.map((r) => String(r).toLowerCase()).filter(Boolean))];
      return await resolveSpotify(http, kind.episodeId, list.length ? list : ['us']);
    }
    throw new PodcastLinkError('OTHER');
  } catch (err) {
    if (err instanceof PodcastLinkError) throw err;
    throw new PodcastLinkError('OTHER', { cause: err });
  }
}

module.exports = {
  parseSpotifyEpisodePage, parseAppleEpisodeTitle, parseAppleLookup, parseRssItems,
  normalizeTitle, matchEpisode,
  PodcastLinkError, resolvePodcastLink, podcastErrorMessage,
};
