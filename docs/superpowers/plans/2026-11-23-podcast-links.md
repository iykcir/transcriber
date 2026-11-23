# Podcast Episode Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pasting a Spotify or Apple Podcasts single-episode link loads that episode's public MP3 and then behaves exactly like a pasted direct media link.

**Architecture:** A pure link classifier in `src/ui-logic.js` (shared with the renderer). A main-process module `src/podcast-link.js` with pure parsers/matchers plus one orchestrating `resolvePodcastLink(url, deps)` that uses an injected fetch. One IPC channel `resolve-podcast-link`. `loadUrl` in the renderer resolves first, then continues on the existing direct-link path.

**Tech Stack:** Electron (main `net.fetch`), Node `node:test`, Apple iTunes Search/Lookup API, public Spotify episode pages, podcast RSS.

**Spec:** `docs/superpowers/specs/2026-11-23-podcast-links-design.md`

## Global Constraints

- No new npm dependencies. No API keys or accounts.
- All HTTP in the main process; the renderer only receives `{ mediaUrl, title, show, service }` or an error message.
- Every request has a 15-second timeout; RSS feeds above 20 MB are abandoned.
- Never transcribe the wrong episode silently: ambiguous matches fail.
- Untrusted titles/show names reach the UI only via `textContent`.
- YouTube and direct-link loading behave exactly as before.
- Tests run offline (`npm test`); `npm run lint` and `npm run typecheck` stay clean.
- Error copy, exactly:
  - `SHOW_LINK`: "This is a link to a whole show. Paste a link to a single episode."
  - `SPOTIFY_UNREADABLE`: "Couldn't read this Spotify link. Check that it's a podcast episode."
  - `SHOW_NOT_FOUND`: "Couldn't find this show in a public podcast directory. Spotify-only shows can't be transcribed."
  - `EPISODE_NOT_FOUND`: "Couldn't find this episode in the show's public feed."
  - `SUBSCRIBERS_ONLY`: "This episode is only available to subscribers, so it can't be transcribed."
  - `NETWORK`: "Couldn't reach the podcast service. Check your internet connection."
  - `OTHER`: "Couldn't load this podcast link."

## Review Focus

