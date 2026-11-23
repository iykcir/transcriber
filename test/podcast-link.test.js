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
