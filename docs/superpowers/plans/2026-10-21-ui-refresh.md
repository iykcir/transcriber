# UI Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Transcriber's single window into a state-driven, one-file-at-a-time layout with inline pickers, in-button progress, cancel, an Export menu, and keyboard shortcuts.

**Architecture:** `#app` carries `data-state` (`empty | recording | loaded | transcribing | transcribed`); CSS owns visibility per state and `renderer.js` calls one `setState()`. Pure decision logic (shortcuts, progress text, cancel detection) lives in a new `src/ui-logic.js` that loads as a browser script and is unit-tested under `node --test`. Cancel uses one module-level `AbortController` in `transcribe.js` whose `signal` is passed to every `spawn`/`execFile` of a transcription job.

**Tech Stack:** Electron 42, plain JS (CommonJS main, classic-script renderer), `node:test`, TypeScript `--checkJs` via `npm run typecheck`, ESLint, playwright-core (screenshots only).

**Spec:** `docs/superpowers/specs/2026-10-21-ui-refresh-design.md`

## Global Constraints

- No new runtime or dev dependencies, no renderer build step.
- Element IDs that survive keep their names; removed IDs per spec: `input-options`, `status-area`, `status-spinner`, `status-icon-ok`, `status-icon-err`, `status-text`, `toolbar` (plus `transcribe-btn-area`, `progress-bar-wrap`, `progress-track`, `progress-fill`, `progress-label`, which only existed for the status row).
- Cancel rejects with an `Error` whose message is exactly `'Cancelled'`; renderer returns quietly to `loaded` with no error.
- Progress copy: `"Downloading model… N%"`, then `"Transcribing… N%"`.
- Shortcuts: ⌘↩ transcribe (`loaded` only), ⌘S open Export menu (`transcribed` only), ⌘⇧C copy (`transcribed` only), Esc closes Export menu / Settings; ⌘O stays on the existing app-menu accelerator.
- Visual: keep existing color tokens and vibrancy; 13px body / 11px secondary / 15px semibold file name; pickers 26px pills; transitions ~150ms, none under `prefers-reduced-motion: reduce`; `:focus-visible` rings on all interactive elements.
- `npm run typecheck`, `npm run lint`, and `npm test` pass at the end of every task.

## Review Focus

1. **New media arrives mid-transcription** (⌘O menu, drag-drop onto the window) — expect it to be refused with a toast "Cancel the current transcription first", leaving the job untouched. Pinned by `canLoadMedia` tests (Task 1) and wired in Task 4.
2. **Shortcuts while Settings is open** — ⌘↩/⌘S/⌘⇧C must do nothing behind the modal; only Esc acts. Pinned in Task 1's `shortcutAction` tests.
3. **Electron's wrapped IPC error text** — an invoke rejection arrives as `"Error invoking remote method 'transcribe': Error: Cancelled"`, not `"Cancelled"`; a naive equality check would show cancel as an error. Pinned in Task 1's `isCancelledError` tests.
4. **Waveform preview fails** (unsupported preview codec, slow/failed URL) — `loaded` must still show the source bar and a working action row with no empty waveform box. Checked in Task 6 screenshot with no peaks.
5. **Very long file names** in the title bar and source bar — truncate with ellipsis, never push the gear/Export/Change off-screen. Checked in Task 6 screenshot with a 200-char name.

---

### Task 1: Test runner and pure UI logic module

**Files:**
- Create: `src/ui-logic.js`
- Create: `test/ui-logic.test.js`
- Modify: `package.json` (add `"test": "node --test test/"`)
- Modify: `src/globals.d.ts`
- Modify: `src/index.html` (add `<script src="ui-logic.js"></script>` immediately before `<script src="renderer.js">`)

