const test = require('node:test');
const assert = require('node:assert/strict');
const { isNewerVersion, checkForUpdate } = require('../src/update-check');

const fakeFetch = (body, { ok = true, status = 200 } = {}) => async () => ({ ok, status, json: async () => body });

test('isNewerVersion compares numerically, ignoring a v prefix', () => {
  assert.equal(isNewerVersion('v1.10.0', '1.9.1'), true);
  assert.equal(isNewerVersion('v2.0.0', '1.99.99'), true);
  assert.equal(isNewerVersion('1.9.2', '1.9.1'), true);
  assert.equal(isNewerVersion('v1.9.1', '1.9.1'), false);
  assert.equal(isNewerVersion('1.9.0', '1.9.1'), false);
  assert.equal(isNewerVersion('1.8.10', '1.9.1'), false);
});

test('isNewerVersion rejects malformed versions', () => {
  assert.equal(isNewerVersion('nightly', '1.9.1'), false);
  assert.equal(isNewerVersion('v1.10', '1.9.1'), false);
  assert.equal(isNewerVersion('v1.10.0-beta', '1.9.1'), false);
  assert.equal(isNewerVersion(undefined, '1.9.1'), false);
});

test('checkForUpdate returns the newer release with its page URL', async () => {
  const result = await checkForUpdate('1.9.1', fakeFetch({ tag_name: 'v1.10.0', html_url: 'https://evil.example/x' }));
  assert.deepEqual(result, { version: '1.10.0', url: 'https://github.com/iykcir/transcriber/releases/tag/v1.10.0' });
});

test('checkForUpdate returns null when already current', async () => {
  assert.equal(await checkForUpdate('1.10.0', fakeFetch({ tag_name: 'v1.10.0' })), null);
});

test('checkForUpdate returns null on HTTP errors, network errors and bad payloads', async () => {
  assert.equal(await checkForUpdate('1.9.1', fakeFetch({ message: 'rate limited' }, { ok: false, status: 403 })), null);
  assert.equal(await checkForUpdate('1.9.1', async () => { throw new Error('offline'); }), null);
  assert.equal(await checkForUpdate('1.9.1', fakeFetch({})), null);
  assert.equal(await checkForUpdate('1.9.1', fakeFetch({ tag_name: 'v9.9.9/../../evil' })), null);
});

test('checkForUpdate queries the latest-release endpoint', async () => {
  let seen;
  await checkForUpdate('1.9.1', async (url, opts) => { seen = { url, opts }; return { ok: true, json: async () => ({ tag_name: 'v1.9.1' }) }; });
  assert.equal(seen.url, 'https://api.github.com/repos/iykcir/transcriber/releases/latest');
  assert.ok(seen.opts.signal, 'request has a timeout signal');
});
