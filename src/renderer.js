/* global api, UiLogic */

let currentFilePath = null;
let currentFileName = null;

// ── Elements ──────────────────────────────────────────────────────────────────
const dropzone          = document.getElementById('dropzone');
const dropzoneContent   = document.getElementById('dropzone-content');
const inputRow          = document.getElementById('input-row');
const titleText         = document.getElementById('title-text');
const inlineError       = document.getElementById('inline-error');
const transcribeLabel   = document.getElementById('transcribe-label');
const transcribeFill    = document.getElementById('transcribe-fill');
const cancelBtn         = /** @type {HTMLButtonElement} */ (document.getElementById('cancel-btn'));
const exportBtn         = document.getElementById('export-btn');
const exportMenu        = document.getElementById('export-menu');
const fileInput         = /** @type {HTMLInputElement} */ (document.getElementById('file-input'));
const transcriptEl      = /** @type {HTMLTextAreaElement} */ (document.getElementById('transcript'));
const charCount         = document.getElementById('char-count');
const transcribeBtn     = /** @type {HTMLButtonElement} */ (document.getElementById('transcribe-btn'));
const waveformSection   = document.getElementById('waveform-section');
const waveformCanvas    = /** @type {HTMLCanvasElement} */ (document.getElementById('waveform-canvas'));
const waveformSelection = document.getElementById('waveform-selection');
const handleStart       = document.getElementById('handle-start');
const handleEnd         = document.getElementById('handle-end');
const trimStartLabel    = document.getElementById('trim-start-label');
const trimEndLabel      = document.getElementById('trim-end-label');
const trimDurationLabel = document.getElementById('trim-duration-label');
const previewAudio      = /** @type {HTMLAudioElement} */ (document.getElementById('preview-audio'));
const previewVideo      = /** @type {HTMLVideoElement} */ (document.getElementById('preview-video'));
const waveformPlayBtn   = /** @type {HTMLButtonElement} */ (document.getElementById('waveform-play-btn'));
const waveformPlayIcon  = document.getElementById('waveform-play-icon');
const waveformPauseIcon = document.getElementById('waveform-pause-icon');
const btnCopy              = /** @type {HTMLButtonElement} */ (document.getElementById('btn-copy'));
const btnTranslate         = /** @type {HTMLButtonElement} */ (document.getElementById('btn-translate'));
const btnTxt            = /** @type {HTMLButtonElement} */ (document.getElementById('btn-txt'));
const btnMd             = /** @type {HTMLButtonElement} */ (document.getElementById('btn-md'));
const btnDocx           = /** @type {HTMLButtonElement} */ (document.getElementById('btn-docx'));
const btnSrt            = /** @type {HTMLButtonElement} */ (document.getElementById('btn-srt'));
const btnPdf            = /** @type {HTMLButtonElement} */ (document.getElementById('btn-pdf'));
const settingsOverlay   = document.getElementById('settings-overlay');
const modelSelect       = /** @type {HTMLSelectElement} */ (document.getElementById('model-select'));
const languageSelect    = /** @type {HTMLSelectElement} */ (document.getElementById('language-select'));
const timestampsToggle  = /** @type {HTMLInputElement} */ (document.getElementById('timestamps-toggle'));
const translateToggle   = /** @type {HTMLInputElement} */ (document.getElementById('translate-toggle'));
const settingsSave      = document.getElementById('settings-save');
const settingsCancel    = document.getElementById('settings-cancel');
const gearBtn           = document.getElementById('gear-btn');
const toast             = document.getElementById('toast');
const updateBtn         = document.getElementById('update-btn');
const updateCheckToggle = /** @type {HTMLInputElement} */ (document.getElementById('update-check-toggle'));
const keepHistoryToggle = /** @type {HTMLInputElement} */ (document.getElementById('keep-history-toggle'));
const fillersToggle     = /** @type {HTMLInputElement} */ (document.getElementById('fillers-toggle'));
const hintInput         = /** @type {HTMLInputElement} */ (document.getElementById('hint-input'));
const recentsEl         = document.getElementById('recents');
const recentsList       = document.getElementById('recents-list');
const summaryCard       = document.getElementById('summary-card');
const summaryToggle     = document.getElementById('summary-toggle');
const summaryRegen      = /** @type {HTMLButtonElement} */ (document.getElementById('summary-regen'));
const summaryOverview   = document.getElementById('summary-overview');
const summaryTopics     = document.getElementById('summary-topics');
const summaryStatusEl   = document.getElementById('summary-status');
const summaryStatusText = document.getElementById('summary-status-text');
const summaryAction     = /** @type {HTMLButtonElement} */ (document.getElementById('summary-action'));
const btnSummarize      = /** @type {HTMLButtonElement} */ (document.getElementById('btn-summarize'));
const apiKeyInput       = /** @type {HTMLInputElement} */ (document.getElementById('api-key-input'));
const apiKeySaved       = document.getElementById('api-key-saved');
const apiKeySaveBtn     = /** @type {HTMLButtonElement} */ (document.getElementById('api-key-save'));
const apiKeyRemoveBtn   = /** @type {HTMLButtonElement} */ (document.getElementById('api-key-remove'));
const apiKeyError       = document.getElementById('api-key-error');
const autoSummarizeToggle = /** @type {HTMLInputElement} */ (document.getElementById('auto-summarize-toggle'));

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, duration = 2500) {
  clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

// ── App state ─────────────────────────────────────────────────────────────────
// One of UiLogic's AppState values; CSS keys off body[data-state] to decide
// which regions are visible and enabled.
/** @type {import('./ui-logic').AppState} */
let appState = 'empty';
let currentDisplayName = null;
// Bumped whenever the loaded media changes, so async work started for older
// media (e.g. a translation) can tell its result is stale.
let mediaGeneration = 0;

/** @param {import('./ui-logic').AppState} next */
function setState(next) {
  appState = next;
  document.body.dataset.state = next;
  titleText.textContent = (next === 'empty' || next === 'recording' || !currentDisplayName)
    ? 'Transcriber'
    : currentDisplayName;
  // Waveform height differs per state (folded once transcribed).
  if (waveformPeaks) requestAnimationFrame(drawWaveform);
  if (next === 'empty') refreshRecents();
}

/** @param {string} msg */
function showError(msg) {
  inlineError.textContent = msg;
  inlineError.title = msg;
}

function clearError() {
  inlineError.textContent = '';
  inlineError.title = '';
}

// ── Recording & Capture ───────────────────────────────────────────────────────
let mediaRecorder   = null;
let activeStream    = null;
let recordingChunks = [];
let recordingTimer  = null;
let recordingSecs   = 0;
let isRecording     = false;

const DROPZONE_DEFAULT_HTML = dropzoneContent.innerHTML;

// The input row lives inside the drop zone; keep its clicks from opening the
// file dialog.
inputRow.addEventListener('click', (e) => e.stopPropagation());
const urlInput      = /** @type {HTMLInputElement} */ (document.getElementById('url-input'));
const urlLoadBtn    = document.getElementById('url-load-btn');

document.getElementById('record-btn').addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    startRecordingWithStream(stream, 'Recording from microphone…');
  } catch (e) {
    showError(e.name === 'NotAllowedError'
      ? 'Microphone access denied. Check System Settings → Privacy & Security → Microphone.'
      : `Could not access microphone: ${e.message}`);
  }
});

