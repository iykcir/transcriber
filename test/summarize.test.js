const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SUMMARY_SCHEMA, buildSummaryRequest, normalizeSummary,
  formatTopicTime, summaryToText, summaryToMarkdown,
} = require('../src/summarize');

test('buildSummaryRequest pins model, effort, fallback and schema', () => {
  const r = buildSummaryRequest('[00:00:01.000 --> 00:00:03.000] Hi.');
  assert.equal(r.model, 'claude-opus-5-5');
  assert.equal(r.max_tokens, 16000);
  assert.equal(r.output_config.effort, 'low');
  assert.deepEqual(r.output_config.format.schema, SUMMARY_SCHEMA);
  assert.deepEqual(r.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(r.fallbacks, 'default');
  assert.match(JSON.stringify(r.messages), /00:00:01\.000/);
  assert.match(r.system, /deciding whether to listen/);
});

test('normalizeSummary keeps first 6 non-empty topics and nulls bad times', () => {
  const s = normalizeSummary({ overview: ' A. ', topics: [
    { title: '', startSec: 1 }, { title: 'x', startSec: -5 }, { title: 'y', startSec: 'ten' },
    ...Array.from({ length: 6 }, (_, i) => ({ title: `t${i}`, startSec: i * 60 })) ] }, () => 42);
  assert.equal(s.overview, 'A.');
  assert.equal(s.topics.length, 6);
  assert.deepEqual(s.topics[0], { title: 'x', startSec: null });
  assert.deepEqual(s.topics[1], { title: 'y', startSec: null });
  assert.deepEqual(s.topics[2], { title: 't0', startSec: 0 });
  assert.equal(s.createdAt, 42);
});

test('normalizeSummary throws on missing overview', () => {
  assert.throws(() => normalizeSummary({ topics: [] }), /Invalid summary/);
  assert.throws(() => normalizeSummary(null), /Invalid summary/);
});

test('normalizeSummary tolerates missing topics', () => {
  assert.deepEqual(normalizeSummary({ overview: 'O.' }, () => 1).topics, []);
});

test('formatTopicTime', () => {
  assert.equal(formatTopicTime(null), '');
  assert.equal(formatTopicTime(245), '4:05');
  assert.equal(formatTopicTime(3725), '1:02:05');
});

test('summaryToText / summaryToMarkdown', () => {
  const s = { overview: 'O.', topics: [{ title: 'A', startSec: 65 }, { title: 'B', startSec: null }], createdAt: 0 };
  assert.equal(summaryToText(s), 'Summary\n\nO.\n\n• 1:05 A\n• B\n');
  assert.equal(summaryToMarkdown(s), '## Summary\n\nO.\n\n- **1:05** A\n- B\n');
});
