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

const { summarizeTranscript, summaryErrorMessage } = require('../src/summarize');
const Anthropic = require('@anthropic-ai/sdk').default;

const fakeClient = (create) => /** @type {any} */ ({ beta: { messages: { create } } });

test('empty transcript rejects without calling the API', async () => {
  let called = false;
  const client = fakeClient(async () => { called = true; });
  await assert.rejects(summarizeTranscript('  \n ', 'k', undefined, client), /Nothing to summarize/);
  assert.equal(called, false);
});

test('summarizeTranscript sends the request and parses the JSON text block', async () => {
  let sent;
  const client = fakeClient(async (params) => {
    sent = params;
    return { stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"overview":"O.","topics":[{"title":"A","startSec":3}]}' }] };
  });
  const s = await summarizeTranscript('hello', 'k', undefined, client);
  assert.equal(s.overview, 'O.');
  assert.deepEqual(s.topics, [{ title: 'A', startSec: 3 }]);
  assert.equal(sent.model, 'claude-opus-5-5');
});

test('refusal becomes the declined message', async () => {
  const client = fakeClient(async () => ({ stop_reason: 'refusal', content: [] }));
  await assert.rejects(summarizeTranscript('hello', 'k', undefined, client), /declined/i);
});

test('summaryErrorMessage maps SDK errors', () => {
  const authErr = new Anthropic.AuthenticationError(401, undefined, 'bad key', new Headers());
  const rateErr = new Anthropic.RateLimitError(429, undefined, 'slow down', new Headers());
  const connErr = new Anthropic.APIConnectionError({ message: 'offline' });
  assert.equal(summaryErrorMessage(authErr), 'Your API key was rejected. Check it in Settings.');
  assert.match(summaryErrorMessage(rateErr), /rate limit/i);
  assert.match(summaryErrorMessage(connErr), /connect/i);
  assert.equal(summaryErrorMessage(new Anthropic.APIUserAbortError()), 'Cancelled');
  assert.equal(summaryErrorMessage(Object.assign(new Error('x'), { name: 'AbortError' })), 'Cancelled');
  assert.equal(summaryErrorMessage(new Error('Nothing to summarize.')), 'Nothing to summarize.');
});

test('after a fallback, the summary is read from the fallback model\'s text', async () => {
  const client = fakeClient(async () => ({ stop_reason: 'end_turn', content: [
    { type: 'text', text: '{"overv' },
    { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-4-8' } },
    { type: 'text', text: '{"overview":"From fallback.","topics":[]}' },
  ] }));
  const s = await summarizeTranscript('hello', 'k', undefined, client);
  assert.equal(s.overview, 'From fallback.');
});

test('a rejected request does not invite a pointless retry', () => {
  const badReq = new Anthropic.BadRequestError(400, undefined, 'prompt is too long', new Headers());
  const tooLarge = Anthropic.APIError.generate(413, undefined, 'too large', new Headers());
  assert.doesNotMatch(summaryErrorMessage(badReq), /try again/i);
  assert.match(summaryErrorMessage(badReq), /too long/i);
  assert.match(summaryErrorMessage(tooLarge), /too long/i);
});