document.getElementById('system-audio-btn').addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    const audioTracks = stream.getAudioTracks();
    stream.getVideoTracks().forEach(t => t.stop());
    if (audioTracks.length === 0) {
      showError('No audio captured. Enable the audio option in the screen picker.');
      return;
    }
    startRecordingWithStream(new MediaStream(audioTracks), 'Capturing system audio…');
  } catch (e) {
    if (e.name === 'NotAllowedError') {
      showError('Screen recording access denied. Check System Settings → Privacy & Security → Screen Recording.');
    } else {
      showError(`Could not capture system audio: ${e.message}`);
    }
  }
});

function startRecordingWithStream(stream, label) {
  activeStream    = stream;
  mediaRecorder   = new MediaRecorder(stream);
  recordingChunks = [];
  recordingSecs   = 0;
  isRecording     = true;

  mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordingChunks.push(e.data); };

  mediaRecorder.onstop = async () => {
    activeStream?.getTracks().forEach(t => t.stop());
    activeStream = null;
    isRecording  = false;
    restoreDropzone();
    setState('empty');
    const blob     = new Blob(recordingChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
    const buffer   = await blob.arrayBuffer();
    const filePath = await api.saveRecording(new Uint8Array(buffer));
    if (filePath) await handleFile(filePath);
  };

  mediaRecorder.start(250);

  dropzoneContent.innerHTML = `
    <div class="rec-state">
      <div class="rec-dot"></div>
      <span class="rec-timer" id="rec-timer">0:00</span>
    </div>
    <div class="rec-label">${label}</div>
    <div class="rec-buttons">
      <button class="btn-primary" id="stop-record-btn">Stop</button>
      <button class="btn-secondary" id="cancel-record-btn">Cancel</button>
    </div>`;
  dropzone.classList.remove('has-file', 'hover');
  clearError();
  hideWaveform();
  setState('recording');

  document.getElementById('stop-record-btn').addEventListener('click',   (e) => { e.stopPropagation(); stopRecording();   });
  document.getElementById('cancel-record-btn').addEventListener('click', (e) => { e.stopPropagation(); cancelRecording(); });

  recordingTimer = setInterval(() => {
    recordingSecs++;
    const el = document.getElementById('rec-timer');
    if (el) el.textContent = `${Math.floor(recordingSecs / 60)}:${String(recordingSecs % 60).padStart(2, '0')}`;
  }, 1000);
}

function stopRecording() {
  clearInterval(recordingTimer);
  if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
}

function cancelRecording() {
  clearInterval(recordingTimer);
  isRecording = false;
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.onstop = () => { activeStream?.getTracks().forEach(t => t.stop()); activeStream = null; };
    mediaRecorder.stop();
  }
  restoreDropzone();
  currentFilePath = null;
  currentFileName = null;
  currentDisplayName = null;
  setState('empty');
}

function restoreDropzone() {
  dropzoneContent.innerHTML = DROPZONE_DEFAULT_HTML;
  dropzone.classList.remove('has-file', 'hover');
}