1. Spotify titles with HTML entities or curly quotes (`It&#x27;s`, `It’s`) vs. the same title in Apple/RSS with straight quotes: must match. (Test in Task 2.)
2. Two episodes in a feed with the same title (re-runs, "Best of" repeats) but different dates: pick the one within 2 days of the Spotify date; if both are, fail rather than guess. (Test in Task 2.)
3. RSS titles in CDATA with `&amp;` inside, items without `itunes:duration`, and `HH:MM:SS` vs. plain-seconds durations. (Test in Task 2.)
4. User pastes a second link while the first is still resolving: the late result must not replace the newer media. (Checked in Task 4's app run.)
5. Network failure mid-way (DNS failure, timeout, HTTP 5xx from Apple) maps to the `NETWORK` message, not `OTHER` or `EPISODE_NOT_FOUND`. (Test in Task 3.)

---

### Task 1: Recognise podcast links

**Files:**
- Modify: `src/ui-logic.js` (add function, add to `UiLogic` export object)
- Test: `test/ui-logic.test.js`

**Interfaces:**
- Produces: `UiLogic.podcastLinkKind(url: string) =>`
  `{service:'spotify', episodeId}` | `{service:'apple', showId, episodeId, country}` | `{service:'spotify-short'}` | `{service:'spotify-show'}` | `{service:'apple-show'}` | `null`.
  IDs are strings. `country` is lower-case, default `'us'`.

- [ ] **Step 1: Write the failing tests**

```js
const k = UiLogic.podcastLinkKind;
test('podcastLinkKind: spotify episode forms', () => {
  const want = { service: 'spotify', episodeId: '4ZDqaBObIEQr68g4oXT15u' };
  assert.deepEqual(k('https://open.spotify.com/episode/4ZDqaBObIEQr68g4oXT15u'), want);
  assert.deepEqual(k('https://open.spotify.com/episode/4ZDqaBObIEQr68g4oXT15u?si=abc123'), want);
  assert.deepEqual(k('https://open.spotify.com/intl-de/episode/4ZDqaBObIEQr68g4oXT15u'), want);
  assert.deepEqual(k('spotify:episode:4ZDqaBObIEQr68g4oXT15u'), want);
});
test('podcastLinkKind: apple episode forms', () => {
  assert.deepEqual(k('https://podcasts.apple.com/us/podcast/the-daily/id1200361736?i=1000803574143'),
    { service: 'apple', showId: '1200361736', episodeId: '1000803574143', country: 'us' });
  assert.deepEqual(k('https://podcasts.apple.com/GB/podcast/id1200361736?i=1000803574143'),
    { service: 'apple', showId: '1200361736', episodeId: '1000803574143', country: 'gb' });
  assert.deepEqual(k('https://podcasts.apple.com/podcast/id1200361736?i=1000803574143'),
    { service: 'apple', showId: '1200361736', episodeId: '1000803574143', country: 'us' });
});
test('podcastLinkKind: show and short links', () => {
  assert.deepEqual(k('https://open.spotify.com/show/3IM0lmZxpFAY7CwMuv9H4g'), { service: 'spotify-show' });
  assert.deepEqual(k('https://podcasts.apple.com/us/podcast/the-daily/id1200361736'), { service: 'apple-show' });
  assert.deepEqual(k('https://spotify.link/AbCdEf123'), { service: 'spotify-short' });
});
test('podcastLinkKind: everything else is null', () => {
  for (const u of ['https://www.youtube.com/watch?v=x', 'https://example.com/a.mp3',
    'https://open.spotify.com/track/4ZDqaBObIEQr68g4oXT15u', 'not a url', '']) assert.equal(k(u), null);
});
```

- [ ] **Step 2: Run** `node --test test/ui-logic.test.js` — Expected: FAIL, `podcastLinkKind` is not a function.
- [ ] **Step 3: Implement** `podcastLinkKind` with `new URL()` inside try/catch (plus a regex for the `spotify:episode:` URI). Spotify episode IDs are 22 base-62 characters.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck` — Expected: all pass.
- [ ] **Step 5: Commit** `git add src/ui-logic.js test/ui-logic.test.js && git commit -m "Recognise Spotify and Apple Podcasts links"`

### Task 2: Parsers and episode matching

**Files:**
- Create: `src/podcast-link.js`
- Create: `test/fixtures/podcast/` — trimmed copies of real responses: `spotify-episode.html` (just the `<head>` meta tags of the page in the spec), `apple-lookup.json` (show + 3 episodes), `apple-search.json`, `feed.xml` (5 items covering CDATA, `&amp;`, missing duration, `HH:MM:SS`, a duplicate title on a different date), `apple-episode.html` (the `og:title` meta).
- Test: `test/podcast-link.test.js`

**Interfaces:**
- Produces (all exported from `src/podcast-link.js`):
  - `type Episode = { title: string, date: number|null /* ms */, durationSec: number|null, mediaUrl: string|null }`
  - `parseSpotifyEpisodePage(html) => { title, show, date, durationSec } | null` (null when `og:title` or show is missing; show = `og:description` text before ` · `; entities decoded)
  - `parseAppleEpisodeTitle(html) => string|null`
  - `parseAppleLookup(json) => { show: string, feedUrl: string|null, episodes: (Episode & {trackId: string})[] }` (`mediaUrl` from `episodeUrl`, `durationSec` from `trackTimeMillis/1000`)
  - `parseRssItems(xml) => Episode[]` (`mediaUrl` from `<enclosure url>`; duration seconds or `H:MM:SS`/`MM:SS`)
  - `normalizeTitle(s) => string` (lower case, NFKC, curly→straight quotes, strip punctuation, collapse spaces)
  - `matchEpisode(target: {title, date, durationSec}, episodes: Episode[]) => Episode | null` — rules from spec "Episode matching": title-equal and dates within 2 days (when both known) → that one; if several qualify → null. Else exactly one with date within 1 day AND duration within max(5%, 30 s) → that one; else null.

- [ ] **Step 1: Write failing tests** (one `test()` each):
  - `parseSpotifyEpisodePage` on the fixture → `{ title: 'Measles Is Officially Back. What Now?', show: 'The Daily', date: Date.parse('2026-11-23T10:45:00Z'), durationSec: 1430 }`; on `'<html></html>'` → `null`; a title with `&#x27;` and `&amp;` decodes to `'` and `&`.
  - `parseAppleEpisodeTitle` on fixture → `'Measles Is Officially Back. What Now?'`.
  - `parseAppleLookup` on fixture → `show === 'The Daily'`, `feedUrl === 'https://feeds.simplecast.com/Sl5CSM3S'`, 3 episodes, first has `trackId === '1000803574143'` and a `mediaUrl` ending in `default.mp3?...`.
  - `parseRssItems` on fixture → 5 items; the CDATA title with `&amp;` becomes `'Q&A: Ask Us Anything'`; `'1:02:03'` → 3723; `'1430'` → 1430; missing duration → `null`.
  - `normalizeTitle('It’s “Back”—Now!')` equals `normalizeTitle("It's \"Back\" Now")`.
  - `matchEpisode`: title match with straight vs curly quotes → found; duplicate titles, one 300 days off → picks the near one; duplicate titles both within 2 days → `null`; no title match but one episode same day and 1440 s vs 1430 s → found; no title match and two such episodes → `null`; nothing close → `null`.
- [ ] **Step 2: Run** `node --test test/podcast-link.test.js` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the functions. Regex extraction only (no XML/HTML library); decode `&amp; &lt; &gt; &quot; &#39; &#xNN; &#NN;`.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck` — Expected: all pass.
- [ ] **Step 5: Commit** `git add src/podcast-link.js test/podcast-link.test.js test/fixtures/podcast && git commit -m "Parse podcast pages and feeds, match episodes"`

### Task 3: Resolve a link end to end (with a fake fetch)

**Files:**
- Modify: `src/podcast-link.js`
- Test: `test/podcast-link.test.js`

**Interfaces:**
- Consumes: Task 1 `podcastLinkKind` (require `./ui-logic`), Task 2 parsers.
- Produces:
  - `class PodcastLinkError extends Error { code }` where `code` is one of the Global Constraints keys; `message` is the exact copy.
  - `resolvePodcastLink(url, { fetch, regions = ['us'], signal }) => Promise<{ mediaUrl, title, show, service: 'Spotify'|'Apple Podcasts' }>`. Always rejects with `PodcastLinkError`. `fetch` is fetch-compatible (`(url, init) => Response`).
  - `podcastErrorMessage(err) => string` (PodcastLinkError → its message; else `OTHER`).

Flow (spec "How it works"):
- `spotify-short`: fetch with `redirect: 'follow'`; use `res.url` if it classifies as spotify; else search the body for `https://open.spotify.com/episode/<22 chars>`; else `SPOTIFY_UNREADABLE`. Then continue as spotify (a show result → `SHOW_LINK`).
- `spotify-show` / `apple-show` → `SHOW_LINK`.
- `apple`: lookup `https://itunes.apple.com/lookup?id=<showId>&entity=podcastEpisode&limit=200&country=<country>`; trackId hit with `mediaUrl` → done; hit without `mediaUrl` → `SUBSCRIBERS_ONLY`; miss → fetch the original Apple URL, `parseAppleEpisodeTitle`, fetch `feedUrl`, `matchEpisode({title, date:null, durationSec:null}, items)`; none → `EPISODE_NOT_FOUND`.
- `spotify`: fetch `https://open.spotify.com/episode/<id>` → `parseSpotifyEpisodePage` (null → `SPOTIFY_UNREADABLE`). For each region in `regions` (deduped) until matched: search `https://itunes.apple.com/search?term=<show>&media=podcast&entity=podcast&limit=10&country=<region>`; candidates = results whose `normalizeTitle(collectionName) === normalizeTitle(show)`, first 3; for each, lookup recent episodes and `matchEpisode`; then RSS fallback per candidate. No candidates in any region → `SHOW_NOT_FOUND`; candidates but no match → `EPISODE_NOT_FOUND`; matched episode without `mediaUrl` → `SUBSCRIBERS_ONLY`.
- Every request: `AbortSignal.any([signal, AbortSignal.timeout(15000)])` (omit `signal` when absent). Non-2xx, thrown fetch errors and timeouts → `NETWORK`. Feed body larger than 20 MB (by `content-length` or bytes read) → `EPISODE_NOT_FOUND`.

- [ ] **Step 1: Write failing tests** with `fakeFetch(routes)` mapping URL prefixes to `{status, body, url?}` from the fixtures, recording requested URLs:
  - Apple link, episode in lookup → `{ mediaUrl: <fixture episodeUrl>, title: 'Measles Is Officially Back. What Now?', show: 'The Daily', service: 'Apple Podcasts' }`, and no feed fetched.
  - Apple link, episode not in lookup → resolved through `apple-episode.html` + `feed.xml`, `mediaUrl` = the item's enclosure.
  - Apple lookup episode without `episodeUrl` → rejects `{ code: 'SUBSCRIBERS_ONLY' }`.
  - Spotify link → resolved via search + lookup, `service: 'Spotify'`; with `regions: ['de','us']` and the `de` search returning no exact-name match, the `us` search is used.
  - Spotify page without meta → `SPOTIFY_UNREADABLE`; search with no exact name → `SHOW_NOT_FOUND`; show found but no episode in lookup or feed → `EPISODE_NOT_FOUND`.
  - Show links → `SHOW_LINK` and zero fetches.
  - `spotify.link` whose fetch ends at `res.url = 'https://open.spotify.com/episode/4ZDqaBObIEQr68g4oXT15u'` → resolves; one whose body only contains that URL → resolves; one with neither → `SPOTIFY_UNREADABLE`.
  - fetch that throws `TypeError('fetch failed')` → `NETWORK`; Apple lookup with status 503 → `NETWORK`; fetch that rejects with a `TimeoutError` → `NETWORK`.
  - `podcastErrorMessage(new Error('x'))` → the `OTHER` copy.
- [ ] **Step 2: Run** `node --test test/podcast-link.test.js` — Expected: new tests FAIL.
- [ ] **Step 3: Implement** `PodcastLinkError`, `resolvePodcastLink`, `podcastErrorMessage` per the flow above.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck` — Expected: all pass.
- [ ] **Step 5: Commit** `git add src/podcast-link.js test/podcast-link.test.js test/fixtures/podcast && git commit -m "Resolve Spotify and Apple Podcasts episode links"`

### Task 4: Wire it into the app

**Files:**
- Modify: `src/main.js` (new IPC handler next to `summarize`), `src/preload.js`, `src/renderer.js` (`loadUrl`), `README.md`

**Interfaces:**
- Consumes: Task 1 `UiLogic.podcastLinkKind`, Task 3 `resolvePodcastLink`, `podcastErrorMessage`.
- Produces: IPC `resolve-podcast-link(url)` → `{ mediaUrl, title, show, service }`; preload `api.resolvePodcastLink(url)`.

- [ ] **Step 1: main.js.** `ipcMain.handle('resolve-podcast-link', …)` calls `resolvePodcastLink(url, { fetch: net.fetch, regions: [app.getLocaleCountryCode().toLowerCase(), 'us'].filter(Boolean), signal })`. Keep one `AbortController` (`podcastController`), aborting the previous on each call. Rethrow `new Error(podcastErrorMessage(err), { cause: err })`. An abort caused by a newer call is fine to surface as an error: the renderer ignores late results.
- [ ] **Step 2: preload.js.** `resolvePodcastLink: (url) => ipcRenderer.invoke('resolve-podcast-link', url)`.
- [ ] **Step 3: renderer.js `loadUrl`.** Right after the `guardLoadMedia` check, `const kind = UiLogic.podcastLinkKind(url)`:
  - `spotify-show`/`apple-show`: `showError(<SHOW_LINK copy>)`; return without touching current media.
  - episode kinds (`spotify`, `apple`, `spotify-short`): `currentFilePath = null`; `setDropzoneFile('Finding episode…', kind.service === 'apple' ? 'Apple Podcasts' : 'Spotify')`; clear the URL field; `resetForNewMedia()`; capture `const generation = mediaGeneration`; disable `#transcribe-btn`. `await api.resolvePodcastLink(url)`. If `generation !== mediaGeneration` return. On error: `clearMedia()` then `showError(UiLogic.errorMessage(err))`. On success: `currentFilePath = mediaUrl`; `currentFileName = title`; `setDropzoneFile(title, `${service} · ${show}`)`; re-enable the button; `loadWaveform(mediaUrl)`; return.
  - Otherwise: existing code unchanged.
  - Make sure `startTranscription`'s `!currentFilePath` check covers the resolving window, and that `clearMedia`/new loads re-enable the button.
- [ ] **Step 4: README.** In the link section, add: Spotify and Apple Podcasts single-episode links work for shows with a public feed; Spotify-only shows don't.
- [ ] **Step 5: Verify** `npm test && npm run lint && npm run typecheck` — Expected: all pass. Then run the app against the real services (public, no credentials) with a throwaway `--user-data-dir`, and check:
  - The Spotify link `https://open.spotify.com/episode/4ZDqaBObIEQr68g4oXT15u` loads, the source bar shows "Measles Is Officially Back. What Now?" / "Spotify · The Daily", the waveform appears, and transcribing the first 30 seconds (trim) produces text.
  - The Apple link `https://podcasts.apple.com/us/podcast/the-daily/id1200361736?i=1000803574143` gives the same title and "Apple Podcasts · The Daily".
  - A show link shows the `SHOW_LINK` copy and the previous media stays loaded.
  - Pasting the Apple link and then, before it resolves, a direct MP3 link leaves the MP3 loaded.
  - A YouTube link and a direct MP3 link still load as before.
- [ ] **Step 6: Commit** `git add src/main.js src/preload.js src/renderer.js README.md && git commit -m "Load Spotify and Apple Podcasts episode links"`
