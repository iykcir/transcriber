const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  parseSpotifyEpisodePage, parseAppleEpisodeTitle, parseAppleLookup, parseRssItems,
  normalizeTitle, matchEpisode,
} = require('../src/podcast-link');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures/podcast', name), 'utf8');
const DAY = 86400000;

test('parseSpotifyEpisodePage reads title, show, date and duration', () => {
  assert.deepEqual(parseSpotifyEpisodePage(fixture('spotify-episode.html')), {
    title: 'Measles Is Officially Back. What Now?', show: 'The Daily',
    date: Date.parse('2026-11-23T10:45:00Z'), durationSec: 1430,
  });
});

test('parseSpotifyEpisodePage returns null without the meta tags', () => {
  assert.equal(parseSpotifyEpisodePage('<html></html>'), null);
});

test('parseSpotifyEpisodePage decodes entities', () => {
  const html = '<meta property="og:title" content="It&#x27;s Q&amp;A Time"/>'
    + '<meta property="og:description" content="Tom &amp; Jerry · Episode"/>';
  const r = parseSpotifyEpisodePage(html);
  assert.equal(r.title, "It's Q&A Time");
  assert.equal(r.show, 'Tom & Jerry');
  assert.equal(r.date, null);
  assert.equal(r.durationSec, null);
});

test('parseAppleEpisodeTitle reads og:title', () => {
  assert.equal(parseAppleEpisodeTitle(fixture('apple-episode.html')), 'Measles Is Officially Back. What Now?');
  assert.equal(parseAppleEpisodeTitle('<html></html>'), null);
});

test('parseAppleLookup returns show, feed and episodes', () => {
  const r = parseAppleLookup(JSON.parse(fixture('apple-lookup.json')));
  assert.equal(r.show, 'The Daily');
  assert.equal(r.feedUrl, 'https://feeds.simplecast.com/Sl5CSM3S');
  assert.equal(r.episodes.length, 3);
  assert.equal(r.episodes[0].trackId, '1000803574143');
  assert.equal(r.episodes[0].title, 'Measles Is Officially Back. What Now?');
  assert.equal(r.episodes[0].durationSec, 1430);
  assert.equal(r.episodes[0].date, Date.parse('2026-11-23T10:45:00Z'));
  assert.match(r.episodes[0].mediaUrl, /default\.mp3\?/);
});

test('parseRssItems reads titles, enclosures, dates and durations', () => {
  const items = parseRssItems(fixture('feed.xml'));
  assert.equal(items.length, 5);
  assert.equal(items[0].title, 'Q&A: Ask Us Anything');
  assert.equal(items[0].mediaUrl, 'https://example.com/audio/qa.mp3?x=1&y=2');
  assert.equal(items[0].durationSec, 3723);
  assert.equal(items[0].date, Date.parse('2024-03-01T10:45:00Z'));
  assert.equal(items[1].durationSec, 1430);
  assert.equal(items[2].durationSec, null);
  assert.equal(items[3].durationSec, 1500);
  assert.equal(items[4].title, 'It’s a "Feed" Episode');
  assert.equal(items[4].mediaUrl, 'https://example.com/audio/feed.mp3');
});

test('normalizeTitle ignores quote style, dashes and punctuation', () => {
  assert.equal(normalizeTitle('It’s “Back”—Now!'), normalizeTitle('It\'s "Back" Now'));
  assert.equal(normalizeTitle('  A   B  '), 'a b');
});

const ep = (title, date, durationSec, mediaUrl = `https://x/${title}-${date}.mp3`) => ({ title, date, durationSec, mediaUrl });
const T0 = Date.parse('2026-11-23T10:45:00Z');

test('matchEpisode matches titles across quote styles', () => {
  const want = ep('It’s Possible', T0, 1954);
  assert.equal(matchEpisode({ title: "It's Possible", date: T0, durationSec: 1954 }, [ep('Other', T0, 10), want]), want);
});