// ── URL Input ─────────────────────────────────────────────────────────────────
urlLoadBtn.addEventListener('click', () => loadUrl(urlInput.value.trim()));
urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadUrl(urlInput.value.trim()); });

// Collapses the dropzone into the slim source bar (used for both local files
// and URLs). Name and meta go in via textContent: URL titles are untrusted.
function setDropzoneFile(displayName, meta) {
  currentDisplayName = displayName;
  dropzone.classList.add('has-file');
  dropzoneContent.innerHTML = `
    <svg class="mic-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
    </svg>
    <div class="file-info">
      <div class="file-name"></div>
      <div class="file-meta"></div>
    </div>
    <button class="btn-ghost" id="source-change" title="Open another file (⌘O)">Change</button>
    <button class="icon-btn" id="source-clear" title="Close file" aria-label="Close file">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>`;
  dropzoneContent.querySelector('#source-clear').addEventListener('click', (e) => {
    e.stopPropagation();
    clearMedia();
  });
  dropzoneContent.querySelector('.file-name').textContent = displayName;
  dropzoneContent.querySelector('.file-meta').textContent = meta;
  if (appState !== 'empty' && appState !== 'recording') titleText.textContent = displayName;
}

// Back to the empty drop zone (and its record / system audio / link row).
function clearMedia() {
  if (!guardLoadMedia()) return;
  leaveHistoryEntry();
  mediaGeneration++;
  currentFilePath = null;
  currentFileName = null;
  currentDisplayName = null;
  restoreDropzone();
  hideWaveform();
  clearError();
  btnTranslate.style.display = 'none';
  clearSummary();
  transcriptEl.value = '';
  updateCharCount();
  transcribeBtn.disabled = false;
  setState('empty');
}

// Clears transcript/error state when a new input is loaded.
function resetForNewMedia() {
  leaveHistoryEntry();
  mediaGeneration++;
  clearError();
  btnTranslate.style.display = 'none';
  clearSummary();
  transcriptEl.value = '';
  updateCharCount();
  transcribeBtn.disabled = false;
  setState('loaded');
}

let linkRequest = 0;
async function loadUrl(url) {
  if (!url || !guardLoadMedia()) return;
  const request = ++linkRequest;
  let parsed;
  let podcast = UiLogic.podcastLinkKind(url);
  // A spotify.link short link could lead to an episode or a whole show; find
  // out first, so a show link leaves the current media alone.
  if (podcast?.service === 'spotify-short') {
    const generation = mediaGeneration;
    let expanded;
    try {
      expanded = await api.expandPodcastLink(url);
    } catch (e) {
      if (request === linkRequest && generation === mediaGeneration) showError(UiLogic.errorMessage(e));
      return;
    }
    if (request !== linkRequest || generation !== mediaGeneration || !guardLoadMedia()) return;
    url = expanded;
    podcast = UiLogic.podcastLinkKind(url);
    if (!podcast || podcast.service === 'spotify-short') { showError("Couldn't read this Spotify link. Check that it's a podcast episode."); return; }
  }
  if (podcast?.service === 'spotify-show' || podcast?.service === 'apple-show') {
    showError('This is a link to a whole show. Paste a link to a single episode.');
    return;
  }
  if (podcast) return loadPodcastLink(url, podcast.service === 'apple' ? 'Apple Podcasts' : 'Spotify');
  try { parsed = new URL(url); } catch { showError('Invalid URL.'); return; }

  currentFilePath = url;

  // Show the URL immediately as a placeholder
  const isYouTube = /youtube\.com|youtu\.be/.test(parsed.hostname);
  const pathFile = parsed.pathname.split('/').filter(Boolean).pop();
  const initialName = (pathFile && pathFile !== 'watch') ? decodeURIComponent(pathFile) : url;
  currentFileName = initialName.replace(/\.[^.]+$/, '') || 'stream';
  setDropzoneFile(initialName, parsed.hostname);

  urlInput.value = '';
  resetForNewMedia();

  // Best-effort: downloads (YouTube) or streams (direct links) the audio via
  // ffmpeg to build a waveform preview. May take a while for YouTube.
  loadWaveform(url);

  // For YouTube, fetch the real title via the public oEmbed API
  if (isYouTube) {
    try {
      const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
      if (res.ok) {
        const data = await res.json();
        if (currentFilePath !== url) return; // other media loaded meanwhile
        currentFileName = data.title;
        setDropzoneFile(data.title, `YouTube · ${data.author_name}`);
      }
    } catch {}
  }
}

// Spotify / Apple Podcasts episode: find its public audio first (main process),
// then continue as a direct link. Transcribe stays disabled until it's known.
async function loadPodcastLink(url, service) {
  currentFilePath = null;
  currentFileName = null;
  setDropzoneFile('Finding episode…', service);
  urlInput.value = '';
  resetForNewMedia();
  hideWaveform(); // the previous media's waveform and preview don't belong under the placeholder
  transcribeBtn.disabled = true;
  const generation = mediaGeneration;
  let episode;
  try {
    episode = await api.resolvePodcastLink(url);
  } catch (e) {
    if (generation !== mediaGeneration) return; // other media loaded meanwhile
    clearMedia();
    showError(UiLogic.errorMessage(e));
    return;
  }
  if (generation !== mediaGeneration) return;
  currentFilePath = episode.mediaUrl;
  currentFileName = episode.title;
  setDropzoneFile(episode.title, `${episode.service} · ${episode.show}`);
  transcribeBtn.disabled = false;
  loadWaveform(episode.mediaUrl);
}

