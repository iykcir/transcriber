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

const UiLogic = { shortcutAction, isCancelledError, errorMessage, progressText, canLoadMedia, relativeTime };
if (typeof module !== 'undefined') module.exports = UiLogic;
else globalThis.UiLogic = UiLogic;
