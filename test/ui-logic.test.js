const test = require('node:test');
const assert = require('node:assert/strict');
const { shortcutAction, isCancelledError, progressText, canLoadMedia, errorMessage, relativeTime } = require('../src/ui-logic');

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
