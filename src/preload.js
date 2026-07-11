const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Sandboxed preload's polyfilled `require('url')` lacks pathToFileURL, so
// build the file:// URL by hand, percent-encoding each path segment.
function toFileUrl(filePath) {
  const encoded = filePath.split('/').map(encodeURIComponent).join('/');
  return `file://${encoded}`;
}

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (settings) => ipcRenderer.invoke('set-settings', settings),
  transcribe: (filePath, startSec, endSec) => ipcRenderer.invoke('transcribe', filePath, startSec, endSec),
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
  onModelDownloadProgress: (cb) => ipcRenderer.on('model-download-progress', (_, pct) => cb(pct)),
});
