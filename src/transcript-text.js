// Turns whisper-cli's segment-per-line output into readable paragraphs for the
// plain (no timestamps) transcript. Segments are whisper's decoding windows,
// not sentences — larger models (e.g. turbo) emit many short ones, often
// mid-sentence — so printing one per line produces a ragged column of
// fragments.

const SEGMENT_RE = /^\[(\d+):(\d+):(\d+(?:\.\d+)?)\s*-->\s*(\d+):(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/;
const SENTENCE_END_RE = /[.!?…]["'”’)\]]*$/;

const toSeconds = (h, m, s) => Number(h) * 3600 + Number(m) * 60 + Number(s);

/**
 * @param {string} raw whisper-cli stdout ("[HH:MM:SS.mmm --> HH:MM:SS.mmm]   text" lines)
 * @param {{minPara?: number, maxPara?: number, pauseSec?: number}} [opts]
 *   A paragraph ends after a sentence once it reaches `minPara` characters,
 *   at a silence of `pauseSec` or more, or (for unpunctuated speech) once it
 *   reaches `maxPara` characters.
 * @returns {string} paragraphs separated by a blank line
 */
function reflowSegments(raw, { minPara = 300, maxPara = 600, pauseSec = 2 } = {}) {
  const paragraphs = [];
  let para = '';
  let prevEnd = null;

  for (const line of raw.split('\n')) {
    const m = SEGMENT_RE.exec(line.trim());
    const text = (m ? m[7] : line).trim();
    if (!text) continue;
    const start = m ? toSeconds(m[1], m[2], m[3]) : null;

    if (para) {
      const paused = start != null && prevEnd != null && start - prevEnd >= pauseSec;
      const sentenceDone = para.length >= minPara && SENTENCE_END_RE.test(para);
      if (paused || sentenceDone || para.length >= maxPara) {
        paragraphs.push(para);
        para = '';
      }
    }
    para = para ? `${para} ${text}` : text;
    prevEnd = m ? toSeconds(m[4], m[5], m[6]) : prevEnd;
  }
  if (para) paragraphs.push(para);
  return paragraphs.join('\n\n');
}

// ── Filler words ──────────────────────────────────────────────────────────────
// English hesitation sounds only: uh, um, er, erm, ah, hmm, mm (and stretched
// spellings like "uhh", "ummm"). Hyphenated forms ("mm-hmm", "uh-oh") mean
// something and are kept, as are ambiguous fillers ("like", "you know").
const FILLER_RE = /^(?:u+h+m*|u+m+|e+r+m*|a+h+|h+m+|m{2,})$/i;
const TOKEN_RE = /^([("“'‘]*)(.*?)([,.!?;:…)"”'’]*)$/;
const ENDS_SENTENCE_RE = /[.!?…]["”')’]*$/;

/**
 * Removes standalone filler words, mending the punctuation around them
 * ("So, um, we" → "So we", "went, um." → "went.") and keeping a sentence's
 * capital letter ("Um, the point" → "The point").
 * @param {string} text
 */
function removeFillers(text) {
  /** @type {string[]} */
  const out = [];
  let capitalizeNext = false;

  for (const token of text.split(/\s+/).filter(Boolean)) {
    const [, lead, core, trail] = TOKEN_RE.exec(token);
    if (!core || !FILLER_RE.test(core)) {
      out.push(capitalizeNext ? lead + core.charAt(0).toUpperCase() + core.slice(1) + trail : token);
      capitalizeNext = false;
      continue;
    }
    const last = out.length - 1;
    const startsSentence = last < 0 || ENDS_SENTENCE_RE.test(out[last]);
    if (last >= 0) {
      const end = /[.!?…]+/.exec(trail);
      if (end) {
        // "went, um." → "went."
        const prev = out[last].replace(/[,;:]+$/, '');
        out[last] = ENDS_SENTENCE_RE.test(prev) ? prev : prev + end[0];
      } else if (trail.startsWith(',') && out[last].endsWith(',')) {
        // "So, um, we" → "So we"
        out[last] = out[last].slice(0, -1);
      }
    }
    if (startsSentence && /^[A-Z]/.test(core)) capitalizeNext = true;
  }
  return out.join(' ');
}

/**
 * Applies removeFillers to each line of whisper output, keeping any
 * "[start --> end]" prefix and dropping lines that were only fillers.
 * @param {string} raw
 */
function removeFillersFromRaw(raw) {
  return raw
    .split('\n')
    .map((line) => {
      const [, prefix = '', text] = /^(\[[^\]]*\]\s*)?(.*)$/.exec(line);
      const cleaned = removeFillers(text);
      return cleaned ? prefix + cleaned : null;
    })
    .filter((line) => line !== null)
    .join('\n');
}

/**
 * The language whisper detected in auto mode, from its log output.
 * @param {string} stderr
 * @returns {string | null}
 */
function detectedLanguage(stderr) {
  const m = /auto-detected language:\s*([a-z]{2,3})\b/.exec(stderr);
  return m ? m[1] : null;
}

module.exports = { reflowSegments, removeFillers, removeFillersFromRaw, detectedLanguage };