// ── Drop Zone ─────────────────────────────────────────────────────────────────
dropzone.addEventListener('click', () => { if (!isRecording) fileInput.click(); });

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('hover');
});

dropzone.addEventListener('dragleave', () => dropzone.classList.remove('hover'));

// Drops are handled for the whole window, not just the drop zone: the source
// bar is a small target, and during a run the zone ignores pointer events.
// Without this, Chromium's default would open the dropped file in the window.
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('hover');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(api.getPathForFile(file));
});

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) handleFile(api.getPathForFile(fileInput.files[0]));
});

// ── File Handling ─────────────────────────────────────────────────────────────
async function handleFile(filePath) {
  if (!guardLoadMedia()) return;
  let info;
  try {
    info = await api.getFileInfo(filePath);
  } catch (e) {
    showError(`Could not read file: ${UiLogic.errorMessage(e)}`);
    return;
  }
  // A run may have started while getFileInfo was pending.
  if (!guardLoadMedia()) return;

  const sizeMB = (info.size / 1024 / 1024).toFixed(1);

  currentFilePath = filePath;
  currentFileName = info.name.replace(/\.[^.]+$/, '');

  setDropzoneFile(info.name, `${info.ext.toUpperCase()} · ${sizeMB} MB`);
  resetForNewMedia();

  loadWaveform(filePath);
}

// ── Waveform Trim ─────────────────────────────────────────────────────────────
let waveformPeaks = null;
let mediaDuration = 0;
let trimStart     = 0;
let trimEnd       = 0;

