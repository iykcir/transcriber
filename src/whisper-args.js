// whisper-cli model files and argument building, kept free of Electron so it
// can be unit-tested.

const MODEL_FILES = {
  tiny:   'ggml-tiny.bin',
  base:   'ggml-base.bin',
  small:  'ggml-small.bin',
  medium: 'ggml-medium.bin',
  // 5-bit quantized large-v3-turbo: ~574 MB instead of 1.6 GB, near-identical accuracy.
  turbo:  'ggml-large-v3-turbo-q5_0.bin',
};

// Whisper's initial prompt is capped at half its text context (224 tokens);
// 600 characters stays comfortably inside that.
const MAX_PROMPT_CHARS = 600;

/**
 * @param {{modelPath: string, wavPath: string, language?: string, includeTimestamps?: boolean,
 *          translate?: boolean, prompt?: string, arch?: string}} o
 * @returns {string[]}
 */
function buildWhisperArgs({ modelPath, wavPath, language, includeTimestamps, translate, prompt, arch = process.arch }) {
  const args = [
    '-m', modelPath,
    '-f', wavPath,
    '-pp',                         // print-progress → emits "progress = N%" on stderr
    '--no-prints',                 // suppress most log noise
    '-l', (!language || language === 'auto') ? 'auto' : language,
    // max segment length: split for timestamps, otherwise no hard split
    '-ml', includeTimestamps ? '60' : '0',
  ];
  if (translate) args.push('--translate');

  // Names and jargon to bias spelling toward. Passed as one argv entry, so
  // no shell quoting is involved.
  const hint = (prompt || '').trim().slice(0, MAX_PROMPT_CHARS);
  if (hint) args.push('--prompt', hint);

  // Metal backend silently produces empty output on Intel iGPUs.
  // CPU (BLAS) path is reliable everywhere.
  if (arch !== 'arm64') args.push('-ng');
  return args;
}

module.exports = { MODEL_FILES, MAX_PROMPT_CHARS, buildWhisperArgs };
