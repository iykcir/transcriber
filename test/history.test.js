const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHistoryStore } = require('../src/history');

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hist-')), 'history.json');
const entry = (n) => ({ name: `Talk ${n}.mp3`, fileName: `Talk ${n}`, source: `/x/${n}.mp3`, text: `text ${n}` });

test('add returns an id; list is newest first and omits the text', () => {
  let t = 1000;
  const store = createHistoryStore(tmpFile(), { now: () => t++ });
  const a = store.add(entry(1));
  const b = store.add(entry(2));
  assert.notEqual(a, b);
  const list = store.list();
  assert.deepEqual(list.map((e) => e.name), ['Talk 2.mp3', 'Talk 1.mp3']);
  assert.equal(list[0].text, undefined);
  assert.equal(list[0].chars, 'text 2'.length);
  assert.equal(list[0].createdAt, 1001);
  assert.equal(store.get(a).text, 'text 1');
  assert.equal(store.get(a).fileName, 'Talk 1');
});

test('persists across store instances', () => {
  const file = tmpFile();
  const id = createHistoryStore(file).add(entry(1));
  assert.equal(createHistoryStore(file).get(id).text, 'text 1');
});

test('keeps only the newest `limit` entries', () => {
  const store = createHistoryStore(tmpFile(), { limit: 3 });
  for (let i = 1; i <= 5; i++) store.add(entry(i));
  assert.deepEqual(store.list().map((e) => e.name), ['Talk 5.mp3', 'Talk 4.mp3', 'Talk 3.mp3']);
});

test('update changes text only for a known id; remove and clear work', () => {
  const store = createHistoryStore(tmpFile());
  const id = store.add(entry(1));
  assert.equal(store.update(id, { text: 'edited', name: 'ignored' }), true);
  assert.equal(store.get(id).text, 'edited');
  assert.equal(store.get(id).name, 'Talk 1.mp3');
  assert.equal(store.list()[0].chars, 6);
  assert.equal(store.update('nope', { text: 'x' }), false);
  store.add(entry(2));
  store.remove(id);
  assert.equal(store.get(id), null);
  assert.equal(store.list().length, 1);
  store.clear();
  assert.deepEqual(store.list(), []);
});

test('a missing or corrupt file reads as empty and recovers on write', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{not json');
  const store = createHistoryStore(file);
  assert.deepEqual(store.list(), []);
  store.add(entry(1));
  assert.equal(createHistoryStore(file).list().length, 1);
});
