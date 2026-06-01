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
const btnTxt            = document.getElementById('btn-txt');
const btnMd             = document.getElementById('btn-md');
const btnDocx           = document.getElementById('btn-docx');
const btnSrt            = document.getElementById('btn-srt');
const btnPdf            = document.getElementById('btn-pdf');
const settingsOverlay   = document.getElementById('settings-overlay');
const modelSelect       = document.getElementById('model-select');
const languageSelect    = document.getElementById('language-select');
const timestampsToggle  = document.getElementById('timestamps-toggle');
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

// ── Recording ─────────────────────────────────────────────────────────────────
let mediaRecorder   = null;
let recordingChunks = [];
let recordingTimer  = null;
let recordingSecs   = 0;
let isRecording     = false;

const DROPZONE_DEFAULT_HTML = dropzone.innerHTML;

function attachRecordBtn() {
  const btn = document.getElementById('record-btn');
  if (btn) btn.addEventListener('click', (e) => { e.stopPropagation(); startRecording(); });
}
attachRecordBtn();

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    mediaRecorder    = new MediaRecorder(stream);
    recordingChunks  = [];
    recordingSecs    = 0;
    isRecording      = true;

    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordingChunks.push(e.data); };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      isRecording = false;
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
      <div class="rec-label">Recording from microphone…</div>
      <div class="rec-buttons">
        <button class="btn-primary" id="stop-record-btn">Stop</button>
        <button class="btn-secondary" id="cancel-record-btn">Cancel</button>
      </div>`;
    dropzone.classList.remove('has-file', 'hover');
    transcribeBtnArea.classList.remove('visible');
    statusArea.classList.remove('visible');

    document.getElementById('stop-record-btn').addEventListener('click',   (e) => { e.stopPropagation(); stopRecording();   });
    document.getElementById('cancel-record-btn').addEventListener('click', (e) => { e.stopPropagation(); cancelRecording(); });

    recordingTimer = setInterval(() => {
      recordingSecs++;
      const el = document.getElementById('rec-timer');
      if (el) el.textContent = `${Math.floor(recordingSecs / 60)}:${String(recordingSecs % 60).padStart(2, '0')}`;
    }, 1000);

  } catch (e) {
    isRecording = false;
    showStatus('error', e.name === 'NotAllowedError'
      ? 'Microphone access denied. Check System Settings → Privacy & Security → Microphone.'
      : `Could not access microphone: ${e.message}`);
  }
}

function stopRecording() {
  clearInterval(recordingTimer);
  if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
}

function cancelRecording() {
  clearInterval(recordingTimer);
  isRecording = false;
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.onstop = () => {};
    mediaRecorder.stream?.getTracks().forEach(t => t.stop());
    mediaRecorder.stop();
  }
  restoreDropzone();
}

function restoreDropzone() {
  dropzone.innerHTML = DROPZONE_DEFAULT_HTML;
  dropzone.classList.remove('has-file', 'hover');
  dropzone.onclick = null;
  attachRecordBtn();
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
  transcriptEl.value = '';
  updateCharCount();
}

// ── Transcription ─────────────────────────────────────────────────────────────
transcribeBtn.addEventListener('click', startTranscription);

async function startTranscription() {
  if (!currentFilePath) return;

  transcribeBtn.disabled = true;
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
  } catch (e) {
    showStatus('error', e.message || 'Transcription failed.');
  } finally {
    transcribeBtn.disabled = false;
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
    const label = pct < 5 ? 'Preparing audio…' : 'Transcribing with whisper.cpp…';
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
    model: modelSelect.value,
    language: languageSelect.value,
    timestamps: timestampsToggle.checked,
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