**Interfaces:**
- Produces (on `globalThis.UiLogic` in the browser, `module.exports` under Node):
  - `/** @typedef {'empty'|'recording'|'loaded'|'transcribing'|'transcribed'} AppState */`
  - `shortcutAction(e: {key: string, metaKey: boolean, shiftKey: boolean}, ctx: {state: AppState, exportMenuOpen: boolean, settingsOpen: boolean}): 'transcribe'|'export'|'copy'|'close-export'|'close-settings'|null`
  - `isCancelledError(err: unknown): boolean`
  - `progressText(phase: 'download'|'transcribe', pct: number, isStream: boolean): string`
  - `canLoadMedia(state: AppState): boolean`
- `globals.d.ts` gains `declare var UiLogic: typeof import('./ui-logic');`

- [ ] **Step 1: Write the failing tests** in `test/ui-logic.test.js` using `node:test` + `node:assert/strict`, requiring `../src/ui-logic`:

```js
const ctx = (state, o = {}) => ({ state, exportMenuOpen: false, settingsOpen: false, ...o });
const key = (k, o = {}) => ({ key: k, metaKey: false, shiftKey: false, ...o });

test('cmd+enter transcribes only when loaded', () => {
  assert.equal(shortcutAction(key('Enter', { metaKey: true }), ctx('loaded')), 'transcribe');
  for (const s of ['empty', 'recording', 'transcribing', 'transcribed'])
    assert.equal(shortcutAction(key('Enter', { metaKey: true }), ctx(s)), null);
  assert.equal(shortcutAction(key('Enter'), ctx('loaded')), null);
});
test('cmd+s opens export and cmd+shift+c copies only when transcribed', () => {
  assert.equal(shortcutAction(key('s', { metaKey: true }), ctx('transcribed')), 'export');
  assert.equal(shortcutAction(key('S', { metaKey: true, shiftKey: true }), ctx('transcribed')), null);
  assert.equal(shortcutAction(key('c', { metaKey: true, shiftKey: true }), ctx('transcribed')), 'copy');
  assert.equal(shortcutAction(key('C', { metaKey: true, shiftKey: true }), ctx('transcribed')), 'copy');
  assert.equal(shortcutAction(key('c', { metaKey: true }), ctx('transcribed')), null); // plain ⌘C stays native copy
  assert.equal(shortcutAction(key('s', { metaKey: true }), ctx('loaded')), null);
});
test('escape closes export menu first, then settings', () => {
  assert.equal(shortcutAction(key('Escape'), ctx('transcribed', { exportMenuOpen: true, settingsOpen: true })), 'close-export');
  assert.equal(shortcutAction(key('Escape'), ctx('loaded', { settingsOpen: true })), 'close-settings');
  assert.equal(shortcutAction(key('Escape'), ctx('loaded')), null);
});
test('only escape acts while settings is open', () => {
  assert.equal(shortcutAction(key('Enter', { metaKey: true }), ctx('loaded', { settingsOpen: true })), null);
  assert.equal(shortcutAction(key('s', { metaKey: true }), ctx('transcribed', { settingsOpen: true })), null);
  assert.equal(shortcutAction(key('c', { metaKey: true, shiftKey: true }), ctx('transcribed', { settingsOpen: true })), null);
});
test('isCancelledError matches raw and IPC-wrapped messages only', () => {
  assert.equal(isCancelledError(new Error('Cancelled')), true);
  assert.equal(isCancelledError(new Error("Error invoking remote method 'transcribe': Error: Cancelled")), true);
  assert.equal(isCancelledError(new Error('Transcription failed: whisper exited')), false);
  assert.equal(isCancelledError(new Error('User Cancelled the save dialog?')), false);
  assert.equal(isCancelledError(null), false);
  assert.equal(isCancelledError('Cancelled'), false);
});
test('progressText', () => {
  assert.equal(progressText('download', 30, false), 'Downloading model… 30%');
  assert.equal(progressText('transcribe', 2, false), 'Preparing audio…');
  assert.equal(progressText('transcribe', 2, true), 'Fetching audio…');
  assert.equal(progressText('transcribe', 42, false), 'Transcribing… 42%');
});
test('canLoadMedia is false only while recording or transcribing', () => {
  for (const s of ['empty', 'loaded', 'transcribed']) assert.equal(canLoadMedia(s), true);
  for (const s of ['recording', 'transcribing']) assert.equal(canLoadMedia(s), false);
});
```