test('matchEpisode picks the duplicate title near the target date', () => {
  const near = ep('The Best of 2023', T0 + DAY, 1500);
  const far = ep('The Best of 2023', T0 - 300 * DAY, 1500);
  assert.equal(matchEpisode({ title: 'The Best of 2023', date: T0, durationSec: null }, [far, near]), near);
});

test('matchEpisode refuses duplicate titles that are both near', () => {
  const a = ep('Rerun', T0, 100);
  const b = ep('Rerun', T0 + DAY, 100);
  assert.equal(matchEpisode({ title: 'Rerun', date: T0, durationSec: 100 }, [a, b]), null);
});

test('matchEpisode accepts a title match when dates are unknown', () => {
  const a = ep('Only One', null, null);
  assert.equal(matchEpisode({ title: 'Only One', date: null, durationSec: null }, [a]), a);
});

test('matchEpisode falls back to one episode with the same day and length', () => {
  const want = ep('Renamed in the feed', T0 + 3600000, 1440);
  assert.equal(matchEpisode({ title: 'Spotify title', date: T0, durationSec: 1430 }, [ep('Old', T0 - 30 * DAY, 1430), want]), want);
});

test('matchEpisode refuses when two episodes fit the date and length', () => {
  const eps = [ep('A', T0, 1430), ep('B', T0 + 3600000, 1440)];
  assert.equal(matchEpisode({ title: 'Spotify title', date: T0, durationSec: 1430 }, eps), null);
});

test('matchEpisode returns null when nothing is close', () => {
  assert.equal(matchEpisode({ title: 'Nope', date: T0, durationSec: 1430 }, [ep('A', T0 - 10 * DAY, 3000)]), null);
});

// ── resolvePodcastLink with a fake fetch ─────────────────────────────────────
const { resolvePodcastLink, podcastErrorMessage, PodcastLinkError } = require('../src/podcast-link');

const SPOTIFY = 'https://open.spotify.com/episode/4ZDqaBObIEQr68g4oXT15u';
const APPLE = 'https://podcasts.apple.com/us/podcast/the-daily/id1200361736?i=1000803574143';
const LOOKUP = JSON.parse(fixture('apple-lookup.json'));
const MEASLES_MP3 = LOOKUP.results[1].episodeUrl;

function reply(body, { status = 200, url, headers = {} } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300, status, url,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}

// routes: [predicate(url) => boolean, response | (url) => response][]; unmatched → 404.
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    for (const [match, res] of routes) {
      if (match(url)) {
        if (res instanceof Error) throw res;
        return typeof res === 'function' ? res(url) : { url, ...res };
      }
    }
    return reply('not found', { status: 404, url });
  };
  fn.calls = calls;
  return fn;
}

const has = (...parts) => (url) => parts.every((p) => url.includes(p));
const lookupWithout = (trackId) => ({ ...LOOKUP, results: LOOKUP.results.filter((r) => String(r.trackId) !== trackId || r.kind === 'podcast') });
const FEED_WITH_MEASLES = fixture('feed.xml').replace('</channel>',
  '<item><title>Measles Is Officially Back. What Now?</title><pubDate>Sun, 23 Nov 2026 10:45:00 GMT</pubDate>'
  + '<itunes:duration>1430</itunes:duration><enclosure url="https://example.com/audio/measles.mp3"/></item></channel>');

const rejectsWith = (p, code) => assert.rejects(p, (err) => {
  assert.ok(err instanceof PodcastLinkError, `expected PodcastLinkError, got ${err}`);
  assert.equal(err.code, code);
  return true;
});

test('resolve: Apple link found in the show lookup', async () => {
  const fetch = fakeFetch([[has('itunes.apple.com/lookup', 'id=1200361736', 'country=us'), reply(LOOKUP)]]);
  assert.deepEqual(await resolvePodcastLink(APPLE, { fetch }), {
    mediaUrl: MEASLES_MP3, title: 'Measles Is Officially Back. What Now?', show: 'The Daily', service: 'Apple Podcasts',
  });
  assert.equal(fetch.calls.length, 1);
});

