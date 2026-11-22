// The user's Anthropic API key, encrypted with Electron safeStorage (backed
// by the macOS Keychain) and kept in the config as base64. It's only ever
// decrypted in the main process, never sent to the renderer, and never
// written in plain text: if encryption isn't available, saving fails.

/**
 * @param {{
 *   readConfig: () => Record<string, any>,
 *   writeConfig: (data: Record<string, any>) => void,
 *   safeStorage: {
 *     isEncryptionAvailable: () => boolean,
 *     encryptString: (s: string) => Buffer,
 *     decryptString: (b: Buffer) => string,
 *   },
 * }} deps
 */
function createKeyStore({ readConfig, writeConfig, safeStorage }) {
  return {
    /** @param {string} key */
    save(key) {
      const trimmed = String(key ?? '').trim();
      if (!trimmed) throw new Error('Enter an API key.');
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Secure storage is not available on this Mac.');
      }
      writeConfig({ anthropicKeyEnc: safeStorage.encryptString(trimmed).toString('base64') });
    },

    remove() {
      // writeConfig merges then serializes to JSON, which drops undefined.
      writeConfig({ anthropicKeyEnc: undefined });
    },

    /** @returns {string | null} */
    get() {
      const enc = readConfig().anthropicKeyEnc;
      if (typeof enc !== 'string' || !enc) return null;
      try {
        return safeStorage.decryptString(Buffer.from(enc, 'base64')) || null;
      } catch {
        return null;
      }
    },

    has() {
      const enc = readConfig().anthropicKeyEnc;
      return typeof enc === 'string' && enc.length > 0;
    },
  };
}

module.exports = { createKeyStore };