- [ ] **Step 2: Run `npm test`** — Expected: FAIL, `Cannot find module '../src/ui-logic'`.

- [ ] **Step 3: Implement `src/ui-logic.js`.** Classic script, no `require`. Rules: Escape → `close-export` if `exportMenuOpen`, else `close-settings` if `settingsOpen`, else `null`; any non-Escape key → `null` when `settingsOpen`; keys compare case-insensitively; `isCancelledError` is true iff `err instanceof Error` and `/(^|: )Cancelled$/.test(err.message)`; `progressText('transcribe', pct)` returns the preparing/fetching text when `pct < 5`. End with:

```js
const UiLogic = { shortcutAction, isCancelledError, progressText, canLoadMedia };
if (typeof module !== 'undefined') module.exports = UiLogic;
else globalThis.UiLogic = UiLogic;
```

Add the `<script>` tag and the `globals.d.ts` declaration.

- [ ] **Step 4: Run `npm test && npm run typecheck && npm run lint`** — Expected: all tests pass, no errors.

- [ ] **Step 5: Commit** — `git add package.json src/ui-logic.js test/ui-logic.test.js src/globals.d.ts src/index.html && git commit -m "Add UI logic module with node:test suite"`

---

### Task 2: Cancel support in main process

**Files:**
- Modify: `src/transcribe.js` (`ffmpegToWav` ~L202, `downloadYouTube` ~L231, `convertToWav`, `runWhisper` ~L370, `transcribeAudio` ~L443, `module.exports`)
- Modify: `src/main.js` (new handler after `'transcribe'` handler ~L157)
- Modify: `src/preload.js`

**Interfaces:**
- Produces: `cancelTranscription(): boolean` exported from `transcribe.js` (true if a job was running); IPC channel `'cancel-transcription'`; `api.cancelTranscription(): Promise<boolean>`.
- Helper signatures gain a trailing optional `signal` (`AbortSignal`): `ffmpegToWav(inputPath, outPath, startSec, endSec, signal)`, `downloadYouTube(url, outPath, startSec, endSec, signal)`, `convertToWav(inputPath, startSec, endSec, signal)`, `runWhisper(wavPath, modelPath, language, includeTimestamps, translate, onProgress, signal)`. `getWaveformPeaks` passes none (preview work is never cancelled).

- [ ] **Step 1: Thread `signal`.** Module-level `let activeJob = null;` (an `AbortController`). Pass `{ env: process.env, signal }` to every `spawn`/`execFile` in the four helpers. In the ytdl-core fallback, `signal?.addEventListener('abort', () => ytStream.destroy(), { once: true })`.

- [ ] **Step 2: Wire `transcribeAudio`.** Create `const job = new AbortController(); activeJob = job;` at entry. After `downloadModel` resolves and again right before `runWhisper`, `if (job.signal.aborted) throw new Error('Cancelled')`. First line of the existing `catch`: `if (job.signal.aborted) throw new Error('Cancelled');` (bypasses the "Transcription failed:" wrapping). In `finally`, keep WAV cleanup and add `if (activeJob === job) activeJob = null;`. `cancelTranscription()` aborts `activeJob` if set and returns whether it did.

- [ ] **Step 3: Expose it.** `ipcMain.handle('cancel-transcription', () => require('./transcribe').cancelTranscription());` and `cancelTranscription: () => ipcRenderer.invoke('cancel-transcription'),` in the preload `api` object.

