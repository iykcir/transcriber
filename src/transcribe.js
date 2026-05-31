const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const WHISPER_CPP_PATH = path.join(__dirname, '..', 'node_modules', 'nodejs-whisper', 'cpp', 'whisper.cpp');
const WHISPER_CLI = path.join(WHISPER_CPP_PATH, 'build', 'bin', 'whisper-cli');
const MODELS_DIR = path.join(WHISPER_CPP_PATH, 'models');

const MODEL_FILES = {
  tiny:   'ggml-tiny.bin',
  base:   'ggml-base.bin',
  small:  'ggml-small.bin',
  medium: 'ggml-medium.bin',
};

const MODELS = {
  tiny:   { label: 'Tiny (75 MB)',    name: 'tiny' },
  base:   { label: 'Base (142 MB)',   name: 'base' },
  small:  { label: 'Small (466 MB)',  name: 'small' },
  medium: { label: 'Medium (1.5 GB)', name: 'medium' },
};

// Convert any audio format to 16 kHz mono WAV required by whisper-cli.
// Returns the path to the WAV file (may be a new temp file).
function convertToWav(inputPath) {
  return new Promise((resolve, reject) => {
    const ext = path.extname(inputPath).toLowerCase();
    const outPath = path.join(os.tmpdir(), `whisper-${Date.now()}.wav`);
    execFile(
      'ffmpeg',
      ['-nostats', '-loglevel', 'error', '-y', '-i', inputPath,
       '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', outPath],
      { env: process.env },
      (err) => {
        if (err) reject(new Error('ffmpeg conversion failed. Is ffmpeg installed? (brew install ffmpeg)'));
        else resolve(outPath);
      }
    );
  });
}

// Run whisper-cli, streaming stderr for progress events.
// onProgress(0..100) is called as inference proceeds.
function runWhisper(wavPath, modelPath, language, includeTimestamps, onProgress) {
  return new Promise((resolve, reject) => {
    const args = [
      '-m', modelPath,
      '-f', wavPath,
      '-pp',                         // print-progress → emits "progress = N%" on stderr
      '--no-prints',                 // suppress most log noise
      '-l', (!language || language === 'auto') ? 'auto' : language,
    ];

    if (includeTimestamps) {
      args.push('-ml', '60');        // max segment length
    } else {
      args.push('-ml', '0');        // no hard segment split
    }

    // Metal backend silently produces empty output on Intel iGPUs.
    // CPU (BLAS) path is reliable everywhere.
    if (process.arch !== 'arm64') args.push('-ng');

    const proc = spawn(WHISPER_CLI, args, { env: process.env });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });

    proc.stderr.on('data', (d) => {
      const chunk = d.toString();
      stderr += chunk;
      // Parse "whisper_print_progress_callback: progress = N%"
      const matches = chunk.matchAll(/progress\s*=\s*(\d+)%/g);
      for (const m of matches) {
        onProgress(parseInt(m[1], 10));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Could not start whisper-cli: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`whisper-cli exited with code ${code}.\n${stderr.slice(-300)}`));
        return;
      }
      // stdout contains the transcript with timestamp brackets.
      // Strip the brackets to get plain text when timestamps not requested.
      const raw = stdout.trim();
      if (!raw) {
        resolve('(no speech detected)');
        return;
      }
      if (includeTimestamps) {
        resolve(raw);
      } else {
        // "[HH:MM:SS.mmm --> HH:MM:SS.mmm]   Text" → "Text"
        const plain = raw
          .split('\n')
          .map(l => l.replace(/^\[[\d:.,\s\->]+\]\s*/, '').trim())
          .filter(Boolean)
          .join('\n');
        resolve(plain || raw);
      }
    });
  });
}

async function transcribeAudio(filePath, language, includeTimestamps, model = 'base', onProgress = () => {}) {
  const modelFile = MODEL_FILES[model] || MODEL_FILES.base;
  const modelPath = path.join(MODELS_DIR, modelFile);

  if (!fs.existsSync(WHISPER_CLI)) {
    throw new Error(
      'whisper-cli binary not found. Build it first:\n\n' +
      `cd "${WHISPER_CPP_PATH}" && cmake -B build && cmake --build build --config Release`
    );
  }

  if (!fs.existsSync(modelPath)) {
    throw new Error(
      `Model file not found: ${modelFile}\n\n` +
      'Run a transcription once to auto-download it, or download manually.'
    );
  }

  onProgress(0);

  let wavPath;
  let cleanupWav = false;
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.wav') {
      wavPath = filePath;
    } else {
      onProgress(2);
      wavPath = await convertToWav(filePath);
      cleanupWav = true;
    }

    onProgress(5);

    const transcript = await runWhisper(wavPath, modelPath, language, includeTimestamps, (pct) => {
      // Map whisper's 0-100 into 5-99 so the bar visibly fills but doesn't
      // prematurely hit 100 before we've processed the result.
      onProgress(5 + Math.round(pct * 0.94));
    });

    onProgress(100);
    return transcript;
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('ffmpeg')) throw new Error('ffmpeg is required.\n\nInstall it with:\n  brew install ffmpeg');
    throw new Error(`Transcription failed: ${msg}`);
  } finally {
    if (cleanupWav && wavPath && fs.existsSync(wavPath)) {
      fs.unlinkSync(wavPath);
    }
  }
}

module.exports = { transcribeAudio, MODELS };
