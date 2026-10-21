const test = require('node:test');
const assert = require('node:assert/strict');
const { reflowSegments } = require('../src/transcript-text');

const seg = (start, end, text) => `[${start} --> ${end}]   ${text}`;
const ts = (s) => { const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = (s % 60).toFixed(3).padStart(6, '0'); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${sec}`; };
const raw = (segs) => segs.map(([a, b, t]) => seg(ts(a), ts(b), t)).join('\n');

test('short consecutive segments flow into one line of text', () => {
  const out = reflowSegments(raw([[0, 1, 'in devotion to the Lord'], [1, 2, 'and therefore'], [2, 3, 'a sense of overflow']]));
  assert.equal(out, 'in devotion to the Lord and therefore a sense of overflow');
});

test('a sentence split across segments is rejoined', () => {
  const out = reflowSegments(raw([[0, 5, 'We ask whether anyone'], [5, 6, 'noticed.']]));
  assert.equal(out, 'We ask whether anyone noticed.');
});

test('paragraph breaks after a sentence ends once the paragraph is long enough', () => {
  const long = 'word '.repeat(70).trim() + '.'; // ~350 chars
  const out = reflowSegments(raw([[0, 5, 'Short one.'], [5, 9, long], [9, 10, 'Next thought here.']]));
  assert.equal(out, `Short one. ${long}\n\nNext thought here.`);
});

test('a long pause starts a new paragraph', () => {
  const out = reflowSegments(raw([[0, 2, 'First part.'], [2, 3, 'still first'], [6, 7, 'after a pause']]));
  assert.equal(out, 'First part. still first\n\nafter a pause');
});

test('unpunctuated speech still breaks into paragraphs of bounded length', () => {
  const segs = Array.from({ length: 60 }, (_, i) => [i, i + 1, `phrase number ${i} without punctuation`]);
  const paras = reflowSegments(raw(segs)).split('\n\n');
  assert.ok(paras.length > 1, 'split into several paragraphs');
  for (const p of paras) assert.ok(p.length <= 700, `paragraph too long: ${p.length}`);
  assert.equal(paras.join(' ').split(' ').length, 60 * 5, 'no words lost');
});

test('lines without timestamps are kept as text; empty input gives empty string', () => {
  assert.equal(reflowSegments('hello there\ngeneral text'), 'hello there general text');
  assert.equal(reflowSegments('   \n'), '');
});