- [ ] **Step 4: Verify** — `npm run typecheck && npm run lint && npm test`: no errors. Then `npm start`, load a ≥1-minute file, transcribe, and in DevTools console run `api.cancelTranscription()` mid-run. Expected: returns `true`; the old status row shows an error containing `Cancelled` (UI handling comes in Task 4); `pgrep -fl 'whisper-cli|ffmpeg'` shows no leftover processes; no `whisper-*.wav` remains in `$TMPDIR`.

- [ ] **Step 5: Commit** — `git commit -am "Add transcription cancel via AbortController"`

---

### Task 3: State-driven layout and restyle

**Files:**
- Modify: `src/index.html` (markup + full CSS rewrite)
- Modify: `src/renderer.js` (element refs, `setState`, recording/file/URL flows, settings)

**Interfaces:**
- Consumes: `UiLogic` (Task 1).
- Produces (renderer globals used by Tasks 4–6): `let appState` (`AppState`); `setState(next: AppState): void` — sets `appState`, `#app.dataset.state`, `#title-text` text (`'Transcriber'` when `empty`/`recording`, else display name), and calls `drawWaveform()` if peaks exist (heights change per state); `showError(msg: string): void` / `clearError(): void` on `#inline-error` (sets `textContent` and `title`).
- New element IDs: `title-text`, `dropzone-content`, `input-row`, `source-change`, `action-row`, `inline-error`, `transcript-footer`, `export-btn`, `export-menu`, `cancel-btn`, `transcribe-fill`, `transcribe-label`. Export items `btn-txt`/`btn-md`/`btn-docx`/`btn-srt`/`btn-pdf` live inside `#export-menu` (`role="menu"`, items `role="menuitem"`, labels "TXT", "Markdown", "Word (.docx)", "SRT subtitles", "PDF"); `btn-copy`, `btn-translate`, `char-count` live in `#transcript-footer`. `model-select`/`language-select` move to `#action-row` with their existing options.

- [ ] **Step 1: Markup.** Per spec Layout section. Title bar: `#title-text` centered (ellipsis), right side `#export-btn` (hidden unless `transcribed`, `#export-menu` absolutely positioned under it, initially `hidden`) and `#gear-btn`. `#dropzone` contains `#dropzone-content` (the only part whose `innerHTML` is ever replaced) and the permanent `#input-row` (record-btn, system-audio-btn, url-input, url-load-btn). Delete `#input-options`, `#status-area`, `#toolbar`, `#transcribe-btn-area`. `#transcribe-btn` contains `#transcribe-fill` and `#transcribe-label` ("Transcribe" + a `⌘↩` hint span); `#cancel-btn` beside it, hidden by default. Settings modal: remove Model and Language groups; label the toggle "Translate to English (Whisper)"; keep the model-cache note.

- [ ] **Step 2: CSS.** Visibility by `#app[data-state=…]` selectors per the spec's States table; `#waveform-section.visible` still gates the waveform (peaks loaded). `transcribed` folds the canvas to 16px and lets `#transcript` flex to fill. `transcribing` sets `pointer-events: none; opacity: .5` on handles, pickers, and `#source-change`. Title text and `.file-name` use `overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0`. Waveform draw: unselected bars `--text-secondary` at 0.35 alpha, bars inside `[trimStart, trimEnd]` in `--accent` (update `drawWaveform` and redraw from `updateHandles`). Apply all Global Constraints visual values.