test('resolve: older Apple episode goes through the page title and the feed', async () => {
  const fetch = fakeFetch([
    [has('itunes.apple.com/lookup'), reply(lookupWithout('1000803574143'))],
    [has('podcasts.apple.com/'), reply(fixture('apple-episode.html'))],
    [has('feeds.simplecast.com/Sl5CSM3S'), reply(FEED_WITH_MEASLES)],
  ]);
  const r = await resolvePodcastLink(APPLE, { fetch });
  assert.equal(r.mediaUrl, 'https://example.com/audio/measles.mp3');
  assert.equal(r.title, 'Measles Is Officially Back. What Now?');
  assert.equal(r.show, 'The Daily');
});

test('resolve: Apple episode without public audio is subscribers-only', async () => {
  const lookup = structuredClone(LOOKUP);
  delete lookup.results[1].episodeUrl;
  const fetch = fakeFetch([[has('itunes.apple.com/lookup'), reply(lookup)]]);
  await rejectsWith(resolvePodcastLink(APPLE, { fetch }), 'SUBSCRIBERS_ONLY');
});

test('resolve: Spotify link via Apple search and lookup', async () => {
  const fetch = fakeFetch([
    [has('open.spotify.com/episode/4ZDqaBObIEQr68g4oXT15u'), reply(fixture('spotify-episode.html'))],
    [has('itunes.apple.com/search', 'country=us'), reply(fixture('apple-search.json'))],
    [has('itunes.apple.com/lookup', 'id=1200361736'), reply(LOOKUP)],
  ]);
  assert.deepEqual(await resolvePodcastLink(SPOTIFY, { fetch }), {
    mediaUrl: MEASLES_MP3, title: 'Measles Is Officially Back. What Now?', show: 'The Daily', service: 'Spotify',
  });
});

test('resolve: Spotify tries the Mac region first, then the US', async () => {
  const fetch = fakeFetch([
    [has('open.spotify.com/episode/'), reply(fixture('spotify-episode.html'))],
    [has('itunes.apple.com/search', 'country=de'), reply({ resultCount: 1, results: [{ kind: 'podcast', collectionId: 1, collectionName: 'Die Daily' }] })],
    [has('itunes.apple.com/search', 'country=us'), reply(fixture('apple-search.json'))],
    [has('itunes.apple.com/lookup', 'id=1200361736'), reply(LOOKUP)],
  ]);
  const r = await resolvePodcastLink(SPOTIFY, { fetch, regions: ['de', 'us', 'de'] });
  assert.equal(r.mediaUrl, MEASLES_MP3);
  assert.equal(fetch.calls.filter((u) => u.includes('/search')).length, 2);
});

test('resolve: Spotify episode not in recent lookup falls back to the feed', async () => {
  const fetch = fakeFetch([
    [has('open.spotify.com/episode/'), reply(fixture('spotify-episode.html'))],
    [has('itunes.apple.com/search'), reply(fixture('apple-search.json'))],
    [has('itunes.apple.com/lookup'), reply(lookupWithout('1000803574143'))],
    [has('feeds.simplecast.com/Sl5CSM3S'), reply(FEED_WITH_MEASLES)],
  ]);
  assert.equal((await resolvePodcastLink(SPOTIFY, { fetch })).mediaUrl, 'https://example.com/audio/measles.mp3');
});

