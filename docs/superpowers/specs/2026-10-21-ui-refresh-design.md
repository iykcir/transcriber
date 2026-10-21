# UI Refresh — Design

Date: 2026-10-21
Status: Approved in conversation, pending spec review

## Goal

Make Transcriber feel sleek and efficient for its primary use: **one file at a
time** — drop a file, transcribe, copy or export, done. Success means fewer
visible controls at every step, no trip to Settings before a normal run, and
the transcript getting most of the window once it exists.

## Non-goals

- Clickable timestamp segments, transcript search, batch/queue processing.
- Auto-transcribe on drop (decided: drop only loads; the user presses
  Transcribe or ⌘↩ so trimming stays usable).
- New libraries, frameworks, or a build step for the renderer.
- Changes to recording, system-audio capture, URL loading, trimming logic,
  Google-translate, or the save dialogs beyond restyling and re-wiring.

## Layout

A slim title bar plus one content area that is always in exactly one state.

### Title bar

- Stays draggable; same height as today (`titleBarStyle: 'hiddenInset'`).
- Center: app name when empty; the loaded file's display name otherwise.
- Right: **Export ▾** (visible only in the `transcribed` state) and the
  settings gear.

### States

| State          | Content area                                                                 |
|----------------|------------------------------------------------------------------------------|
| `empty`        | Large drop zone: mic icon, "Drop audio or video, or click to browse", format hint. Inside the zone, below the text, a compact row: `● Record mic` · `▭ System audio` · `[Paste a link…]` input (Enter loads). No "or" divider, no separate input block. |
| `recording`    | Drop zone shows red dot, timer, Stop, Cancel (current behavior, restyled).   |
| `loaded`       | Drop zone collapses to a ~44px **source bar**: file icon · name · duration/size · `Change` (also ⌘O). Below: video preview (video files only), waveform/trim strip, then the **action row**: `[Model ▾] [Language ▾]` … `[Transcribe ⌘↩]`. |
| `transcribing` | Same as `loaded`, but the Transcribe button shows progress (see Controls), a Cancel control appears beside it, and pickers / Change / waveform handles are disabled. |
| `transcribed`  | Waveform strip folds to a thin bar showing the trim range and a small play button. The transcript textarea fills the remaining height. A footer under it shows char count, Copy, and "Translate to English" (when applicable, same rules as today). |

