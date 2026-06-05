const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (settings) => ipcRenderer.invoke('set-settings', settings),
  transcribe: (filePath) => ipcRenderer.invoke('transcribe', filePath),
  savePDF:  (data) => ipcRenderer.invoke('save-pdf',  data),
  saveTXT:  (data) => ipcRenderer.invoke('save-txt',  data),
  saveDOCX: (data) => ipcRenderer.invoke('save-docx', data),
  saveSRT:  (data) => ipcRenderer.invoke('save-srt',  data),
  saveMD:          (data)   => ipcRenderer.invoke('save-md',        data),
  saveRecording:   (buffer) => ipcRenderer.invoke('save-recording', buffer),
  translateText:   (text)         => ipcRenderer.invoke('translate-text',  text),
  showInFinder: (filePath) => ipcRenderer.invoke('show-in-finder', filePath),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  getFileInfo: (filePath) => ipcRenderer.invoke('get-file-info', filePath),
  getTheme: () => ipcRenderer.invoke('get-theme'),
  onFileSelected: (cb) => ipcRenderer.on('file-selected', (_, path) => cb(path)),
  onOpenSettings: (cb) => ipcRenderer.on('open-settings', () => cb()),
  onThemeChanged: (cb) => ipcRenderer.on('theme-changed', (_, theme) => cb(theme)),
  onTranscriptionProgress: (cb) => ipcRenderer.on('transcription-progress', (_, pct) => cb(pct)),
  onModelDownloadProgress: (cb) => ipcRenderer.on('model-download-progress', (_, pct) => cb(pct)),
});
