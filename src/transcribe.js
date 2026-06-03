const { spawn, execFile } = require('child_process');
const fs = require('fs');
const https = require('https');
const path = require('path');
const os = require('os');
const { app } = require('electron');

// In the packaged app, node_modules is inside app.asar and binaries inside it
// cannot be spawned by the OS. electron-builder extracts asarUnpack entries to
// app.asar.unpacked/ — use that path when packaged.
function getWhisperCppPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'nodejs-whisper', 'cpp', 'whisper.cpp');
  }
  return path.join(__dirname, '..', 'node_modules', 'nodejs-whisper', 'cpp', 'whisper.cpp');
}

// Store models in userData so they survive app reinstalls.
function getModelsDir() {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), 'models');
  }
  return path.join(getWhisperCppPath(), 'models');
}

const WHISPER_CLI = path.join(getWhisperCppPath(), 'build', 'bin', 'whisper-cli');

const MODEL_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

function downloadModel(modelFile, destDir, onProgress) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    const destPath = path.join(destDir, modelFile);
    const tmpPath = destPath + '.download';

    function fetch(urlStr) {
      https.get(urlStr, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          res.resume();
          return fetch(res.headers.location);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let received = 0;
        const file = fs.createWriteStream(tmpPath);
        res.on('data', (chunk) => {
          received += chunk.length;
          if (total > 0) onProgress(Math.round((received / total) * 100));
        });
        res.pipe(file);
        file.on('finish', () => {
          file.close(() => {
            fs.renameSync(tmpPath, destPath);
            resolve(destPath);
          });
        });
        file.on('error', (err) => {
          fs.unlink(tmpPath, () => {});
          reject(err);
        });
      }).on('error', (err) => {
        fs.unlink(tmpPath, () => {});
        reject(err);
      });
    }

    fetch(`${MODEL_BASE_URL}/${modelFile}`);
  });
}

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

const YOUTUBE_RE = /(?:youtube\.com\/(?:watch\?.*v=|shorts\/)|youtu\.be\/)[\w-]{11}/;

// Convert any local file or URL to 16 kHz mono WAV required by whisper-cli.
function convertToWav(inputPath) {
  const outPath = path.join(os.tmpdir(), `whisper-${Date.now()}.wav`);

  if (YOUTUBE_RE.test(inputPath)) {
    // YouTube: stream audio via ytdl-core and pipe directly into ffmpeg
    const ytdl = require('@distube/ytdl-core');
    return new Promise((resolve, reject) => {
      let ytStream;
      try {
        ytStream = ytdl(inputPath, { quality: 'highestaudio', filter: 'audioonly' });
      } catch (e) {
        return reject(new Error(`Could not load YouTube URL: ${e.message}`));
      }

      const ffmpeg = spawn('ffmpeg',
        ['-nostats', '-loglevel', 'error', '-y', '-i', 'pipe:0',
         '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', outPath],
        { env: process.env }
      );

      ytStream.on('error', (e) => { ffmpeg.kill(); reject(new Error(`YouTube download failed: ${e.message}`)); });
      ffmpeg.on('error', (e) => reject(new Error(`ffmpeg error: ${e.message}`)));
      ffmpeg.on('close', (code) => {
        if (code === 0) resolve(outPath);
        else reject(new Error('ffmpeg conversion failed during YouTube download.'));
      });

      ytStream.pipe(ffmpeg.stdin);
    });
  }

  return new Promise((resolve, reject) => {
    execFile(
      'ffmpeg',
      ['-nostats', '-loglevel', 'error', '-y', '-i', inputPath,
       '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', outPath],
      { env: process.env },
      (err) => {
        if (err) {
          const isUrl = /^https?:\/\//i.test(inputPath);
          reject(new Error(isUrl
            ? 'Could not load URL. Check the link is accessible and points to audio or video.'
            : 'ffmpeg conversion failed. Is ffmpeg installed? (brew install ffmpeg)'));
        } else resolve(outPath);
      }
    );
  });
}

// Run whisper-cli, streaming stderr for progress events.
// onProgress(0..100) is called as inference proceeds.
function runWhisper(wavPath, modelPath, language, includeTimestamps, translate, onProgress) {
  return new Promise((resolve, reject) => {
    const args = [
      '-m', modelPath,
      '-f', wavPath,
      '-pp',                         // print-progress → emits "progress = N%" on stderr
      '--no-prints',                 // suppress most log noise
      '-l', (!language || language === 'auto') ? 'auto' : language,
      ...(translate ? ['--translate'] : []),
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

async function transcribeAudio(filePath, language, includeTimestamps, model = 'base', translate = false, onProgress = () => {}, onDownload = () => {}) {
  const modelsDir = getModelsDir();
  const modelFile = MODEL_FILES[model] || MODEL_FILES.base;
  const modelPath = path.join(modelsDir, modelFile);

  if (!fs.existsSync(WHISPER_CLI)) {
    throw new Error(
      'whisper-cli binary not found. Build it first:\n\n' +
      `cd "${getWhisperCppPath()}" && cmake -B build && cmake --build build --config Release`
    );
  }

  if (!fs.existsSync(modelPath)) {
    onDownload(0);
    await downloadModel(modelFile, modelsDir, onDownload);
  }

  onProgress(0);

  let wavPath;
  let cleanupWav = false;
  try {
    const isUrl = /^https?:\/\//i.test(filePath);
    const ext = path.extname(filePath).toLowerCase();
    if (!isUrl && ext === '.wav') {
      wavPath = filePath;
    } else {
      onProgress(2);
      wavPath = await convertToWav(filePath);
      cleanupWav = true;
    }

    onProgress(5);

    const transcript = await runWhisper(wavPath, modelPath, language, includeTimestamps, translate, (pct) => {
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
