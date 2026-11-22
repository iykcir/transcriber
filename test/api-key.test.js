const test = require('node:test');
const assert = require('node:assert/strict');
const { createKeyStore } = require('../src/api-key');

// Mirrors main.js: writeConfig merges and serializes to JSON (which drops
// keys whose value is undefined).
function fakeConfig(initial = {}) {
  let json = JSON.stringify(initial);
  return {
    readConfig: () => JSON.parse(json),
    writeConfig: (data) => { json = JSON.stringify({ ...JSON.parse(json), ...data }); },
    raw: () => json,
  };
}

const fakeSafeStorage = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from(`enc:${s}`),
  decryptString: (b) => b.toString().slice(4),
});

test('save trims and stores only the encrypted key', () => {
  const cfg = fakeConfig({ autoSummarize: true });
  const store = createKeyStore({ ...cfg, safeStorage: fakeSafeStorage() });
  store.save('  sk-abc\n');
  assert.equal(cfg.readConfig().anthropicKeyEnc, Buffer.from('enc:sk-abc').toString('base64'));
  assert.doesNotMatch(cfg.raw(), /sk-abc/);
  assert.equal(store.get(), 'sk-abc');
  assert.equal(store.has(), true);
});

test('save rejects an empty key', () => {
  const store = createKeyStore({ ...fakeConfig(), safeStorage: fakeSafeStorage() });
  assert.throws(() => store.save('   '), /Enter an API key/);
});

test('save refuses when encryption is unavailable and leaves config unchanged', () => {
  const cfg = fakeConfig({ model: 'base' });
  const store = createKeyStore({ ...cfg, safeStorage: fakeSafeStorage(false) });
  assert.throws(() => store.save('k'), /Secure storage/);
  assert.deepEqual(cfg.readConfig(), { model: 'base' });
});

test('remove deletes the key and keeps autoSummarize', () => {
  const cfg = fakeConfig({ autoSummarize: true });
  const store = createKeyStore({ ...cfg, safeStorage: fakeSafeStorage() });
  store.save('k');
  store.remove();
  assert.equal(store.has(), false);
  assert.equal(store.get(), null);
  assert.deepEqual(cfg.readConfig(), { autoSummarize: true });
});

test('get returns null when the stored value cannot be decrypted', () => {
  const cfg = fakeConfig({ anthropicKeyEnc: 'Zm9v' });
  const store = createKeyStore({ ...cfg, safeStorage: { ...fakeSafeStorage(),
    decryptString: () => { throw new Error('bad'); } } });
  assert.equal(store.get(), null);
});

test('a key that can no longer be decrypted counts as no key', () => {
  const cfg = fakeConfig({ anthropicKeyEnc: 'Zm9v' });
  const store = createKeyStore({ ...cfg, safeStorage: { ...fakeSafeStorage(),
    decryptString: () => { throw new Error('bad'); } } });
  assert.equal(store.has(), false);
});
