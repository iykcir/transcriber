const test = require('node:test');
const assert = require('node:assert/strict');
const { buildWhisperArgs, MODEL_FILES } = require('../src/whisper-args');

const base = { modelPath: '/m.bin', wavPath: '/a.wav', language: 'auto', includeTimestamps: false, translate: false, prompt: '', arch: 'arm64' };
const valueAfter = (args, flag) => args[args.indexOf(flag) + 1];

test('turbo maps to the quantized large-v3-turbo file', () => {
  assert.equal(MODEL_FILES.turbo, 'ggml-large-v3-turbo-q5_0.bin');
  assert.equal(MODEL_FILES.base, 'ggml-base.bin');
});

test('basic args: model, file, progress, language', () => {
  const args = buildWhisperArgs(base);
  assert.equal(valueAfter(args, '-m'), '/m.bin');
  assert.equal(valueAfter(args, '-f'), '/a.wav');
  assert.ok(args.includes('-pp'));
  assert.equal(valueAfter(args, '-l'), 'auto');
  assert.equal(valueAfter(args, '-ml'), '0');
  assert.ok(!args.includes('--prompt'));
  assert.ok(!args.includes('--translate'));
  assert.ok(!args.includes('-ng'));
});

test('language, timestamps, translate and intel flags', () => {
  const args = buildWhisperArgs({ ...base, language: 'fr', includeTimestamps: true, translate: true, arch: 'x64' });
  assert.equal(valueAfter(args, '-l'), 'fr');
  assert.equal(valueAfter(args, '-ml'), '60');
  assert.ok(args.includes('--translate'));
  assert.ok(args.includes('-ng'));
});

test('vocabulary hint becomes a single --prompt argument, trimmed and capped', () => {
  const args = buildWhisperArgs({ ...base, prompt: '  Kubernetes, Dr. Okonkwo; rm -rf / "quoted"  ' });
  assert.equal(valueAfter(args, '--prompt'), 'Kubernetes, Dr. Okonkwo; rm -rf / "quoted"');
  const long = buildWhisperArgs({ ...base, prompt: 'x'.repeat(2000) });
  assert.equal(valueAfter(long, '--prompt').length, 600);
  assert.ok(!buildWhisperArgs({ ...base, prompt: '   ' }).includes('--prompt'));
  assert.ok(!buildWhisperArgs({ ...base, prompt: undefined }).includes('--prompt'));
});

test('auto-detect keeps whisper logs (so the detected language can be read); explicit languages stay quiet', () => {
  assert.ok(!buildWhisperArgs({ ...base, language: 'auto' }).includes('--no-prints'));
  assert.ok(buildWhisperArgs({ ...base, language: 'en' }).includes('--no-prints'));
});