Loading new media from any non-recording state returns to `loaded` and clears
the transcript (same as today's `resetForNewMedia`).

Removed elements: the separate `#input-options` block and its divider,
`#status-area` (spinner, ok/err icons, status text), the bottom `#toolbar` with
six buttons.

## Controls and flow

### Model and Language pickers

- Live in the action row; populated with the same options as today.
- They read from and write to the existing settings store
  (`api.getSettings` / `api.setSettings`); a change persists immediately and
  becomes the default for next time.
- The Settings modal keeps only: "Include timestamps in output",
  "Translate to English (Whisper)", and the model-download/cache note.

### Transcribe button with in-place progress

- Click or ⌘↩ starts transcription.
- The button becomes a progress bar filling in place, with label text:
  "Downloading model… N%" during model download, then "Transcribing… N%".
- A small **Cancel** button appears beside it.
- Success: button resets, state → `transcribed`.
- Failure: button resets, state → `loaded`, and a single-line red inline
  message appears under the action row (full text in its `title` tooltip).
  The message clears on the next run or on loading new media.
- Pre-transcription errors that currently use `showStatus('error', …)`
  (mic/screen permission denied, no audio captured, URL load failures) use the
  same inline message element, shown in whatever state the app is in.

### Cancel (new behavior)

- `src/transcribe.js` tracks every child process it starts (the ffmpeg
  `spawn`/`execFile` calls, yt-dlp `execFile`, whisper-cli `spawn`) in a
  module-level `Set`, removing each on exit.
- New exported `cancelTranscription()` sets a cancelled flag, kills all
  tracked processes (`SIGTERM`), and causes the in-flight `transcribeAudio`
  promise to reject with an `Error` whose message is `'Cancelled'`. Temporary
  WAV cleanup still runs (existing `finally`/cleanup path).
- `src/main.js`: `ipcMain.handle('cancel-transcription', …)` calls it.
- `src/preload.js`: `cancelTranscription: () => ipcRenderer.invoke('cancel-transcription')`.
- Renderer: on a `'Cancelled'` rejection, return quietly to `loaded` with no
  error message.
- An in-progress model download is not cancelled (it continues and is cached);
  only the ffmpeg/whisper/yt-dlp work for this job is stopped. If cancel is
  pressed during model download, the job rejects as `'Cancelled'` once the
  download finishes, before whisper starts.

### Export menu

- HTML dropdown anchored to the title-bar **Export ▾** button (the transcript
  lives in the renderer, so no native-menu IPC round-trip).
- Items: TXT, Markdown, Word (.docx), SRT subtitles, PDF — each calls the
  existing `api.saveTXT/saveMD/saveDOCX/saveSRT/savePDF` path unchanged.
- Keyboard: ↑/↓ to move, Enter to choose, Esc or outside click to close.
- "Saved" / "Copied" feedback keeps using the existing `#toast`.

### Keyboard shortcuts

| Shortcut | Action                  | Active when                          |
|----------|-------------------------|--------------------------------------|
| ⌘O       | Open file (existing app-menu item) | always                    |
| ⌘↩       | Transcribe              | `loaded` only                        |
| ⌘S       | Open Export menu        | `transcribed` only                   |
| ⌘⇧C      | Copy transcript         | `transcribed` only                   |
| Esc      | Close Export menu / Settings | when open                       |

Shortcuts do nothing outside their "active when" condition.

## Visual style

Native macOS utility, not a web form.

- Keep existing light/dark color tokens and window vibrancy.
- Remove most borders and card boxes; separate regions with spacing and a
  single hairline (`--border`).
- Type scale: 13px body, 11px secondary, 15px semibold file name.
- One prominent accent button (Transcribe). Everything else is quiet:
  borderless until hover, or icon-only (Copy, Export, gear, play).
- Pickers: compact 26px pill-style `<select>`s.
- Waveform: selected range in `--accent`, unselected region muted
  (`--text-secondary` at reduced opacity).
- Transitions ~150ms (opacity/height) between states; none under
  `prefers-reduced-motion: reduce`.
- Visible `:focus-visible` rings on all interactive elements.

## Implementation shape

- `src/index.html`: new markup and rewritten CSS. Element IDs that survive keep
  their names; removed IDs: `input-options`, `status-area`, `status-spinner`,
  `status-icon-ok`, `status-icon-err`, `status-text`, `toolbar`. The
  per-format export buttons (`btn-txt`, `btn-md`, `btn-docx`, `btn-srt`,
  `btn-pdf`) become Export menu items and keep their IDs; `btn-copy` and
  `btn-translate` move to the transcript footer and keep theirs.
- `src/renderer.js`: a single `setState(name)` owns which regions are visible
  and enabled (sets `data-state` on `#app`; CSS does the show/hide). It
  replaces scattered `classList.add/remove('visible')` / `style.display`
  toggles. Adds picker wiring, button progress, inline error element, Export
  dropdown, and one `keydown` handler for shortcuts.
- `src/transcribe.js`, `src/main.js`, `src/preload.js`: cancel support as
  described above.

## Testing

- `npm run typecheck` and `npm run lint` pass.
- Throwaway Playwright script (playwright-core is already a devDependency)
  launches the Electron app and screenshots each state in light and dark for
  visual review. Not committed as a test suite.
- Manual checks: transcribe a short file; cancel mid-run (process actually
  stops, no orphaned ffmpeg/whisper-cli); trim then transcribe; mic recording;
  URL load; each export format; every shortcut, including that each is inert
  outside its active state; Settings save/cancel.
