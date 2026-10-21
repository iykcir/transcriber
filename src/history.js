// Recent transcripts, persisted as one JSON file in the app's user data
// folder so a transcript isn't lost when the window closes or new media loads.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * @typedef {{id: string, name: string, fileName: string, source: string,
 *            createdAt: number, text: string}} HistoryEntry
 */

/**
 * @param {string} filePath
 * @param {{limit?: number, now?: () => number}} [opts]
 */
function createHistoryStore(filePath, { limit = 25, now = Date.now } = {}) {
  /** @returns {HistoryEntry[]} newest first */
  function read() {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  /** @param {HistoryEntry[]} entries */
  function write(entries) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    // Write-then-rename so a crash mid-write can't leave a truncated file.
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(entries));
    fs.renameSync(tmp, filePath);
  }

  return {
    /** Summaries for the list view (text omitted, length included). */
    list() {
      return read().map(({ text, ...rest }) => ({ ...rest, chars: text.length }));
    },

    /** @param {string} id */
    get(id) {
      return read().find((e) => e.id === id) || null;
    },

    /** @param {{name: string, fileName: string, source: string, text: string}} entry */
    add({ name, fileName, source, text }) {
      const id = crypto.randomUUID();
      const entries = [{ id, name, fileName, source, createdAt: now(), text }, ...read()];
      write(entries.slice(0, limit));
      return id;
    },

    /** Only the text is editable (transcript edits, translations). */
    update(id, { text }) {
      const entries = read();
      const entry = entries.find((e) => e.id === id);
      if (!entry || typeof text !== 'string') return false;
      entry.text = text;
      write(entries);
      return true;
    },

    /** @param {string} id */
    remove(id) {
      write(read().filter((e) => e.id !== id));
    },

    clear() {
      write([]);
    },
  };
}

module.exports = { createHistoryStore };
