const test = require('node:test');
const assert = require('node:assert/strict');
const { exportSRT, exportMarkdown, buildTxt } = require('../src/export');

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

const summary = { overview: 'O.', topics: [{ title: 'A', startSec: 65 }], createdAt: 0 };

test('exportMarkdown puts the summary before the divider and transcript', () => {
  const md = exportMarkdown('Body text.', 'Ep', summary);
  const iSummary = md.indexOf('## Summary');
  assert.ok(iSummary > 0);
  assert.ok(iSummary < md.indexOf('---'));
  assert.ok(md.indexOf('---') < md.indexOf('Body text.'));
  assert.match(md, /- \*\*1:05\*\* A/);
});

test('exportMarkdown without a summary is unchanged', () => {
  assert.equal(exportMarkdown('Body text.', 'Ep', null), exportMarkdown('Body text.', 'Ep'));
  assert.doesNotMatch(exportMarkdown('Body text.', 'Ep', null), /Summary/);
});

test('buildTxt prepends the summary only when there is one', () => {
  assert.equal(buildTxt('Body.', null), 'Body.');
  assert.equal(buildTxt('Body.', summary), 'Summary\n\nO.\n\n• 1:05 A\n\nBody.');
});
