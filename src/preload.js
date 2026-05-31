const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (settings) => ipcRenderer.invoke('set-settings', settings),
  transcribe: (filePath) => ipcRenderer.invoke('transcribe', filePath),
  savePDF: (data) => ipcRenderer.invoke('save-pdf', data),
  saveTXT: (data) => ipcRenderer.invoke('save-txt', data),
  showInFinder: (filePath) => ipcRenderer.invoke('show-in-finder', filePath),
  getFileInfo: (filePath) => ipcRenderer.invoke('get-file-info', filePath),
  getTheme: () => ipcRenderer.invoke('get-theme'),
  onFileSelected: (cb) => ipcRenderer.on('file-selected', (_, path) => cb(path)),
  onOpenSettings: (cb) => ipcRenderer.on('open-settings', () => cb()),
  onThemeChanged: (cb) => ipcRenderer.on('theme-changed', (_, theme) => cb(theme)),
});
