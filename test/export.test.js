const test = require('node:test');
const assert = require('node:assert/strict');
const { exportSRT } = require('../src/export');

test('plain transcript with paragraphs becomes one valid SRT cue (no blank lines inside)', () => {
  const srt = exportSRT('First paragraph here.\n\nSecond paragraph.\n\n\nThird.');
  const cues = srt.trim().split(/\n\s*\n/);
  assert.equal(cues.length, 1);
  assert.match(cues[0], /^1\n00:00:00,000 --> /);
  assert.match(cues[0], /First paragraph here\.\nSecond paragraph\.\nThird\.$/);
});

test('timestamped transcript keeps one cue per segment', () => {
  const srt = exportSRT('[00:00:00.000 --> 00:00:02.500]   Hello there.\n[00:00:02.500 --> 00:00:04.000]   General Kenobi.');
  assert.equal(srt, '1\n00:00:00,000 --> 00:00:02,500\nHello there.\n\n2\n00:00:02,500 --> 00:00:04,000\nGeneral Kenobi.\n');
});
