const test = require('node:test');
const assert = require('node:assert/strict');
const { createPeakAccumulator } = require('../src/peaks');

// 16-bit little-endian PCM from sample values.
const pcm = (samples) => { const b = Buffer.alloc(samples.length * 2); samples.forEach((s, i) => b.writeInt16LE(s, i * 2)); return b; };
const run = (chunks, opts, buckets) => { const acc = createPeakAccumulator(opts); chunks.forEach((c) => acc.push(c)); return acc.finish(buckets); };

test('duration comes from the sample count', () => {
  const r = run([pcm(new Array(16000).fill(0))], { sampleRate: 8000 }, 10);
  assert.equal(r.duration, 2);
  assert.equal(r.peaks.length, 10);
});

test('a single spike lands in the right bucket only', () => {
  const s = new Array(10000).fill(0); s[7500] = -16384; // 75% of the way in, half scale
  const { peaks } = run([pcm(s)], { sampleRate: 8000, blockSize: 50 }, 4);
  assert.deepEqual(peaks, [0, 0, 0, 0.5]);
});

test('result does not depend on how the stream is chunked, including odd byte splits', () => {
  const s = Array.from({ length: 9001 }, (_, i) => Math.round(Math.sin(i / 37) * 30000 * ((i % 997) / 997)));
  const whole = pcm(s);
  const expected = run([whole], { sampleRate: 8000, blockSize: 64 }, 120);
  const cuts = [1, 3, 777, 1001, 4095, 9999, 18001];
  const chunks = []; let prev = 0;
  for (const c of cuts) { chunks.push(whole.subarray(prev, c)); prev = c; }
  chunks.push(whole.subarray(prev));
  assert.deepEqual(run(chunks, { sampleRate: 8000, blockSize: 64 }, 120), expected);
});

test('chunks with an odd byteOffset are handled', () => {
  const s = [100, -200, 300, -32768];
  const backing = Buffer.alloc(s.length * 2 + 1);
  pcm(s).copy(backing, 1);
  const { peaks } = run([backing.subarray(1)], { sampleRate: 4, blockSize: 1 }, 4);
  assert.deepEqual(peaks, [100 / 32768, 200 / 32768, 300 / 32768, 1]);
});

test('fewer samples than buckets gives one bucket per sample; empty input gives one silent bucket', () => {
  assert.equal(run([pcm([1, 2, 3])], { sampleRate: 8000 }, 800).peaks.length, 3);
  assert.deepEqual(run([], { sampleRate: 8000 }, 800), { peaks: [0], duration: 0 });
});
