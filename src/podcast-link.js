// Turns Spotify and Apple Podcasts episode links into the episode's public
// audio URL. Main process only. The parsers and the matcher at the top are
// pure so they can be tested with saved responses.

/**
 * @typedef {{title: string, date: number | null, durationSec: number | null, mediaUrl: string | null}} Episode
 * @typedef {{title: string, date: number | null, durationSec: number | null}} EpisodeTarget
 */

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
  const want = normalizeTitle(target.title);
  const within = (a, b, ms) => a == null || b == null || Math.abs(a - b) <= ms;

  const sameTitle = episodes.filter((e) => normalizeTitle(e.title) === want);
  if (sameTitle.length) {
    const near = sameTitle.filter((e) => within(e.date, target.date, 2 * DAY_MS));
    return near.length === 1 ? near[0] : null;
  }

  if (target.date == null || target.durationSec == null) return null;
  const tolerance = Math.max(target.durationSec * 0.05, 30);
  const close = episodes.filter((e) => e.date != null && e.durationSec != null
    && Math.abs(e.date - target.date) <= DAY_MS
    && Math.abs(e.durationSec - target.durationSec) <= tolerance);
  return close.length === 1 ? close[0] : null;
}

module.exports = {
  parseSpotifyEpisodePage, parseAppleEpisodeTitle, parseAppleLookup, parseRssItems,
  normalizeTitle, matchEpisode,
};
