// Pure UI decisions shared by the renderer (loaded as a classic <script>,
// exposed on globalThis.UiLogic) and the node:test suite (via module.exports).

/** @typedef {'empty'|'recording'|'loaded'|'transcribing'|'transcribed'} AppState */

/**
 * Maps a keydown to the app action it triggers, or null when it should be
 * left alone (including every shortcut while it doesn't apply).
 * @param {{key: string, metaKey: boolean, shiftKey: boolean}} e
 * @param {{state: AppState, exportMenuOpen: boolean, settingsOpen: boolean}} ctx
 * @returns {'transcribe'|'export'|'copy'|'close-export'|'close-settings'|null}
 */
function shortcutAction(e, ctx) {
  if (e.key === 'Escape') {
    if (ctx.exportMenuOpen) return 'close-export';
    if (ctx.settingsOpen) return 'close-settings';
    return null;
  }
  if (ctx.settingsOpen || !e.metaKey) return null;

  const k = e.key.toLowerCase();
  if (k === 'enter' && !e.shiftKey && ctx.state === 'loaded') return 'transcribe';
  if (k === 's' && !e.shiftKey && ctx.state === 'transcribed') return 'export';
  if (k === 'c' && e.shiftKey && ctx.state === 'transcribed') return 'copy';
  return null;
}

// Electron wraps errors from ipcMain handlers as
// "Error invoking remote method '<channel>': Error: <message>".
/** @param {unknown} err */
function isCancelledError(err) {
  return err instanceof Error && /(^|: )Cancelled$/.test(err.message);
}

// The user-facing part of an error, without Electron's IPC wrapping
// ("Error invoking remote method '<channel>': <Name>: ").
/** @param {unknown} err */
function errorMessage(err) {
  if (!(err instanceof Error)) return '';
  return err.message.replace(/^Error invoking remote method '[^']*': (\w*Error: )?/, '');
}

/**
 * @param {'download'|'transcribe'} phase
 * @param {number} pct
 * @param {boolean} isStream
 */
function progressText(phase, pct, isStream) {
  if (phase === 'download') return `Downloading model… ${pct}%`;
  if (pct < 5) return isStream ? 'Fetching audio…' : 'Preparing audio…';
  return `Transcribing… ${pct}%`;
}

/**
 * Short label for when a saved transcript was made: "Just now", "5 min ago",
 * "3 hr ago" (today), "Yesterday", "Oct 3", or "Dec 30, 2025" (other years).
 * @param {number} ts
 * @param {number} [now]
 */
function relativeTime(ts, now = Date.now()) {
  const mins = Math.floor((now - ts) / 60_000);
  const then = new Date(ts);
  const today = new Date(now);
  const sameDay = then.toDateString() === today.toDateString();
  if (sameDay && mins < 1) return 'Just now';
  if (sameDay && mins < 60) return `${mins} min ago`;
  if (sameDay) return `${Math.floor(mins / 60)} hr ago`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (then.toDateString() === yesterday.toDateString()) return 'Yesterday';
  const opts = /** @type {Intl.DateTimeFormatOptions} */ ({ month: 'short', day: 'numeric' });
  if (then.getFullYear() !== today.getFullYear()) opts.year = 'numeric';
  return then.toLocaleDateString('en-US', opts);
}

/** @param {AppState} state */
function canLoadMedia(state) {
  return state !== 'recording' && state !== 'transcribing';
}

/**
 * What the Summary card and Summarize button show. Saved summaries stay
 * visible without a key (read-only); making new ones needs a key. A failed
 * regenerate keeps the previous summary on screen with an error line, so
 * what you see always matches what gets exported.
 * @param {{hasKey: boolean, summary: object | null, status: 'idle'|'running'|'error'}} s
 * @returns {{card: 'hidden'|'running'|'error'|'summary', showSummarizeButton: boolean,
 *            canRegenerate: boolean, showError: boolean}}
 */
function summaryView({ hasKey, summary, status }) {
  const failed = hasKey && status === 'error';
  if (hasKey && status === 'running') {
    return { card: 'running', showSummarizeButton: false, canRegenerate: false, showError: false };
  }
  if (summary) return { card: 'summary', showSummarizeButton: false, canRegenerate: hasKey, showError: failed };
  if (failed) return { card: 'error', showSummarizeButton: false, canRegenerate: true, showError: true };
  return { card: 'hidden', showSummarizeButton: hasKey, canRegenerate: false, showError: false };
}

/**
 * Whether to start a summary on its own once a transcription is saved:
 * only when it's turned on and a key is saved, the transcript isn't blank
 * (silence), and the user hasn't loaded other media in the meantime.
 * @param {{autoSummarize: boolean, hasKey: boolean, text: string, sameMedia: boolean}} s
 */
function shouldAutoSummarize({ autoSummarize, hasKey, text, sameMedia }) {
  return autoSummarize && hasKey && sameMedia && hasSpokenText(text);
}

/**
 * Whether a transcript has any spoken words. Whisper writes silence as
 * markers rather than nothing ("[00:00:00.000 --> 00:00:10.000] [BLANK_AUDIO]"),
 * so timestamps and bracketed or parenthesised tags don't count.
 * @param {string} text
 */
function hasSpokenText(text) {
  const words = text.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ');
  return /[\p{L}\p{N}]/u.test(words);
}

/**
 * A topic's start time as M:SS, or H:MM:SS from an hour up; '' when unknown.
 * @param {number | null} sec
 */
function formatTopicTime(sec) {
  if (sec == null) return '';
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

const UiLogic = { shortcutAction, isCancelledError, errorMessage, progressText, canLoadMedia, relativeTime,
  summaryView, shouldAutoSummarize, hasSpokenText, formatTopicTime };
if (typeof module !== 'undefined') module.exports = UiLogic;
else globalThis.UiLogic = UiLogic;
