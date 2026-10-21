// Checks GitHub for a newer published release. The app isn't code-signed, so
// it can't update itself; this only tells the user a new version exists.

const REPO = 'iykcir/transcriber';
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)$/;

/**
 * True if `candidate` (e.g. "v1.10.0") is a strictly newer x.y.z version than
 * `current`. Anything not plain x.y.z (pre-releases, junk) is never newer.
 * @param {unknown} candidate
 * @param {string} current
 */
function isNewerVersion(candidate, current) {
  const a = VERSION_RE.exec(String(candidate ?? ''));
  const b = VERSION_RE.exec(current);
  if (!a || !b) return false;
  for (let i = 1; i <= 3; i++) {
    const diff = Number(a[i]) - Number(b[i]);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

/**
 * Resolves to `{ version, url }` for a newer release, or null when up to date
 * or the check fails for any reason (offline, rate-limited, bad response).
 * The release page URL is built from the validated tag rather than taken from
 * the response, so only this repo's release pages can ever be opened.
 * @param {string} currentVersion
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{version: string, url: string} | null>}
 */
async function checkForUpdate(currentVersion, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(LATEST_RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'transcriber-app' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const { tag_name: tag } = await res.json();
    if (!isNewerVersion(tag, currentVersion)) return null;
    return {
      version: tag.replace(/^v/, ''),
      url: `https://github.com/${REPO}/releases/tag/${tag}`,
    };
  } catch {
    return null;
  }
}

module.exports = { isNewerVersion, checkForUpdate };