test('resolve: Spotify error cases', async () => {
  const page = [has('open.spotify.com/episode/'), reply(fixture('spotify-episode.html'))];
  await rejectsWith(resolvePodcastLink(SPOTIFY, { fetch: fakeFetch([[has('open.spotify.com'), reply('<html></html>')]]) }), 'SPOTIFY_UNREADABLE');
  await rejectsWith(resolvePodcastLink(SPOTIFY, { fetch: fakeFetch([page,
    [has('itunes.apple.com/search'), reply({ resultCount: 0, results: [] })]]) }), 'SHOW_NOT_FOUND');
  await rejectsWith(resolvePodcastLink(SPOTIFY, { fetch: fakeFetch([page,
    [has('itunes.apple.com/search'), reply(fixture('apple-search.json'))],
    [has('itunes.apple.com/lookup'), reply(lookupWithout('1000803574143'))],
    [has('feeds.simplecast.com'), reply(fixture('feed.xml'))]]) }), 'EPISODE_NOT_FOUND');
});

test('resolve: show links fail without any request', async () => {
  for (const url of ['https://open.spotify.com/show/3IM0lmZxpFAY7CwMuv9H4g', 'https://podcasts.apple.com/us/podcast/the-daily/id1200361736']) {
    const fetch = fakeFetch([]);
    await rejectsWith(resolvePodcastLink(url, { fetch }), 'SHOW_LINK');
    assert.equal(fetch.calls.length, 0);
  }
});

test('resolve: spotify.link short links', async () => {
  const rest = [
    [has('open.spotify.com/episode/'), reply(fixture('spotify-episode.html'))],
    [has('itunes.apple.com/search'), reply(fixture('apple-search.json'))],
    [has('itunes.apple.com/lookup'), reply(LOOKUP)],
  ];
  const redirected = fakeFetch([[has('spotify.link/'), reply('', { url: `${SPOTIFY}?si=x` })], ...rest]);
  assert.equal((await resolvePodcastLink('https://spotify.link/AbC', { fetch: redirected })).mediaUrl, MEASLES_MP3);
  const inBody = fakeFetch([[has('spotify.link/'), reply(`<a href="${SPOTIFY}?si=1">open</a>`, { url: 'https://spotify.app.link/x' })], ...rest]);
  assert.equal((await resolvePodcastLink('https://spotify.link/AbC', { fetch: inBody })).mediaUrl, MEASLES_MP3);
  const neither = fakeFetch([[has('spotify.link/'), reply('<html></html>', { url: 'https://spotify.app.link/x' })]]);
  await rejectsWith(resolvePodcastLink('https://spotify.link/AbC', { fetch: neither }), 'SPOTIFY_UNREADABLE');
  const toShow = fakeFetch([[has('spotify.link/'), reply('', { url: 'https://open.spotify.com/show/3IM0lmZxpFAY7CwMuv9H4g' })]]);
  await rejectsWith(resolvePodcastLink('https://spotify.link/AbC', { fetch: toShow }), 'SHOW_LINK');
});

test('resolve: network failures map to NETWORK', async () => {
  await rejectsWith(resolvePodcastLink(APPLE, { fetch: fakeFetch([[() => true, new TypeError('fetch failed')]]) }), 'NETWORK');
  await rejectsWith(resolvePodcastLink(APPLE, { fetch: fakeFetch([[() => true, reply('', { status: 503 })]]) }), 'NETWORK');
  const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  await rejectsWith(resolvePodcastLink(APPLE, { fetch: fakeFetch([[() => true, timeout]]) }), 'NETWORK');
});

test('resolve: oversized feeds are abandoned', async () => {
  const fetch = fakeFetch([
    [has('itunes.apple.com/lookup'), reply(lookupWithout('1000803574143'))],
    [has('podcasts.apple.com/'), reply(fixture('apple-episode.html'))],
    [has('feeds.simplecast.com'), reply(FEED_WITH_MEASLES, { headers: { 'content-length': String(21 * 1024 * 1024) } })],
  ]);
  await rejectsWith(resolvePodcastLink(APPLE, { fetch }), 'EPISODE_NOT_FOUND');
});

test('podcastErrorMessage', () => {
  assert.equal(podcastErrorMessage(new PodcastLinkError('SHOW_LINK')), 'This is a link to a whole show. Paste a link to a single episode.');
  assert.equal(podcastErrorMessage(new Error('x')), "Couldn't load this podcast link.");
});

