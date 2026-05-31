const { nodewhisper } = require('nodejs-whisper');
const { execSync } = require('child_process');
const fs = require('fs');
const shell = require('shelljs');

const MODELS = {
  tiny:   { label: 'Tiny (75 MB)',    name: 'tiny' },
  base:   { label: 'Base (142 MB)',   name: 'base' },
  small:  { label: 'Small (466 MB)',  name: 'small' },
  medium: { label: 'Medium (1.5 GB)', name: 'medium' },
};

// In Electron, process.execPath points to the Electron binary, not node.
// shelljs.exec() (used by nodejs-whisper's download script) spawns a child
// node process via config.execPath — must be the real node binary.
function findNodeBinary() {
  try {
    return execSync('which node', { encoding: 'utf8', env: process.env }).trim();
  } catch {}
  for (const p of ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node']) {
    if (fs.existsSync(p)) return p;
  }
  return 'node';
}

shell.config.execPath = findNodeBinary();

async function transcribeAudio(filePath, language, includeTimestamps, model = 'base') {
  const modelName = MODELS[model] ? MODELS[model].name : 'base';

  let result;
  try {
    result = await nodewhisper(filePath, {
      modelName,
      autoDownloadModelName: modelName,
      removeWavFileAfterTranscription: true,
      withCuda: false,
      whisperOptions: {
        outputInText: true,
        language: (!language || language === 'auto') ? 'auto' : language,
        timestamps_length: 60,
        wordTimestamps: includeTimestamps,
        splitOnWord: true,
        // Metal GPU backend silently fails on Intel GPUs (falls back to BLAS
        // but still produces empty output). Disable GPU on x64; keep it on
        // arm64 where Metal works correctly and gives a large speedup.
        noGpu: process.arch !== 'arm64',
      },
    });
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('ffmpeg')) {
      throw new Error('ffmpeg is required for audio conversion.\n\nInstall it with:\n  brew install ffmpeg');
    }
    if (msg.includes('cmake') || msg.includes('CMake')) {
      throw new Error('cmake is required to compile the whisper.cpp engine (one-time setup).\n\nInstall it with:\n  brew install cmake\n\nThen try transcribing again.');
    }
    if (msg.includes('model')) {
      throw new Error(`Could not load model "${modelName}". Check your internet connection for the first download.`);
    }
    throw new Error(`Transcription failed: ${msg || 'Unknown error'}`);
  }

  const text = typeof result === 'string' ? result : (result?.text ?? '');
  return text.trim();
}

module.exports = { transcribeAudio, MODELS };
