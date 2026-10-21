const test = require('node:test');
const assert = require('node:assert/strict');
const { jobNotice } = require('../src/notify');

test('notifies only when the window is not focused', () => {
  assert.equal(jobNotice({ outcome: 'done', name: 'a.mp3', focused: true }), null);
  assert.deepEqual(jobNotice({ outcome: 'done', name: 'a.mp3', focused: false }), { title: 'Transcription complete', body: 'a.mp3' });
  assert.deepEqual(jobNotice({ outcome: 'failed', name: 'a.mp3', focused: false }), { title: 'Transcription failed', body: 'a.mp3' });
});

test('a cancel never notifies; a missing name falls back', () => {
  assert.equal(jobNotice({ outcome: 'cancelled', name: 'a.mp3', focused: false }), null);
  assert.equal(jobNotice({ outcome: 'done', name: '', focused: false }).body, 'Your transcript is ready.');
});