test('resolve: a Spotify page that 404s is an unreadable link, not a network problem', async () => {
  const fetch = fakeFetch([[has('open.spotify.com/episode/'), reply('Not found', { status: 404 })]]);
  await rejectsWith(resolvePodcastLink(SPOTIFY, { fetch }), 'SPOTIFY_UNREADABLE');
});

test('resolve: an Apple episode page that 404s is episode-not-found', async () => {
  const fetch = fakeFetch([
    [has('itunes.apple.com/lookup'), reply(lookupWithout('1000803574143'))],
    [has('podcasts.apple.com/'), reply('Not found', { status: 404 })],
  ]);
  await rejectsWith(resolvePodcastLink(APPLE, { fetch }), 'EPISODE_NOT_FOUND');
});

// ── Final-review fixes ───────────────────────────────────────────────────────
const twoShows = { resultCount: 2, results: [
  { kind: 'podcast', collectionId: 111, collectionName: 'The Daily', feedUrl: 'https://feeds.example.com/one' },
  { kind: 'podcast', collectionId: 1200361736, collectionName: 'The Daily', feedUrl: 'https://feeds.simplecast.com/Sl5CSM3S' },
] };
const otherShowLookup = { resultCount: 2, results: [
  { wrapperType: 'track', kind: 'podcast', collectionId: 111, collectionName: 'The Daily', feedUrl: 'https://feeds.example.com/one' },
  { kind: 'podcast-episode', trackId: 9, trackName: 'Something Else Entirely', releaseDate: '2026-11-23T08:00:00Z',
    trackTimeMillis: 1440000, episodeUrl: 'https://example.com/wrong-show.mp3' },
] };

test('resolve: a title match in a later show beats a length match in an earlier one', async () => {
  const fetch = fakeFetch([
    [has('open.spotify.com/episode/'), reply(fixture('spotify-episode.html'))],
    [has('itunes.apple.com/search'), reply(twoShows)],
    [has('itunes.apple.com/lookup', 'id=111'), reply(otherShowLookup)],
    [has('itunes.apple.com/lookup', 'id=1200361736'), reply(LOOKUP)],
  ]);
  assert.equal((await resolvePodcastLink(SPOTIFY, { fetch })).mediaUrl, MEASLES_MP3);
});

test('resolve: the same episode in the lookup and the feed is not ambiguous', async () => {
  const renamed = structuredClone(LOOKUP);
  renamed.results[1].trackName = 'Renamed on Apple';
  const feed = fixture('feed.xml').replace('</channel>',
    `<item><title>Renamed in the feed</title><pubDate>Sun, 23 Nov 2026 10:45:00 GMT</pubDate><itunes:duration>1430</itunes:duration>`
    + `<enclosure url="${MEASLES_MP3.replace(/&/g, '&amp;')}"/></item></channel>`);
  const fetch = fakeFetch([
    [has('open.spotify.com/episode/'), reply(fixture('spotify-episode.html'))],
    [has('itunes.apple.com/search'), reply(fixture('apple-search.json'))],
    [has('itunes.apple.com/lookup'), reply(renamed)],
    [has('feeds.simplecast.com'), reply(feed)],
  ]);
  assert.equal((await resolvePodcastLink(SPOTIFY, { fetch })).mediaUrl, MEASLES_MP3);
});

test('resolve: a non-web media address from a feed is refused', async () => {
  const feed = FEED_WITH_MEASLES.replace('https://example.com/audio/measles.mp3', 'file:///etc/passwd');
  const fetch = fakeFetch([
    [has('itunes.apple.com/lookup'), reply(lookupWithout('1000803574143'))],
    [has('podcasts.apple.com/'), reply(fixture('apple-episode.html'))],
    [has('feeds.simplecast.com'), reply(feed)],
  ]);
  await rejectsWith(resolvePodcastLink(APPLE, { fetch }), 'EPISODE_NOT_FOUND');
});