function formatTime(sec) {
  sec = Math.max(0, Math.round(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

// Video files get a visible <video> preview instead of the hidden <audio>
// element, so trimming shows the picture, not just the waveform.
const VIDEO_EXT_RE = /\.(mp4|mov|mkv|avi|m4v|wmv|3gp|ts)(\?|$)/i;
function isVideoFile(path) {
  return VIDEO_EXT_RE.test(path || '');
}

// The element actually driving playback right now — whichever of the two
// preview elements has a loaded source.
function activePreviewEl() {
  return previewVideo.classList.contains('visible') ? previewVideo : previewAudio;
}

function hideWaveform() {
  waveformSection.classList.remove('visible');
  waveformPeaks = null;
  mediaDuration = 0;
  previewAudio.pause();
  previewAudio.removeAttribute('src');
  previewVideo.pause();
  previewVideo.removeAttribute('src');
  previewVideo.classList.remove('visible');
  waveformPlayBtn.disabled = true;
}

// Best-effort preview: silently skipped if ffmpeg can't decode the format
// (transcription still runs on the full file/URL either way).
async function loadWaveform(filePath) {
  hideWaveform();
  try {
    const { peaks, duration, previewPath } = await api.getWaveformPeaks(filePath);
    // Peaks can arrive late (e.g. YouTube); drop them if other media was loaded.
    if (!duration || filePath !== currentFilePath) return;
    waveformPeaks = peaks;
    mediaDuration = duration;
    trimStart = 0;
    trimEnd   = duration;
    waveformSection.classList.add('visible');
    drawWaveform();
    updateHandles();

    if (previewPath) {
      const src = /^https?:\/\//i.test(previewPath) ? previewPath : api.toFileUrl(previewPath);
      if (isVideoFile(filePath)) {
        previewVideo.src = src;
        previewVideo.classList.add('visible');
      } else {
        previewAudio.src = src;
      }
      waveformPlayBtn.disabled = false;
    }
  } catch {}
}

// Plays a brief snippet at time `t` so dragging a handle previews where it
// lands, like scrubbing in a video editor.
let scrubPauseTimer = null;
function scrubPreview(t) {
  const el = activePreviewEl();
  if (!el.src) return;
  clearTimeout(scrubPauseTimer);
  try {
    el.currentTime = t;
    el.play().catch(() => {});
  } catch {}
  scrubPauseTimer = setTimeout(() => el.pause(), 200);
}

function stopScrubPreview() {
  clearTimeout(scrubPauseTimer);
  activePreviewEl().pause();
}

function drawWaveform() {
  if (!waveformPeaks) return;
  const dpr  = window.devicePixelRatio || 1;
  const rect = waveformCanvas.getBoundingClientRect();
  waveformCanvas.width  = rect.width * dpr;
  waveformCanvas.height = rect.height * dpr;
  const ctx = waveformCanvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, rect.width, rect.height);
  const midY = rect.height / 2;
  const barWidth = rect.width / waveformPeaks.length;
  const css    = getComputedStyle(document.body);
  const muted  = css.getPropertyValue('--text-secondary').trim() || '#888';
  const accent = css.getPropertyValue('--accent').trim() || '#007aff';
  // Bars inside the trim selection use the accent; the rest are muted.
  waveformPeaks.forEach((p, i) => {
    const t = ((i + 0.5) / waveformPeaks.length) * mediaDuration;
    const inside = t >= trimStart && t <= trimEnd;
    ctx.globalAlpha = inside ? 1 : 0.35;
    ctx.fillStyle = inside ? accent : muted;
    const h = Math.max(1, p * midY);
    ctx.fillRect(i * barWidth, midY - h, Math.max(1, barWidth - 1), h * 2);
  });
  ctx.globalAlpha = 1;
}

function updateHandles() {
  if (!mediaDuration) return;
  const startPct = (trimStart / mediaDuration) * 100;
  const endPct   = (trimEnd   / mediaDuration) * 100;
  handleStart.style.left        = `${startPct}%`;
  handleEnd.style.left          = `${endPct}%`;
  waveformSelection.style.left  = `${startPct}%`;
  waveformSelection.style.right = `${100 - endPct}%`;
  trimStartLabel.textContent    = formatTime(trimStart);
  trimEndLabel.textContent      = formatTime(trimEnd);
  trimDurationLabel.textContent = `${formatTime(trimEnd - trimStart)} selected`;
  drawWaveform();
}

function setupHandleDrag(handle, which) {
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const onMove = (ev) => {
      const rect = waveformCanvas.getBoundingClientRect();
      const pct  = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
      const t    = pct * mediaDuration;
      if (which === 'start') trimStart = Math.max(0, Math.min(t, trimEnd - 0.1));
      else                   trimEnd   = Math.min(mediaDuration, Math.max(t, trimStart + 0.1));
      updateHandles();
      scrubPreview(which === 'start' ? trimStart : trimEnd);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      stopScrubPreview();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}

setupHandleDrag(handleStart, 'start');
setupHandleDrag(handleEnd, 'end');

window.addEventListener('resize', () => { if (waveformPeaks) drawWaveform(); });

// ── Waveform preview playback ─────────────────────────────────────────────────
// Plays the current trim selection in full (as opposed to scrubPreview's brief
// snippet while dragging a handle), stopping automatically at the selection end.
waveformPlayBtn.addEventListener('click', () => {
  const el = activePreviewEl();
  if (!el.src) return;
  if (el.paused) {
    if (el.currentTime < trimStart || el.currentTime >= trimEnd) {
      el.currentTime = trimStart;
    }
    el.play().catch(() => {});
  } else {
    el.pause();
  }
});

function onPreviewPlay() {
  waveformPlayIcon.style.display = 'none';
  waveformPauseIcon.style.display = '';
}

function onPreviewPause() {
  waveformPlayIcon.style.display = '';
  waveformPauseIcon.style.display = 'none';
}

function onPreviewTimeUpdate(e) {
  const el = /** @type {HTMLMediaElement} */ (e.target);
  if (el.currentTime >= trimEnd) el.pause();
}

for (const el of [previewAudio, previewVideo]) {
  el.addEventListener('play', onPreviewPlay);
  el.addEventListener('pause', onPreviewPause);
  el.addEventListener('timeupdate', onPreviewTimeUpdate);
}

// ── Transcription ─────────────────────────────────────────────────────────────
const TRANSCRIBE_LABEL_HTML = transcribeLabel.innerHTML;

transcribeBtn.addEventListener('click', () => startTranscription());
// The run may take a moment to stop (a model download in progress finishes
// first), so acknowledge the click and ignore further progress updates.
let cancelling = false;
cancelBtn.addEventListener('click', () => {
  cancelling = true;
  cancelBtn.disabled = true;
  transcribeLabel.textContent = 'Cancelling…';
  api.cancelTranscription();
});

// New media can't replace the input mid-recording or mid-transcription.
function guardLoadMedia() {
  if (UiLogic.canLoadMedia(appState)) return true;
  showToast(appState === 'recording' ? 'Stop the recording first' : 'Cancel the current transcription first');
  return false;
}
btnTranslate.addEventListener('click', translateTranscript);

async function startTranscription() {
  if (!currentFilePath || appState !== 'loaded') return;

  clearError();
  btnTranslate.style.display = 'none';
  clearSummary();
  setState('transcribing');
  const generation = mediaGeneration;
  setButtonProgress('transcribe', 0);

  try {
    // ⌘↩ can fire while the hint field still has focus, before its change event.
    await saveHint();
    const hasTrim = waveformPeaks && (trimStart > 0.05 || trimEnd < mediaDuration - 0.05);
    const text = await api.transcribe(currentFilePath, hasTrim ? trimStart : null, hasTrim ? trimEnd : null, currentDisplayName);
    transcriptEl.value = text;
    updateCharCount();
    btnTranslate.style.display = '';
    setState('transcribed');
    currentHistoryId = await api.addHistory({
      name: currentDisplayName || currentFileName,
      fileName: currentFileName,
      source: currentFilePath,
      text,
    });
    if (UiLogic.shouldAutoSummarize({ autoSummarize, hasKey: hasApiKey, text, sameMedia: generation === mediaGeneration })) {
      runSummary();
    }
  } catch (e) {
    setState('loaded');
    // A user cancel isn't an error: just return to the loaded file.
    if (!UiLogic.isCancelledError(e)) showError(UiLogic.errorMessage(e) || 'Transcription failed.');
  } finally {
    resetTranscribeButton();
  }
}

async function translateTranscript() {
  const original = transcriptEl.value;
  if (!original.trim()) return;

  btnTranslate.disabled = true;
  btnTranslate.textContent = 'Translating…';
  clearError();
  const generation = mediaGeneration;

  try {
    const translated = await api.translateText(original);
    if (generation !== mediaGeneration) return; // other media loaded meanwhile
    transcriptEl.value = translated;
    if (currentHistoryId) api.updateHistory(currentHistoryId, translated);
    updateCharCount();
    showToast('Translation complete');
    btnTranslate.style.display = 'none';
  } catch (e) {
    if (generation === mediaGeneration) showError(`Translation failed: ${UiLogic.errorMessage(e)}`);
  } finally {
    btnTranslate.disabled = false;
    btnTranslate.textContent = 'Translate to English';
  }
}

// ── Progress ──────────────────────────────────────────────────────────────────
// While transcribing, the Transcribe button itself is the progress bar.
/** @param {'download'|'transcribe'} phase @param {number} pct */
function setButtonProgress(phase, pct) {
  if (appState !== 'transcribing' || cancelling) return;
  const isStream = /^https?:\/\//i.test(currentFilePath || '');
  transcribeFill.style.width = `${pct}%`;
  transcribeLabel.textContent = UiLogic.progressText(phase, pct, isStream);
}

function resetTranscribeButton() {
  cancelling = false;
  cancelBtn.disabled = false;
  transcribeFill.style.width = '0%';
  transcribeLabel.innerHTML = TRANSCRIBE_LABEL_HTML;
}

// ── Export ────────────────────────────────────────────────────────────────────
// Title-bar dropdown holding the per-format save buttons below.
const exportItems = /** @type {HTMLButtonElement[]} */ ([...exportMenu.querySelectorAll('[role="menuitem"]')]);

function isExportMenuOpen() {
  return !exportMenu.hidden;
}

function openExportMenu() {
  exportMenu.hidden = false;
  exportBtn.setAttribute('aria-expanded', 'true');
  exportItems[0].focus();
}

function closeExportMenu() {
  if (!isExportMenuOpen()) return;
  exportMenu.hidden = true;
  exportBtn.setAttribute('aria-expanded', 'false');
  exportBtn.focus();
}

exportBtn.addEventListener('click', () => (isExportMenuOpen() ? closeExportMenu() : openExportMenu()));

exportMenu.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const i = exportItems.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement));
  const step = e.key === 'ArrowDown' ? 1 : -1;
  exportItems[(i + step + exportItems.length) % exportItems.length].focus();
});

