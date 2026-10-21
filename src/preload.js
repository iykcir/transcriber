const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Sandboxed preload's polyfilled `require('url')` lacks pathToFileURL, so
// build the file:// URL by hand, percent-encoding each path segment.
function toFileUrl(filePath) {
  const encoded = filePath.split('/').map(encodeURIComponent).join('/');
  return `file://${encoded}`;
}

const api = {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (settings) => ipcRenderer.invoke('set-settings', settings),
  transcribe: (filePath, startSec, endSec, displayName) => ipcRenderer.invoke('transcribe', filePath, startSec, endSec, displayName),
  cancelTranscription: () => ipcRenderer.invoke('cancel-transcription'),
  getWaveformPeaks: (filePath) => ipcRenderer.invoke('get-waveform-peaks', filePath),
  toFileUrl,
  savePDF:  (data) => ipcRenderer.invoke('save-pdf',  data),
  saveTXT:  (data) => ipcRenderer.invoke('save-txt',  data),
  saveDOCX: (data) => ipcRenderer.invoke('save-docx', data),
  saveSRT:  (data) => ipcRenderer.invoke('save-srt',  data),
  saveMD:   (data) => ipcRenderer.invoke('save-md',   data),
  saveRecording: (buffer) => ipcRenderer.invoke('save-recording', buffer),
  translateText: (text) => ipcRenderer.invoke('translate-text', text),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  getFileInfo: (filePath) => ipcRenderer.invoke('get-file-info', filePath),
  onFileSelected: (cb) => ipcRenderer.on('file-selected', (_, path) => cb(path)),
  onOpenSettings: (cb) => ipcRenderer.on('open-settings', () => cb()),
  onTranscriptionProgress: (cb) => ipcRenderer.on('transcription-progress', (_, pct) => cb(pct)),
  listHistory: () => ipcRenderer.invoke('history-list'),
  getHistory: (id) => ipcRenderer.invoke('history-get', id),
  addHistory: (entry) => ipcRenderer.invoke('history-add', entry),
  updateHistory: (id, text) => ipcRenderer.invoke('history-update', id, text),
  removeHistory: (id) => ipcRenderer.invoke('history-remove', id),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_, info) => cb(info)),
  openReleasePage: () => ipcRenderer.invoke('open-release-page'),
  onModelDownloadProgress: (cb) => ipcRenderer.on('model-download-progress', (_, pct) => cb(pct)),
};

/** @typedef {typeof api} PreloadApi */

contextBridge.exposeInMainWorld('api', api);
