# Transcript summaries (Claude API, opt-in)

## Intent

Rick mostly wants to **skim an episode before deciding whether to listen**. A summary
should answer "what is this about, and which parts are worth my time?" in about thirty
seconds of reading, and it should be the first thing on screen once a transcript exists.

Transcription stays fully on-device. Summaries are an explicit opt-in that sends only
the transcript text to Anthropic, using the user's own API key.

## Goals

- A **Summary card above the transcript**: 2–3 sentence overview, then 4–6 main topics.
  Each topic carries a start time when the transcript has timestamps.
- A **Summarize** button for one-off use, and a Settings toggle **Summarize
  automatically after transcribing** (off by default).
- The user's Anthropic API key entered once in Settings and stored encrypted.
- Summaries saved with the recent transcript they belong to and restored when it reopens.
- Summaries included at the top of TXT, Markdown, DOCX and PDF exports.

## Non-goals

- Chatting with or asking questions about a transcript.
- Several summary styles or lengths to pick from.
- Local or Apple on-device models. The summarize step is written so another provider
  could be added later, but only Claude ships now.
- Splitting long transcripts into chunks. A multi-hour transcript fits in one request.
- Summarizing older recent transcripts in bulk.

## Anti-goals (failure even if it "works")

- The API key ending up in plain text on disk, in logs, or anywhere in the renderer.
- Any text sent to Anthropic without the user having added a key and either clicking
  Summarize or turning on auto-summarize.
- Summarizing blocking the transcript. The transcript stays readable and editable while
  a summary is generated.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | Collapsible Summary card above the transcript text box | Seen first, which suits skimming. It's a new element, so the transcript box and Translate are unchanged. |
| B | Transcript / Summary tabs | Tidier, but the summary sits behind a tab. |
| C | Separate window or sheet | Simple, but it hides the transcript and has to be reopened for each saved transcript. |

Rick picked **A plus the auto-summarize toggle**. Claude API over a local model or
Apple's on-device model was decided earlier: best quality, one request even for long
episodes, least work in the Electron app.

## Design

### What the user sees

```
┌ Summary ───────────────────────────── ⟳  ▾ ┐
│ Two founders discuss why their startup      │
│ pivoted from hardware to software…          │
│ • 00:04 Early hardware struggles            │
│ • 00:18 The pivot decision                  │
│ • 00:41 Hiring after the pivot              │
└─────────────────────────────────────────────┘
[ transcript text box, unchanged ]
```

- **No key set:** no Summarize button and no card. Settings shows the key field.
- **Key set, no summary yet:** a **Summarize** button in the transcript footer, next to
  Translate.
- **Summarizing:** the card shows "Summarizing…" with a Cancel link. The transcript stays
  usable.
- **Done:** the card shows the overview and topics. ⟳ regenerates it, for example after
  editing or translating the transcript. ▾ collapses the card, and that choice is
  remembered across transcripts.
- **Failed:** the card shows a one-line error and a Retry link. Errors are written for
  people: a rejected key ("Your API key was rejected. Check it in Settings."), no
  connection, rate limited, and declined by the model.
- Topic times are shown as `MM:SS` or `H:MM:SS`. Clicking one doesn't jump anywhere in
  this version.

### Settings

- **Anthropic API key**: a password field with Save and Remove buttons. Once a key is
  saved, the field shows "Key saved" instead of the key. Under it: "Summaries send the
  transcript text to Anthropic. Get a key at console.anthropic.com."
- **Summarize automatically after transcribing**: a toggle, only enabled while a key is
  saved. Stored as `autoSummarize` in the config, default `false`.

### Key storage

- The main process encrypts the key with Electron `safeStorage.encryptString`, which
  uses the macOS Keychain, and stores it base64-encoded in the config as
  `anthropicKeyEnc`.
- The renderer never receives the key. `get-settings` returns only `hasApiKey: boolean`.
  New IPC: `set-api-key(key)` and `remove-api-key()`.
- If `safeStorage.isEncryptionAvailable()` is false, saving the key fails with a clear
  message. It never falls back to plain text.

### The request (main process, new `src/summarize.js`)

- Dependency: `@anthropic-ai/sdk`, used only in the main process.
- Model `claude-opus-5-5`, `output_config.effort: "low"` (summarizing is an easy task,
  and low effort keeps it fast and cheap), `max_tokens: 16000`, non-streaming.
- Server-side refusal fallback on by default: beta `server-side-fallback-2026-07-01`
  with `fallbacks: "default"`.
- Structured output (`output_config.format`, a JSON schema) returns
  `{ overview: string, topics: [{ title: string, startSec: number | null }] }`.
  The app renders this. It doesn't parse free text.
- The prompt tells the model the reader is deciding whether to listen. It asks for an
  overview of at most 3 sentences and 4–6 topics in order, written in the transcript's
  language. Topic start times come from the `[HH:MM:SS.mmm --> …]` markers when they
  exist, otherwise `null`.
- If the summary was asked for on a trimmed range, the markers are already relative to
  that range and are used as they are.
- Cancel uses an `AbortController`, the same pattern as transcription cancel.
- Check `stop_reason`. `refusal` becomes the "declined" error. SDK error classes map to
  the messages above: `AuthenticationError` means the key was rejected,
  `RateLimitError` means rate limited, `APIConnectionError` means no connection.
- Pure, unit-tested helpers live in `summarize.js`: build the prompt, validate and
  normalise the model's JSON, and format a summary as plain text or Markdown for export.

### Saving and export

- `HistoryEntry` gains an optional `summary: { overview, topics, createdAt } | null`.
  New IPC `history-update-summary(id, summary)`. `list()` stays as it is.
- Opening a recent transcript restores its summary into the card.
- Exports: TXT, MD, DOCX and PDF put a "Summary" section (the overview, then the topics
  as a list) before the transcript when a summary exists. SRT is unchanged.

### Where a summary lives (decided by Claude; Rick to check)

- The summary for the transcript on screen is **renderer state**. It is also written to
  the history entry when one exists (`currentHistoryId` is set).
- **With "Keep recent transcripts" off**, Summarize and auto-summarize still work. The
  summary is kept only in memory for the transcript on screen, and exports still include
  it. The renderer passes the summary to the export IPC alongside the transcript. Main
  does not look it up by history id.
- **Saved summaries don't depend on the key.** If a key was never added or has been
  removed, saved summaries still show in the card and in exports, but read-only: there
  is no ⟳ or Retry and no Summarize button. Only making new summaries needs a key.
- **Removing the key** disables the auto-summarize toggle but leaves `autoSummarize`
  as it was in the config, so it applies again when a key is added back.

### Flow

- When a transcription finishes, if `autoSummarize` is on and a key is saved,
  summarizing starts on its own, whether or not history is kept.
- A result that arrives after the user has loaded other media is thrown away, using the
  existing `mediaGeneration` guard.
- Translating or editing the transcript doesn't clear the summary. ⟳ is how to refresh it.

### Docs and tests

- README: a Summaries section, a mention in Settings, and a line under Requirements that
  summaries need an Anthropic API key and an internet connection.
- Tests: `summarize.js` helpers (prompt contents, JSON validation, timestamp
  formatting, export text), the history `summary` field, and exports with and without
  a summary. The API call itself is not covered by unit tests.

## Left to the builder

- Exact styling of the card, following the existing tokens in `index.html`.
- Exact prompt wording within the constraints above.
- How the IPC for cancel and progress is named, following existing conventions.
