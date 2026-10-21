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

module.exports = { reflowSegments };