// Close after choosing a format (the save handlers below still run).
for (const item of exportItems) item.addEventListener('click', closeExportMenu);

document.addEventListener('mousedown', (e) => {
  const target = /** @type {Node} */ (e.target);
  if (isExportMenuOpen() && !exportMenu.contains(target) && !exportBtn.contains(target)) closeExportMenu();
});

btnCopy.addEventListener('click', () => {
  navigator.clipboard.writeText(transcriptEl.value).then(() => showToast('Copied to clipboard'));
});

btnTxt.addEventListener('click', async () => {
  const saved = await api.saveTXT({ transcript: transcriptEl.value, filename: currentFileName, summary: currentSummary });
  if (saved) showToast('Saved as TXT');
});

btnMd.addEventListener('click', async () => {
  const saved = await api.saveMD({ transcript: transcriptEl.value, filename: currentFileName, summary: currentSummary });
  if (saved) showToast('Saved as Markdown');
});

btnDocx.addEventListener('click', async () => {
  const saved = await api.saveDOCX({ transcript: transcriptEl.value, filename: currentFileName, summary: currentSummary });
  if (saved) showToast('Saved as DOCX');
});

btnSrt.addEventListener('click', async () => {
  const saved = await api.saveSRT({ transcript: transcriptEl.value, filename: currentFileName, summary: currentSummary });
  if (saved) showToast('Saved as SRT');
});

btnPdf.addEventListener('click', async () => {
  const saved = await api.savePDF({ transcript: transcriptEl.value, filename: currentFileName, summary: currentSummary });
  if (saved) showToast('Saved as PDF');
});

transcriptEl.addEventListener('input', () => {
  updateCharCount();
  scheduleHistorySave();
});

// ── Recent transcripts ────────────────────────────────────────────────────────
// The transcript on screen, if it's saved in history; edits are written back
// shortly after typing stops.
let currentHistoryId = null;
let historySaveTimer = null;

function scheduleHistorySave() {
  if (!currentHistoryId) return;
  clearTimeout(historySaveTimer);
  historySaveTimer = setTimeout(flushHistorySave, 600);
}

function flushHistorySave() {
  if (!historySaveTimer) return;
  clearTimeout(historySaveTimer);
  historySaveTimer = null;
  if (currentHistoryId) api.updateHistory(currentHistoryId, transcriptEl.value);
}

// Call before the transcript on screen is replaced or cleared.
function leaveHistoryEntry() {
  flushHistorySave();
  currentHistoryId = null;
}

async function refreshRecents() {
  const items = await api.listHistory();
  recentsList.replaceChildren(...items.map(renderRecentRow));
  recentsEl.hidden = items.length === 0;
}

