const test = require('node:test');
const assert = require('node:assert/strict');
const { shortcutAction, isCancelledError, progressText, canLoadMedia, errorMessage, relativeTime, summaryView, formatTopicTime, shouldAutoSummarize, hasSpokenText } = require('../src/ui-logic');

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

test('errorMessage strips Electron IPC wrapping', () => {
  assert.equal(errorMessage(new Error("Error invoking remote method 'transcribe': Error: Transcription failed: boom")), 'Transcription failed: boom');
  assert.equal(errorMessage(new Error("Error invoking remote method 'translate-text': TypeError: fetch failed")), 'fetch failed');
  assert.equal(errorMessage(new Error('Invalid URL.')), 'Invalid URL.');
  assert.equal(errorMessage(new Error('')), '');
  assert.equal(errorMessage('nope'), '');
});

test('relativeTime', () => {
  const now = new Date(2026, 9, 21, 15, 0).getTime();
  const min = 60_000;
  assert.equal(relativeTime(now - 20_000, now), 'Just now');
  assert.equal(relativeTime(now - 5 * min, now), '5 min ago');
  assert.equal(relativeTime(now - 3 * 60 * min, now), '3 hr ago');
  assert.equal(relativeTime(new Date(2026, 9, 20, 9, 0).getTime(), now), 'Yesterday');
  assert.equal(relativeTime(new Date(2026, 9, 3, 9, 0).getTime(), now), 'Oct 3');
  assert.equal(relativeTime(new Date(2025, 11, 30, 9, 0).getTime(), now), 'Dec 30, 2025');
});

const sum = { overview: 'O.', topics: [], createdAt: 0 };

test('summaryView: no key, no summary hides everything', () => {
  assert.deepEqual(summaryView({ hasKey: false, summary: null, status: 'idle' }),
    { card: 'hidden', showSummarizeButton: false, canRegenerate: false, showError: false });
});

test('summaryView: no key shows a saved summary read-only', () => {
  assert.deepEqual(summaryView({ hasKey: false, summary: sum, status: 'idle' }),
    { card: 'summary', showSummarizeButton: false, canRegenerate: false, showError: false });
});

test('summaryView: key and no summary offers the Summarize button', () => {
  assert.deepEqual(summaryView({ hasKey: true, summary: null, status: 'idle' }),
    { card: 'hidden', showSummarizeButton: true, canRegenerate: false, showError: false });
});

test('summaryView: running shows the running card and no button', () => {
  const v = summaryView({ hasKey: true, summary: null, status: 'running' });
  assert.equal(v.card, 'running');
  assert.equal(v.showSummarizeButton, false);
});

test('summaryView: error offers Retry', () => {
  const v = summaryView({ hasKey: true, summary: null, status: 'error' });
  assert.equal(v.card, 'error');
  assert.equal(v.canRegenerate, true);
});

test('summaryView: key and summary can regenerate', () => {
  assert.deepEqual(summaryView({ hasKey: true, summary: sum, status: 'idle' }),
    { card: 'summary', showSummarizeButton: false, canRegenerate: true, showError: false });
});

test('summaryView: without a key a stale running or error status falls back', () => {
  assert.equal(summaryView({ hasKey: false, summary: null, status: 'error' }).card, 'hidden');
  assert.equal(summaryView({ hasKey: false, summary: sum, status: 'running' }).card, 'summary');
});

test('formatTopicTime is shared with the renderer', () => {
  assert.equal(formatTopicTime(245), '4:05');
});

test('summaryView: a failed regenerate keeps the old summary with an error line', () => {
  assert.deepEqual(summaryView({ hasKey: true, summary: sum, status: 'error' }),
    { card: 'summary', showSummarizeButton: false, canRegenerate: true, showError: true });
});

test('summaryView: a first-time failure shows the error card', () => {
  const v = summaryView({ hasKey: true, summary: null, status: 'error' });
  assert.equal(v.card, 'error');
  assert.equal(v.showError, true);
});

const auto = (o = {}) => shouldAutoSummarize({ autoSummarize: true, hasKey: true, text: 'Hello.', sameMedia: true, ...o });

test('shouldAutoSummarize: runs when on, keyed, with text, on the same media', () => {
  assert.equal(auto(), true);
});

test('shouldAutoSummarize: skips a silent or blank transcript', () => {
  assert.equal(auto({ text: '' }), false);
  assert.equal(auto({ text: '  \n ' }), false);
});

test('shouldAutoSummarize: skips when the media changed meanwhile', () => {
  assert.equal(auto({ sameMedia: false }), false);
});

test('shouldAutoSummarize: skips when off or without a key', () => {
  assert.equal(auto({ autoSummarize: false }), false);
  assert.equal(auto({ hasKey: false }), false);
});

test('hasSpokenText: whisper silence markers are not speech', () => {
  assert.equal(hasSpokenText('[00:00:00.000 --> 00:00:10.000]   [BLANK_AUDIO]'), false);
  assert.equal(hasSpokenText('[BLANK_AUDIO]\n[MUSIC]\n(silence)\n[ Silence ]'), false);
  assert.equal(hasSpokenText('  \n '), false);
});

test('hasSpokenText: real words count, with or without timestamps', () => {
  assert.equal(hasSpokenText('[00:00:00.000 --> 00:00:02.000]   Hello there.'), true);
  assert.equal(hasSpokenText('Hello [MUSIC] there.'), true);
});

test('shouldAutoSummarize: skips a transcript that is only silence markers', () => {
  assert.equal(auto({ text: '[00:00:00.000 --> 00:00:10.000]   [BLANK_AUDIO]' }), false);
});
