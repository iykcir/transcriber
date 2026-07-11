const { spawn, execFile } = require('child_process');
const fs = require('fs');
const https = require('https');
const path = require('path');
const os = require('os');
const { app } = require('electron');

// ffmpeg-static ships a pre-built static binary so users don't need to install
// ffmpeg separately. In a packaged app the binary lives in app.asar.unpacked
// (electron-builder extracts asarUnpack entries there so the OS can execute them).
function getFfmpegPath() {
  const bin = require('ffmpeg-static');
  return app.isPackaged ? bin.replace('app.asar', 'app.asar.unpacked') : bin;
}

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

function ytdlpAvailable() {
  try { require('child_process').execFileSync('yt-dlp', ['--version'], { env: process.env }); return true; }
  catch { return false; }
}

// Convert a local (already-downloaded) file to 16 kHz mono WAV, optionally
// trimmed to [startSec, endSec]. -ss/-t are placed after -i for accurate
// (decode-based) seeking rather than fast keyframe seeking, since users are
// trimming a precise selection.
function ffmpegToWav(inputPath, outPath, startSec, endSec) {
  const args = ['-nostats', '-loglevel', 'error', '-y', '-i', inputPath];
  if (startSec != null) args.push('-ss', String(startSec));
  if (endSec != null) args.push('-t', String(endSec - (startSec || 0)));
  args.push('-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', outPath);

  return new Promise((resolve, reject) => {
    execFile(getFfmpegPath(), args, { env: process.env }, (err) => {
      if (err) {
        const isUrl = /^https?:\/\//i.test(inputPath);
        reject(new Error(isUrl
          ? 'Could not load URL. Check the link is accessible and points to audio or video.'
          : 'Audio conversion failed. The file may be corrupted or in an unsupported format.'));
      } else resolve(outPath);
    });
  });
}

// Caches the last downloaded YouTube audio (keyed by URL) so a waveform
// preview and the subsequent transcription of the same URL don't each
// trigger their own full yt-dlp download.
let ytCache = null;

function clearYtCache() {
  if (ytCache) fs.unlink(ytCache.wavPath, () => {});
  ytCache = null;
}

// Try yt-dlp first (reliable), fall back to ytdl-core (best-effort).
// startSec/endSec optionally trim the result.
function downloadYouTube(url, outPath, startSec, endSec) {
  if (ytdlpAvailable()) {
    const rawPath = outPath.replace('.wav', '-raw.%(ext)s');
    return new Promise((resolve, reject) => {
      execFile('yt-dlp',
        ['-x', '--audio-format', 'best', '-o', rawPath, '--no-playlist', url],
        { env: process.env },
        (err) => {
          if (err) return reject(new Error(`yt-dlp failed: ${err.message}`));
          const base = rawPath.replace('.%(ext)s', '');
          const found = fs.readdirSync(os.tmpdir())
            .map(f => path.join(os.tmpdir(), f))
            .find(f => f.startsWith(base));
          if (!found) return reject(new Error('yt-dlp download succeeded but output file not found.'));
          ffmpegToWav(found, outPath, startSec, endSec)
            .then((p) => { fs.unlink(found, () => {}); resolve(p); })
            .catch((e) => { fs.unlink(found, () => {}); reject(new Error('Audio conversion failed after yt-dlp download.', { cause: e })); });
        }
      );
    });
  }

  // yt-dlp not found — fall back to ytdl-core
  const ytdl = require('@distube/ytdl-core');
  return new Promise((resolve, reject) => {
    let ytStream;
    try {
      ytStream = ytdl(url, { quality: 'highestaudio', filter: 'audioonly' });
    } catch (e) {
      return reject(new Error(
        `Could not load YouTube URL.\nFor reliable YouTube support, install yt-dlp: brew install yt-dlp`,
        { cause: e }
      ));
    }

    const args = ['-nostats', '-loglevel', 'error', '-y', '-i', 'pipe:0'];
    if (startSec != null) args.push('-ss', String(startSec));
    if (endSec != null) args.push('-t', String(endSec - (startSec || 0)));
    args.push('-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', outPath);
    const ffmpeg = spawn(getFfmpegPath(), args, { env: process.env });

    ytStream.on('error', (e) => {
      ffmpeg.kill();
      reject(new Error(
        `YouTube download failed: ${e.message}\n\nFor reliable YouTube support, install yt-dlp: brew install yt-dlp`
      ));
    });
    ffmpeg.on('error', (e) => reject(new Error(`ffmpeg error: ${e.message}`)));
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve(outPath);
      else reject(new Error('ffmpeg conversion failed during YouTube download.'));
    });

    ytStream.pipe(ffmpeg.stdin);
  });
}