function renderRecentRow({ id, name, createdAt, chars }) {
  const li = document.createElement('li');
  li.innerHTML = `
    <button class="recent-open"><span class="recent-name"></span><span class="recent-meta"></span></button>
    <button class="icon-btn recent-remove" aria-label="Remove from recents" title="Remove from recents">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>`;
  li.querySelector('.recent-name').textContent = name;
  li.querySelector('.recent-meta').textContent =
    `${UiLogic.relativeTime(createdAt)} · ${chars.toLocaleString()} chars`;
  li.querySelector('.recent-open').addEventListener('click', () => openRecent(id));
  li.querySelector('.recent-remove').addEventListener('click', async () => {
    await api.removeHistory(id);
    refreshRecents();
  });
  return li;
}

async function openRecent(id) {
  if (!guardLoadMedia()) return;
  const entry = await api.getHistory(id);
  if (!entry) return refreshRecents();
  leaveHistoryEntry();
  mediaGeneration++;
  currentFilePath = entry.source;
  currentFileName = entry.fileName;
  transcribeBtn.disabled = false;
  hideWaveform();
  clearError();
  setDropzoneFile(entry.name, `Saved transcript · ${UiLogic.relativeTime(entry.createdAt)}`);
  transcriptEl.value = entry.text;
  updateCharCount();
  btnTranslate.style.display = '';
  currentHistoryId = id;
  clearSummary();
  currentSummary = entry.summary ?? null;
  renderSummary();
  setState('transcribed');
}

function updateCharCount() {
  const len = transcriptEl.value.length;
  charCount.textContent = len > 0 ? `${len.toLocaleString()} chars` : '';
}

// ── Summary ───────────────────────────────────────────────────────────────────
// The summary for the transcript on screen. It lives here (so it works with
// history off) and is also written to the history entry when there is one.
/** @type {{overview: string, topics: {title: string, startSec: number | null}[], createdAt: number} | null} */
let currentSummary = null;
/** @type {'idle'|'running'|'error'} */
let summaryStatus = 'idle';
let summaryErrorText = '';
let hasApiKey = false;
let autoSummarize = false;
// Bumped per run and on clear, so a late or superseded result is dropped.
let summaryRun = 0;

const SUMMARY_COLLAPSED_KEY = 'summaryCollapsed';
function readCollapsed() {
  try { return localStorage.getItem(SUMMARY_COLLAPSED_KEY) === '1'; } catch { return false; }
}
function setCollapsed(collapsed) {
  summaryCard.classList.toggle('collapsed', collapsed);
  summaryToggle.setAttribute('aria-expanded', String(!collapsed));
  try { localStorage.setItem(SUMMARY_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch { /* per-viewer nicety only */ }
}
setCollapsed(readCollapsed());
summaryToggle.addEventListener('click', () => setCollapsed(!summaryCard.classList.contains('collapsed')));

function renderSummary() {
  const view = UiLogic.summaryView({ hasKey: hasApiKey, summary: currentSummary, status: summaryStatus });
  summaryCard.hidden = view.card === 'hidden';
  summaryCard.dataset.view = view.card;
  btnSummarize.style.display = view.showSummarizeButton ? '' : 'none';
  summaryRegen.hidden = !(view.card === 'summary' && view.canRegenerate);

  const showSummary = view.card === 'summary';
  summaryOverview.hidden = !showSummary;
  summaryTopics.hidden = !showSummary;
  summaryOverview.textContent = showSummary ? currentSummary.overview : '';
  summaryTopics.replaceChildren(...(showSummary ? currentSummary.topics.map((t) => {
    const li = document.createElement('li');
    const time = UiLogic.formatTopicTime(t.startSec);
    if (time) {
      const span = document.createElement('span');
      span.className = 'topic-time';
      span.textContent = time;
      li.append(span);
    }
    li.append(t.title);
    return li;
  }) : []));

  const running = view.card === 'running';
  summaryCard.dataset.error = view.showError ? '1' : '';
  summaryStatusEl.hidden = !running && !view.showError;
  summaryStatusText.textContent = running ? 'Summarizing…' : summaryErrorText;
  summaryAction.textContent = running ? 'Cancel' : 'Retry';
}

async function runSummary() {
  if (!hasApiKey) return;
  const run = ++summaryRun;
  const generation = mediaGeneration;
  const historyId = currentHistoryId;
  summaryStatus = 'running';
  summaryErrorText = '';
  renderSummary();
  try {
    const summary = await api.summarize(transcriptEl.value);
    if (run !== summaryRun || generation !== mediaGeneration) return;
    currentSummary = summary;
    summaryStatus = 'idle';
    if (historyId && historyId === currentHistoryId) api.updateHistorySummary(historyId, summary);
  } catch (e) {
    if (run !== summaryRun || generation !== mediaGeneration) return;
    if (UiLogic.isCancelledError(e)) {
      summaryStatus = 'idle';
    } else {
      summaryStatus = 'error';
      summaryErrorText = UiLogic.errorMessage(e) || 'Summarizing failed.';
    }
  }
  renderSummary();
}

// Forget the summary on screen (new media, closed file) and stop any request.
function clearSummary() {
  if (summaryStatus === 'running') api.cancelSummary();
  summaryRun++;
  currentSummary = null;
  summaryStatus = 'idle';
  summaryErrorText = '';
  renderSummary();
}

btnSummarize.addEventListener('click', runSummary);
summaryRegen.addEventListener('click', runSummary);
summaryAction.addEventListener('click', () => {
  if (summaryStatus === 'running') {
    summaryRun++;
    api.cancelSummary();
    summaryStatus = 'idle';
    renderSummary();
  } else {
    runSummary();
  }
});

/** @param {{hasApiKey: boolean, autoSummarize: boolean}} settings */
function applyKeySettings(settings) {
  hasApiKey = settings.hasApiKey;
  apiKeyInput.hidden = hasApiKey;
  apiKeySaveBtn.hidden = hasApiKey;
  apiKeySaved.hidden = !hasApiKey;
  apiKeyRemoveBtn.hidden = !hasApiKey;
  autoSummarizeToggle.disabled = !hasApiKey;
  autoSummarizeToggle.checked = hasApiKey && settings.autoSummarize;
}

apiKeySaveBtn.addEventListener('click', async () => {
  const result = await api.setApiKey(apiKeyInput.value);
  if (!result.ok) {
    apiKeyError.textContent = result.error;
    return;
  }
  apiKeyInput.value = '';
  apiKeyError.textContent = '';
  applyKeySettings(await api.getSettings());
  renderSummary();
  showToast('API key saved');
});

apiKeyRemoveBtn.addEventListener('click', async () => {
  await api.removeApiKey();
  // Main aborted any request in flight; drop its result here too.
  if (summaryStatus === 'running') summaryRun++;
  summaryStatus = 'idle';
  applyKeySettings(await api.getSettings());
  renderSummary();
  showToast('API key removed');
});

// ── Settings ──────────────────────────────────────────────────────────────────
async function openSettings() {
  const settings = await api.getSettings();
  timestampsToggle.checked = !!settings.timestamps;
  translateToggle.checked  = !!settings.translate;
  updateCheckToggle.checked = settings.checkUpdates;
  keepHistoryToggle.checked = settings.keepHistory;
  fillersToggle.checked     = settings.removeFillers;
  applyKeySettings(settings);
  apiKeyInput.value = '';
  apiKeyError.textContent = '';
  settingsOverlay.classList.add('visible');
}

function closeSettings() {
  settingsOverlay.classList.remove('visible');
}

gearBtn.addEventListener('click', openSettings);
settingsCancel.addEventListener('click', closeSettings);

settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) closeSettings();
});