- [ ] **Step 3: Renderer state wiring.** Replace every `classList.add/remove('visible')` / `style.display` toggle for the removed regions with `setState`: initial `setState('empty')`; `startRecordingWithStream` → `'recording'`; `cancelRecording` → clear `currentFilePath`/`currentFileName`, `'empty'`; `resetForNewMedia` → `clearError()`, `'loaded'`; transcription success → `'transcribed'`. `setDropzoneFile`, the recording UI, and `restoreDropzone` write only `#dropzone-content.innerHTML` (cache its default HTML instead of the dropzone's). `#input-row` controls call `e.stopPropagation()` so they don't open the file dialog. Every `showStatus('error', m)` becomes `showError(m)`; `showStatus('ok', …)` after translate becomes `showToast('Translation complete')`; translate's loading state becomes `btnTranslate.textContent = 'Translating…'` while disabled. Delete `showStatus`, `setExportEnabled`, and refs to removed elements. Temporarily keep progress as plain text in `#transcribe-label` (Task 4 replaces it).

- [ ] **Step 4: Pickers and trimmed settings.** On startup, `api.getSettings()` fills `modelSelect`/`languageSelect`. Their `change` events call `api.setSettings({ model })` / `api.setSettings({ language })` (main's `writeConfig` merges). `openSettings` fills only the two toggles; Save sends only `{ timestamps, translate }`.

- [ ] **Step 5: Verify** — `npm run typecheck && npm run lint && npm test` pass; `npm start`: drop a file → source bar + waveform + action row; change model, quit, relaunch → model persists; record and cancel → empty; record and stop → loaded; paste URL + Enter → loaded; transcribe → transcript fills window, waveform folded, footer shows Copy + char count; Settings saves toggles without resetting the pickers.

- [ ] **Step 6: Commit** — `git commit -am "Rebuild layout around app states with inline pickers"`

---

### Task 4: In-button progress, cancel, inline errors

**Files:**
- Modify: `src/renderer.js` (`startTranscription`, progress IPC listeners, drop/file/`onFileSelected` guards)
- Modify: `src/index.html` (progress fill styles)

**Interfaces:**
- Consumes: `UiLogic.progressText`, `UiLogic.isCancelledError`, `UiLogic.canLoadMedia` (Task 1); `api.cancelTranscription` (Task 2); `setState`, `showError`, `clearError` (Task 3).
- Produces: `setButtonProgress(phase: 'download'|'transcribe', pct: number): void`; `resetTranscribeButton(): void`.

- [ ] **Step 1: Progress.** `setButtonProgress` sets `#transcribe-fill` width to `pct%` and `#transcribe-label` to `UiLogic.progressText(phase, pct, /^https?:\/\//i.test(currentFilePath || ''))`. `api.onModelDownloadProgress` → `'download'`; `api.onTranscriptionProgress` → `'transcribe'`. `resetTranscribeButton` restores the label markup and zero width.

- [ ] **Step 2: Run/cancel flow.** `startTranscription`: return unless `appState === 'loaded'`; `clearError()`; `setState('transcribing')`; on success → `'transcribed'`; on error → `'loaded'` and `showError(e.message || 'Transcription failed.')` unless `UiLogic.isCancelledError(e)`; `finally` → `resetTranscribeButton()` and, if `appState` is still `'transcribing'`, `setState('loaded')` (never stuck mid-state). `#cancel-btn` click → `api.cancelTranscription()`.

- [ ] **Step 3: Guard new media.** At the top of `handleFile` and `loadUrl`: if `!UiLogic.canLoadMedia(appState)`, `showToast('Cancel the current transcription first')` (or `'Stop the recording first'` when `recording`) and return.

- [ ] **Step 4: Verify** — checks pass; `npm start`: transcribe shows the button filling with "Transcribing… N%"; first use of an uncached model shows "Downloading model… N%"; Cancel mid-run → back to `loaded`, no error shown, no leftover processes (`pgrep -fl 'whisper-cli|ffmpeg'`); a corrupt file (e.g. `echo x > bad.mp3`) → one-line red error under the action row with full text on hover; ⌘O during a run → toast, job continues.

- [ ] **Step 5: Commit** — `git commit -am "Show transcription progress in button with cancel"`

---

### Task 5: Export menu and keyboard shortcuts

**Files:**
- Modify: `src/renderer.js`
- Modify: `src/index.html` (menu styles)

**Interfaces:**
- Consumes: `UiLogic.shortcutAction` (Task 1); `appState` (Task 3); existing `btnCopy`/`btnTxt`…`btnPdf` click handlers (unchanged).
- Produces: `openExportMenu(): void`, `closeExportMenu(): void`, `isExportMenuOpen(): boolean`.

- [ ] **Step 1: Menu.** `#export-btn` toggles the menu (`aria-expanded` kept in sync). `openExportMenu` unhides it and focuses the first item; ↑/↓ move focus with wraparound, Enter activates the focused item (native button behavior), any item click or an outside `mousedown` closes it and returns focus to `#export-btn`.

- [ ] **Step 2: Shortcuts.** One `document` `keydown` listener: `const action = UiLogic.shortcutAction(e, { state: appState, exportMenuOpen: isExportMenuOpen(), settingsOpen: settingsOverlay.classList.contains('visible') })`; if non-null, `e.preventDefault()` and dispatch: `transcribe` → `startTranscription()`, `export` → `openExportMenu()`, `copy` → `btnCopy.click()`, `close-export` → `closeExportMenu()`, `close-settings` → `closeSettings()`.

- [ ] **Step 3: Verify** — checks pass; `npm start`: ⌘↩ in `loaded` starts a run and does nothing in `empty`; after transcription ⌘S opens the menu, ↓↓ Enter opens the DOCX save dialog; Esc closes the menu; ⌘⇧C toasts "Copied to clipboard"; with Settings open ⌘↩ does nothing and Esc closes it; plain ⌘C inside the transcript still copies the selection.

- [ ] **Step 4: Commit** — `git commit -am "Add Export menu and keyboard shortcuts"`

---

### Task 6: Screenshot review and full manual pass

**Files:**
- Create (not committed): `$CLAUDE_JOB_DIR/tmp/ui-screenshots.js` and PNGs in `$CLAUDE_JOB_DIR/tmp/shots/` (use the repo's `tmp/` under a gitignored path if `CLAUDE_JOB_DIR` is unset).

- [ ] **Step 1: Write the screenshot script.** Uses `require('playwright-core')._electron.launch({ executablePath: require('electron'), args: [repoRoot] })`. Generate a 20s sine WAV with `ffmpeg-static` (`-f lavfi -i sine=frequency=440:duration=20`). For each of `light`/`dark` (`page.emulateMedia({ colorScheme })`), capture: `empty`; `loaded` (call `handleFile(wavPath)` via `page.evaluate`, wait for `#waveform-section.visible`); `loaded-no-waveform` (`hideWaveform(); setState('loaded')`); `long-name` (`setDropzoneFile('A'.repeat(200) + '.mp3', 'MP3 · 1.0 MB'); currentFileName = 'A'.repeat(200); setState('loaded')`); `transcribing` (`setState('transcribing'); setButtonProgress('transcribe', 42)`); `transcribed` (set `transcriptEl.value` to ~40 lines of lorem, `setState('transcribed')`); `export-open` (`openExportMenu()`); `error` (`setState('loaded'); showError('Audio conversion failed. The file may be corrupted or in an unsupported format.')`).

- [ ] **Step 2: Run it** — `node "$CLAUDE_JOB_DIR/tmp/ui-screenshots.js"` — Expected: 16 PNGs. Review each against the spec: no horizontal overflow in `long-name`, gear and Export visible; no empty waveform box in `loaded-no-waveform`; transcript fills the window in `transcribed`; readable contrast in dark.

- [ ] **Step 3: Full manual pass** per the spec's Testing section (transcribe, cancel with process check, trim then transcribe, mic recording, URL load, every export format, every shortcut including inert cases, Settings save/cancel). Fix anything found in the owning file and commit as `fix: …`.

- [ ] **Step 4: Final checks** — `npm run typecheck && npm run lint && npm test` all pass; `git status` clean except untracked screenshot output outside the repo.