// Convert any local file or URL to 16 kHz mono WAV required by whisper-cli.
// startSec/endSec optionally trim the input to that range. For YouTube URLs,
// reuses the cached download from a prior getWaveformPeaks() call when
// available instead of re-downloading.
function convertToWav(inputPath, startSec, endSec) {
  const outPath = path.join(os.tmpdir(), `whisper-${Date.now()}.wav`);

  if (YOUTUBE_RE.test(inputPath)) {
    if (ytCache && ytCache.url === inputPath && fs.existsSync(ytCache.wavPath)) {
      return ffmpegToWav(ytCache.wavPath, outPath, startSec, endSec);
    }
    return downloadYouTube(inputPath, outPath, startSec, endSec);
  }

  return ffmpegToWav(inputPath, outPath, startSec, endSec);
}

// Decode audio to raw PCM and bucket it into per-bucket peak amplitudes for
// a waveform preview. Returns { peaks: number[0..1], duration: seconds }.
function computePeaksFromLocalFile(filePath, bucketCount) {
  const sampleRate = 8000;
  const args = ['-nostats', '-loglevel', 'error', '-vn', '-i', filePath,
    '-ar', String(sampleRate), '-ac', '1', '-f', 's16le', 'pipe:1'];

  return new Promise((resolve, reject) => {
    const proc = spawn(getFfmpegPath(), args, { env: process.env });
    const chunks = [];
    proc.stdout.on('data', (d) => chunks.push(d));
    proc.on('error', (err) => reject(new Error(`ffmpeg error: ${err.message}`)));
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error('Could not read audio for waveform preview.'));
        return;
      }
      const buf = Buffer.concat(chunks);
      const sampleCount = Math.floor(buf.length / 2);
      const duration = sampleCount / sampleRate;
      const buckets = Math.max(1, Math.min(bucketCount, sampleCount));
      const samplesPerBucket = Math.max(1, Math.floor(sampleCount / buckets));
      const peaks = new Array(buckets).fill(0);
      for (let b = 0; b < buckets; b++) {
        const start = b * samplesPerBucket;
        const end = Math.min(sampleCount, start + samplesPerBucket);
        let max = 0;
        for (let i = start; i < end; i++) {
          const v = Math.abs(buf.readInt16LE(i * 2));
          if (v > max) max = v;
        }
        peaks[b] = max / 32768;
      }
      resolve({ peaks, duration });
    });
  });
}

// filePath may be a local file, a direct http(s) media URL (ffmpeg can
// stream those directly), or a YouTube URL (downloaded once and cached so
// a later transcribe of the same URL reuses it instead of re-downloading).
// previewPath in the result is always a local file, suitable for playback
// in an <audio>/<video> element (e.g. for scrub preview while trimming).
async function getWaveformPeaks(filePath, bucketCount = 800) {
  if (YOUTUBE_RE.test(filePath)) {
    if (!ytCache || ytCache.url !== filePath) {
      clearYtCache();
      const wavPath = path.join(os.tmpdir(), `whisper-yt-preview-${Date.now()}.wav`);
      await downloadYouTube(filePath, wavPath);
      ytCache = { url: filePath, wavPath };
    }
    const { peaks, duration } = await computePeaksFromLocalFile(ytCache.wavPath, bucketCount);
    return { peaks, duration, previewPath: ytCache.wavPath };
  }
  const { peaks, duration } = await computePeaksFromLocalFile(filePath, bucketCount);
  return { peaks, duration, previewPath: filePath };
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

async function transcribeAudio(filePath, language, includeTimestamps, model = 'base', translate = false, onProgress = () => {}, onDownload = () => {}, startSec = null, endSec = null) {
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
    const hasTrim = startSec != null || endSec != null;
    if (!isUrl && ext === '.wav' && !hasTrim) {
      wavPath = filePath;
    } else {
      onProgress(2);
      wavPath = await convertToWav(filePath, startSec, endSec);
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
    if (msg.includes('ffmpeg')) throw new Error('Audio conversion failed. The file may be corrupted or in an unsupported format.', { cause: err });
    throw new Error(`Transcription failed: ${msg}`, { cause: err });
  } finally {
    if (cleanupWav && wavPath && fs.existsSync(wavPath)) {
      fs.unlinkSync(wavPath);
    }
  }
}

module.exports = { transcribeAudio, MODELS, getWaveformPeaks };