settingsSave.addEventListener('click', async () => {
  await api.setSettings({
    timestamps: timestampsToggle.checked,
    translate:  translateToggle.checked,
    checkUpdates: updateCheckToggle.checked,
    keepHistory:  keepHistoryToggle.checked,
    removeFillers: fillersToggle.checked,
    ...(hasApiKey ? { autoSummarize: autoSummarizeToggle.checked } : {}),
  });
  if (hasApiKey) autoSummarize = autoSummarizeToggle.checked;
  if (!keepHistoryToggle.checked) leaveHistoryEntry();
  if (appState === 'empty') refreshRecents();
  closeSettings();
  showToast('Settings saved');
});

// Model and language are per-run pickers; each change is saved as the default.
api.getSettings().then((settings) => {
  modelSelect.value    = settings.model    || 'base';
  languageSelect.value = settings.language || 'auto';
  hintInput.value      = settings.prompt   || '';
  savedHint            = hintInput.value;
  hasApiKey            = settings.hasApiKey;
  autoSummarize        = settings.autoSummarize;
  renderSummary();
});

// Vocabulary hint: names and terms whisper should spell correctly. Remembered
// like the pickers.
let savedHint = '';
async function saveHint() {
  const value = hintInput.value.trim();
  if (value === savedHint) return;
  savedHint = value;
  await api.setSettings({ prompt: value });
}
hintInput.addEventListener('change', saveHint);
modelSelect.addEventListener('change', () => api.setSettings({ model: modelSelect.value }));
languageSelect.addEventListener('change', () => api.setSettings({ language: languageSelect.value }));

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
// ⌘O lives on the app menu; the rest are decided by UiLogic.shortcutAction.
document.addEventListener('keydown', (e) => {
  const action = UiLogic.shortcutAction(e, {
    state: appState,
    exportMenuOpen: isExportMenuOpen(),
    settingsOpen: settingsOverlay.classList.contains('visible'),
  });
  if (!action) return;
  e.preventDefault();
  if (action === 'transcribe')          startTranscription();
  else if (action === 'export')         openExportMenu();
  else if (action === 'copy')           btnCopy.click();
  else if (action === 'close-export')   closeExportMenu();
  else if (action === 'close-settings') closeSettings();
});

// ── IPC from main ─────────────────────────────────────────────────────────────
api.onFileSelected((filePath) => handleFile(filePath));
api.onOpenSettings(() => openSettings());
api.onTranscriptionProgress((pct) => setButtonProgress('transcribe', pct));
api.onModelDownloadProgress((pct) => setButtonProgress('download', pct));

// Main checks GitHub at launch; the app can't install updates itself (it
// isn't code-signed), so this just links to the release page.
api.onUpdateAvailable(({ version }) => {
  updateBtn.textContent = `Update ${version} available`;
  updateBtn.hidden = false;
});
updateBtn.addEventListener('click', () => api.openReleasePage());

setState('empty');
