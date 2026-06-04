/* global api */

let currentFilePath = null;
let currentFileName = null;

// ── Elements ──────────────────────────────────────────────────────────────────
const dropzone          = document.getElementById('dropzone');
const fileInput         = document.getElementById('file-input');
const statusArea        = document.getElementById('status-area');
const statusSpinner     = document.getElementById('status-spinner');
const statusIconOk      = document.getElementById('status-icon-ok');
const statusIconErr     = document.getElementById('status-icon-err');
const statusText        = document.getElementById('status-text');
const transcriptSection = document.getElementById('transcript-section');
const transcriptEl      = document.getElementById('transcript');
const charCount         = document.getElementById('char-count');
const transcribeBtnArea = document.getElementById('transcribe-btn-area');
const transcribeBtn     = document.getElementById('transcribe-btn');
const progressBarWrap   = document.getElementById('progress-bar-wrap');
const progressFill      = document.getElementById('progress-fill');
const progressLabel     = document.getElementById('progress-label');
const btnCopy           = document.getElementById('btn-copy');
const btnTranslate      = document.getElementById('btn-translate');
const btnTxt            = document.getElementById('btn-txt');
const btnMd             = document.getElementById('btn-md');
const btnDocx           = document.getElementById('btn-docx');
const btnSrt            = document.getElementById('btn-srt');
const btnPdf            = document.getElementById('btn-pdf');
const settingsOverlay   = document.getElementById('settings-overlay');
const modelSelect       = document.getElementById('model-select');
const languageSelect    = document.getElementById('language-select');
const timestampsToggle  = document.getElementById('timestamps-toggle');
const translateToggle   = document.getElementById('translate-toggle');
const settingsSave      = document.getElementById('settings-save');
const settingsCancel    = document.getElementById('settings-cancel');
const gearBtn           = document.getElementById('gear-btn');
const toast             = document.getElementById('toast');

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, duration = 2500) {
  clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

// ── Recording & Capture ───────────────────────────────────────────────────────
let mediaRecorder   = null;
let activeStream    = null;
let recordingChunks = [];
let recordingTimer  = null;
let recordingSecs   = 0;
let isRecording     = false;

const DROPZONE_DEFAULT_HTML = dropzone.innerHTML;
const inputOptions  = document.getElementById('input-options');
const urlInput      = document.getElementById('url-input');
const urlLoadBtn    = document.getElementById('url-load-btn');

document.getElementById('record-btn').addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    startRecordingWithStream(stream, 'Recording from microphone…');
  } catch (e) {
    showStatus('error', e.name === 'NotAllowedError'
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
      showStatus('error', 'No audio captured. Enable the audio option in the screen picker.');
      return;
    }
    startRecordingWithStream(new MediaStream(audioTracks), 'Capturing system audio…');
  } catch (e) {
    if (e.name === 'NotAllowedError') {
      showStatus('error', 'Screen recording access denied. Check System Settings → Privacy & Security → Screen Recording.');
    } else {
      showStatus('error', `Could not capture system audio: ${e.message}`);
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
    const blob     = new Blob(recordingChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
    const buffer   = await blob.arrayBuffer();
    const filePath = await api.saveRecording(new Uint8Array(buffer));
    if (filePath) await handleFile(filePath);
  };

  mediaRecorder.start(250);

  dropzone.innerHTML = `
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
  inputOptions.classList.add('hidden');
  transcribeBtnArea.classList.remove('visible');
  statusArea.classList.remove('visible');

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
}

function restoreDropzone() {
  dropzone.innerHTML = DROPZONE_DEFAULT_HTML;
  dropzone.classList.remove('has-file', 'hover');
  dropzone.onclick = null;
  inputOptions.classList.remove('hidden');
}

// ── URL Input ─────────────────────────────────────────────────────────────────
urlLoadBtn.addEventListener('click', () => loadUrl(urlInput.value.trim()));
urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadUrl(urlInput.value.trim()); });

function setDropzoneUrl(displayName, meta) {
  dropzone.classList.add('has-file');
  dropzone.innerHTML = `
    <svg class="mic-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
      <line x1="12" y1="19" x2="12" y2="23"/>
      <line x1="8" y1="23" x2="16" y2="23"/>
    </svg>
    <div class="file-info">
      <div class="file-name">${displayName}</div>
      <div class="file-meta">${meta} · Click to change</div>
    </div>`;
  dropzone.onclick = () => fileInput.click();
}

async function loadUrl(url) {
  if (!url) return;
  let parsed;
  try { parsed = new URL(url); } catch { showStatus('error', 'Invalid URL.'); return; }

  currentFilePath = url;

  // Show the URL immediately as a placeholder
  const isYouTube = /youtube\.com|youtu\.be/.test(parsed.hostname);
  const pathFile = parsed.pathname.split('/').filter(Boolean).pop();
  const initialName = (pathFile && pathFile !== 'watch') ? decodeURIComponent(pathFile) : url;
  currentFileName = initialName.replace(/\.[^.]+$/, '') || 'stream';
  setDropzoneUrl(initialName, parsed.hostname);

  urlInput.value = '';
  transcribeBtnArea.classList.add('visible');
  statusArea.classList.remove('visible');
  transcriptSection.classList.remove('visible');
  setExportEnabled(false);
  btnTranslate.style.display = 'none';
  transcriptEl.value = '';
  updateCharCount();

  // For YouTube, fetch the real title via the public oEmbed API
  if (isYouTube) {
    try {
      const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
      if (res.ok) {
        const data = await res.json();
        currentFileName = data.title;
        setDropzoneUrl(data.title, `YouTube · ${data.author_name}`);
      }
    } catch {}
  }
}

// ── Drop Zone ─────────────────────────────────────────────────────────────────
dropzone.addEventListener('click', () => { if (!isRecording) fileInput.click(); });

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('hover');
});

dropzone.addEventListener('dragleave', () => dropzone.classList.remove('hover'));

dropzone.addEventListener('drop', (e) => {
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
  let info;
  try {
    info = await api.getFileInfo(filePath);
  } catch (e) {
    showStatus('error', `Could not read file: ${e.message}`);
    return;
  }

  const sizeMB = (info.size / 1024 / 1024).toFixed(1);

  currentFilePath = filePath;
  currentFileName = info.name.replace(/\.[^.]+$/, '');

  dropzone.classList.add('has-file');
  dropzone.innerHTML = `
    <svg class="mic-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
      <line x1="12" y1="19" x2="12" y2="23"/>
      <line x1="8" y1="23" x2="16" y2="23"/>
    </svg>
    <div class="file-info">
      <div class="file-name">${info.name}</div>
      <div class="file-meta">${info.ext.toUpperCase()} · ${sizeMB} MB · Click to change</div>
    </div>
  `;

  dropzone.onclick = () => fileInput.click();

  transcribeBtnArea.classList.add('visible');
  statusArea.classList.remove('visible');
  transcriptSection.classList.remove('visible');
  setExportEnabled(false);
  btnTranslate.style.display = 'none';
  transcriptEl.value = '';
  updateCharCount();
}

// ── Transcription ─────────────────────────────────────────────────────────────
transcribeBtn.addEventListener('click', () => startTranscription(false));
btnTranslate.addEventListener('click', translateTranscript);

async function startTranscription() {
  if (!currentFilePath) return;

  transcribeBtn.disabled = true;
  btnTranslate.style.display = 'none';
  showStatus('loading', 'Loading model…');
  transcriptSection.classList.remove('visible');
  setExportEnabled(false);

  try {
    const text = await api.transcribe(currentFilePath);
    transcriptEl.value = text;
    updateCharCount();
    showStatus('ok', 'Transcription complete!');
    transcriptSection.classList.add('visible');
    setExportEnabled(true);
    btnTranslate.style.display = '';
  } catch (e) {
    showStatus('error', e.message || 'Transcription failed.');
  } finally {
    transcribeBtn.disabled = false;
  }
}

async function translateTranscript() {
  const original = transcriptEl.value;
  if (!original.trim()) return;

  btnTranslate.disabled = true;
  showStatus('loading', 'Translating…');

  try {
    const translated = await api.translateText(original);
    transcriptEl.value = translated;
    updateCharCount();
    showStatus('ok', 'Translation complete!');
    btnTranslate.style.display = 'none';
  } catch (e) {
    showStatus('error', `Translation failed: ${e.message}`);
  } finally {
    btnTranslate.disabled = false;
  }
}

// ── Status ────────────────────────────────────────────────────────────────────
function showStatus(type, message) {
  statusArea.classList.add('visible');
  statusText.textContent = message;

  const showProgress = type === 'progress';
  statusSpinner.style.display    = type === 'loading'  ? 'block' : 'none';
  statusIconOk.style.display     = type === 'ok'       ? 'block' : 'none';
  statusIconErr.style.display    = type === 'error'    ? 'block' : 'none';
  if (showProgress) {
    progressBarWrap.classList.add('visible');
  } else {
    progressBarWrap.classList.remove('visible');
    progressFill.style.width = '0%';
  }
}

function setProgress(pct) {
  progressFill.style.width = `${pct}%`;
  progressLabel.textContent = `${pct}%`;
  if (pct > 0 && pct < 100) {
    let label;
    if (pct < 5) {
      const isStream = /^https?:\/\//i.test(currentFilePath || '');
      label = isStream ? `Fetching "${currentFileName}"…` : 'Preparing audio…';
    } else {
      label = `Transcribing "${currentFileName}"…`;
    }
    showStatus('progress', label);
  }
}

// ── Export ────────────────────────────────────────────────────────────────────
function setExportEnabled(enabled) {
  btnCopy.disabled = !enabled;
  btnTxt.disabled  = !enabled;
  btnMd.disabled   = !enabled;
  btnDocx.disabled = !enabled;
  btnSrt.disabled  = !enabled;
  btnPdf.disabled  = !enabled;
}

btnCopy.addEventListener('click', () => {
  navigator.clipboard.writeText(transcriptEl.value).then(() => showToast('Copied to clipboard'));
});

btnTxt.addEventListener('click', async () => {
  const saved = await api.saveTXT({ transcript: transcriptEl.value, filename: currentFileName });
  if (saved) showToast('Saved as TXT');
});

btnMd.addEventListener('click', async () => {
  const saved = await api.saveMD({ transcript: transcriptEl.value, filename: currentFileName });
  if (saved) showToast('Saved as Markdown');
});

btnDocx.addEventListener('click', async () => {
  const saved = await api.saveDOCX({ transcript: transcriptEl.value, filename: currentFileName });
  if (saved) showToast('Saved as DOCX');
});

btnSrt.addEventListener('click', async () => {
  const saved = await api.saveSRT({ transcript: transcriptEl.value, filename: currentFileName });
  if (saved) showToast('Saved as SRT');
});

btnPdf.addEventListener('click', async () => {
  const saved = await api.savePDF({ transcript: transcriptEl.value, filename: currentFileName });
  if (saved) showToast('Saved as PDF');
});

transcriptEl.addEventListener('input', updateCharCount);

function updateCharCount() {
  const len = transcriptEl.value.length;
  charCount.textContent = len > 0 ? `${len.toLocaleString()} chars` : '';
}

// ── Settings ──────────────────────────────────────────────────────────────────
async function openSettings() {
  const settings = await api.getSettings();
  modelSelect.value = settings.model || 'base';
  languageSelect.value = settings.language || 'auto';
  timestampsToggle.checked = !!settings.timestamps;
  translateToggle.checked  = !!settings.translate;
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
    model:      modelSelect.value,
    language:   languageSelect.value,
    timestamps: timestampsToggle.checked,
    translate:  translateToggle.checked,
  });
  closeSettings();
  showToast('Settings saved');
});

// ── IPC from main ─────────────────────────────────────────────────────────────
api.onFileSelected((filePath) => handleFile(filePath));
api.onOpenSettings(() => openSettings());
api.onThemeChanged(() => {});
api.onTranscriptionProgress((pct) => setProgress(pct));
api.onModelDownloadProgress((pct) => {
  showStatus('progress', 'Downloading model…');
  progressFill.style.width = `${pct}%`;
  progressLabel.textContent = `${pct}%`;
});
