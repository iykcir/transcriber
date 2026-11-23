# Spotify and Apple Podcasts episode links: design

Date: 2026-11-23
Branch: `feature/spotify-links`

## Intent

Rick finds podcast episodes on Spotify and Apple Podcasts. He wants to paste an episode's link into the transcriber and get a transcript (and a summary, if summaries are on), so he can skim an episode before deciding to listen. Today both kinds of link fail with "Could not load URL. Check the link is accessible and points to audio or video.", because the app only loads YouTube links and direct media links.

Success means: paste a single-episode link from either service, and the app loads that episode's audio exactly as if he had pasted its MP3 link. Waveform, trim, transcription, history, export and summaries then work unchanged.

## Goals

- Spotify episode links (`open.spotify.com/episode/<id>`, with or without `?si=` and other query parameters, and with an optional locale segment such as `/intl-de/episode/<id>`) load the episode's public audio.
- Apple Podcasts episode links (`podcasts.apple.com/<country>/podcast/<slug>/id<showId>?i=<episodeId>`, also without the slug or the country segment) load the episode's public audio.
- Spotify share short links (`spotify.link/<code>`) and `spotify:episode:<id>` URIs work too. *(Builder's call: the Spotify app shares these forms, and failing on them would repeat the exact error this feature fixes.)*
- The source bar shows the real episode title and the show name while and after loading.
- When an episode can't be found, the error says why in plain words.

## Non-goals

- Show links, playlists, or an episode picker. Rick only pastes single episodes ("just single episodes").
- Spotify-exclusive shows. Their audio is copy-protected and has no public feed; the app explains this instead of trying.
- Other podcast apps (Overcast, Pocket Casts, YouTube Music). Can come later if wanted.
- Podcast Index or any service that needs an account or API key.

## Anti-goals

- Never download Spotify's own audio stream or work around copy protection.
- Never transcribe the wrong episode silently. If the match is uncertain, fail with a message rather than guess.
- No new npm dependencies and no accounts.

## Approaches considered

- **A. Resolver in the app (chosen by Rick).** Apple links: look the show up with Apple's free lookup service and find the episode by its ID. Spotify links: read the title, show name and date from the public episode page, find the show with Apple's podcast search, and match the episode. Fall back to the show's RSS feed for older episodes. No accounts, no new dependencies, testable with saved responses.
- **B. Hand the links to yt-dlp.** It handles Apple links but not Spotify's protected audio, so Spotify would still need A. Rejected: two mechanisms for no gain.
- **C. Podcast Index instead of Apple search.** Slightly wider coverage but needs Rick to register for an API key. Rejected for now; revisit only if Apple matching misses in practice.

## What was verified (2026-11-23, no login, plain HTTP)

- Spotify episode page `https://open.spotify.com/episode/4ZDqaBObIEQr68g4oXT15u` returns HTTP 200 with:
  - `<meta property="og:title" content="Measles Is Officially Back. What Now?"/>` (episode title)
  - `<meta property="og:description" content="The Daily · Episode"/>` (show name, before ` · `)
  - `<meta name="music:release_date" content="2026-11-23T10:45:00Z"/>`
  - `<meta name="music:duration" content="1430"/>` (seconds)
- Spotify oEmbed (`https://open.spotify.com/oembed?url=…`) gives only the episode title, not the show, so the page itself is the source.
- `https://itunes.apple.com/lookup?id=1200361736&entity=podcastEpisode&limit=N` returns the show (`wrapperType: "track"`, `kind: "podcast"`, `feedUrl`) followed by its most recent episodes (`kind: "podcast-episode"`, `trackId`, `trackName`, `releaseDate`, `trackTimeMillis`, `episodeUrl`). The `episodeUrl` is a direct MP3 link (here a podtrac redirect). Apple caps `limit` at 200.
- Looking up an episode ID directly (`lookup?id=1000803574143&entity=podcastEpisode`) returns zero results, so Apple links must go through the show ID.
- `https://itunes.apple.com/search?term=The%20Daily&media=podcast&entity=podcast` returns matching shows with `collectionId`, `collectionName`, `feedUrl`; the exact-name match was first.
- The Apple episode web page has `<meta property="og:title" content="<episode title>">`.

## How it works

### Where it runs

A new main-process module, `src/podcast-link.js`, does all network work and matching. The renderer calls it over a new IPC channel `resolve-podcast-link(url)` exposed in `preload.js` as `resolvePodcastLink`. The renderer never fetches these services directly. HTTP goes through an injectable fetch function (default: Electron's `net.fetch`, as the update check in `main.js` already uses, so system proxy settings apply) so every step is unit-testable with saved responses. Each request has a 15-second timeout.

Result on success: `{ mediaUrl, title, show, service }` where `service` is `'Spotify'` or `'Apple Podcasts'`.

On failure it throws an error whose message is already written for people (same pattern as `SummaryError` in `src/summarize.js`).

### Recognising links (pure, in `src/ui-logic.js` so the renderer can use it too)

`podcastLinkKind(url)` returns one of:
- `{ service: 'spotify', episodeId }` for Spotify episode links (host `open.spotify.com`, path `/episode/<22-char id>` with an optional leading `/intl-xx` segment).
- `{ service: 'apple', showId, episodeId, country }` for Apple links that have both `id<digits>` in the path and `i=<digits>` in the query. Country is the first path segment, default `us`.
- `{ service: 'spotify-show' }` or `{ service: 'apple-show' }` for show links (Spotify `/show/`, Apple link without `?i=`), so the app can say "paste a link to a single episode".
- `{ service: 'spotify-short' }` for `spotify.link/…` links. The main process follows the redirect (at most 5 hops) to the `open.spotify.com` URL and re-classifies it; a short link that leads to a show gets the show-link message from the main process.
- `spotify:episode:<id>` URIs are treated as Spotify episode links.
- `null` for anything else (existing YouTube and direct-link behaviour unchanged).

### Which Apple catalogue

Apple's search and lookup are per-country catalogues. Apple links name their country in the path (default `us`). Spotify links don't (`/intl-de/` is a language, not a country), so the Spotify path searches the Mac's region first (`app.getLocaleCountryCode()`, lower-cased) and then `us` if that's different and nothing matched. *(Builder's call: covers regional shows Rick might follow without asking him to configure anything; costs at most one extra search.)*

### Apple episode links

1. `lookup?id=<showId>&entity=podcastEpisode&limit=200&country=<country>`.
2. If an episode's `trackId` equals the link's episode ID and it has an `episodeUrl`, use its `episodeUrl`, `trackName` and the show's `collectionName`. Done.
3. Otherwise (older episode): fetch the Apple episode page, read `og:title`, then match that title against the show's RSS feed (`feedUrl` from step 1) as described under "RSS fallback".

### Spotify episode links

1. Fetch `https://open.spotify.com/episode/<id>` and read `og:title`, the show name from `og:description` (text before ` · `), `music:release_date`, `music:duration`. HTML entities in these values are decoded. If `og:title` or the show name is missing, fail with the "couldn't read this Spotify link" message.
2. `search?term=<show name>&media=podcast&entity=podcast&limit=10`. Candidate shows are those whose `collectionName` matches the show name after normalisation. If none match exactly, fail with the "couldn't find this show" message.
3. For each candidate show (in order, at most 3): lookup its recent episodes as in Apple step 1 and run the episode match below. First confident match wins.
4. If no candidate has a confident match in its recent episodes, try the RSS fallback on each candidate's `feedUrl`.

### Episode matching

Normalise titles: lower case, Unicode NFKC, curly quotes and apostrophes to straight, strip punctuation, collapse whitespace.

A candidate episode is a **confident match** when either:
- its normalised title equals the target's, and (if both dates are known) the release dates are within 2 days of each other; or
- no episode has an equal title, but exactly one episode has a release date within 1 day **and** a duration within 5% (or 30 seconds, whichever is larger) of the target's.

If two or more episodes are equally good, that is not confident: fail with the "couldn't match" message rather than guess.

### RSS fallback

Fetch the feed (follow redirects, 15 s timeout, give up above 20 MB). Parse `<item>` blocks for `<title>` (with or without CDATA), `<enclosure url="…">`, `<pubDate>` and `<itunes:duration>` (seconds or `HH:MM:SS`). No XML library: a small tolerant extractor is enough for these four fields, and its tests use real-shaped feed snippets (CDATA titles, entities like `&amp;`, missing duration). Match with the same rules as above. Use the enclosure URL as `mediaUrl`.

### Renderer flow

In `loadUrl`, before anything else, check `UiLogic.podcastLinkKind(url)`:
- Show link: show the error "This is a link to a whole show. Paste a link to a single episode." and keep the current media as it is.
- Episode link: set the source bar to a placeholder (`Finding episode…`, meta `Spotify` or `Apple Podcasts`), call `api.resolvePodcastLink(url)`, and on success continue exactly as for a direct link, with `currentFilePath = mediaUrl`, display name = episode title, file name = episode title, meta `<service> · <show>`. Waveform loading starts after resolution.
- While resolving, the app is in a loading state: the Transcribe button is disabled until the media URL is known. *(Builder's call.)*
- A newer load (another link, file, or Close) while resolving wins: the late result is ignored, using the existing `mediaGeneration` pattern.
- On failure: clear back to the empty drop zone and show the error message.

History stores the resolved `mediaUrl` as `source` (so reopening or re-transcribing a recent entry never needs to resolve again) and the episode title as its name. *(Builder's call recorded here: storing the MP3 link rather than the original Spotify/Apple link keeps every later step identical to direct links.)*

### Error messages (exact copy)

- Show link: "This is a link to a whole show. Paste a link to a single episode."
- Spotify page unreadable or missing fields: "Couldn't read this Spotify link. Check that it's a podcast episode."
- Show not found in Apple's directory (Spotify path): "Couldn't find this show in a public podcast directory. Spotify-only shows can't be transcribed."
- Episode not found or not confidently matched: "Couldn't find this episode in the show's public feed."
- Episode found but has no public audio (subscriber-only): "This episode is only available to subscribers, so it can't be transcribed."
- Network failure or timeout: "Couldn't reach the podcast service. Check your internet connection."
- Any other failure: "Couldn't load this podcast link."

## Constraints

- No new npm dependencies.
- No API keys or accounts.
- All HTTP in the main process; the renderer only gets the result.
- Untrusted text (titles, show names) goes into the UI with `textContent`, as the existing source bar already does.
- Existing YouTube and direct-link loading must behave exactly as before.
- Tests run offline: `node --test` with saved response fixtures; no test hits the network.

## Left to the builder

- Fixture layout and helper names inside `src/podcast-link.js`.
- The exact regexes for meta tags and RSS fields, within the cases listed above.
- Whether `resolve-podcast-link` requests can be cancelled when a newer load starts (ignoring the late result is required; aborting it is optional).
