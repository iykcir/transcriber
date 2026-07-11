const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Electron GUI apps launch without the user's shell PATH, so tools installed
// via Homebrew (cmake, ffmpeg, etc.) are invisible to child processes.
// Prepend the common Homebrew and system tool paths to fix this.
const EXTRA_PATHS = ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', '/usr/local/sbin'];
process.env.PATH = [...EXTRA_PATHS, ...(process.env.PATH || '').split(':').filter(Boolean)].join(':');

let mainWindow;

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

function readConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch {}
  return {};
}

function writeConfig(data) {
  const current = readConfig();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...current, ...data }, null, 2));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 700,
    minHeight: 550,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

function buildMenu() {
  const template = [
    {
      label: 'Transcriber',
      submenu: [
        { label: 'About Transcriber', click: () => showAbout() },
        { type: 'separator' },
        { label: 'Settings...', accelerator: 'CmdOrCtrl+,', click: () => mainWindow.webContents.send('open-settings') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Audio...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              title: 'Open Audio File',
              filters: [
                { name: 'Audio & Video Files', extensions: ['mp3', 'mp4', 'm4a', 'wav', 'ogg', 'webm', 'flac', 'mov', 'mkv', 'avi', 'm4v', 'wmv', '3gp', 'ts'] },
              ],
              properties: ['openFile'],
            });
            if (!result.canceled && result.filePaths.length > 0) {
              mainWindow.webContents.send('file-selected', result.filePaths[0]);
            }
          },
        },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'About Transcriber', click: () => showAbout() },
        {
          label: 'whisper.cpp on GitHub',
          click: () => shell.openExternal('https://github.com/ggerganov/whisper.cpp'),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function showAbout() {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'About Transcriber',
    message: 'Transcriber',
    detail: `Version ${app.getVersion()}\n\nOffline audio transcription powered by whisper.cpp.\n\n© 2024`,
    buttons: ['OK'],
  });
}

// IPC handlers
ipcMain.handle('get-settings', () => {
  const config = readConfig();
  return {
    language:   config.language   || 'auto',
    timestamps: config.timestamps || false,
    model:      config.model      || 'base',
    translate:  config.translate  || false,
  };
});

ipcMain.handle('set-settings', (_, settings) => {
  writeConfig(settings);
});

ipcMain.handle('transcribe', async (_, filePath, startSec, endSec) => {
  const { transcribeAudio } = require('./transcribe');
  const config = readConfig();
  const language  = config.language  || 'auto';
  const timestamps = config.timestamps || false;
  const model     = config.model     || 'base';
  const translate = config.translate  || false;
  return transcribeAudio(filePath, language, timestamps, model, translate,
    (pct) => mainWindow?.webContents.send('transcription-progress', pct),
    (pct) => mainWindow?.webContents.send('model-download-progress', pct),
    startSec ?? null, endSec ?? null,
  );
});

ipcMain.handle('get-waveform-peaks', async (_, filePath) => {
  const { getWaveformPeaks } = require('./transcribe');
  return getWaveformPeaks(filePath);
});

// Each export format shares the same flow: prompt for a destination, then
// write. `write` gets (transcript, filename, outPath); ./export is required
// lazily so pdfkit/docx don't load at app startup.
const EXPORT_FORMATS = {
  'save-txt':  { title: 'Text', name: 'Text File', ext: 'txt',
    write: (t, _f, out) => fs.writeFileSync(out, t, 'utf8') },
  'save-md':   { title: 'Markdown', name: 'Markdown', ext: 'md',
    write: (t, f, out) => fs.writeFileSync(out, require('./export').exportMarkdown(t, f), 'utf8') },
  'save-srt':  { title: 'Subtitles', name: 'SubRip Subtitle', ext: 'srt',
    write: (t, _f, out) => fs.writeFileSync(out, require('./export').exportSRT(t), 'utf8') },
  'save-docx': { title: 'Word Document', name: 'Word Document', ext: 'docx',
    write: (t, f, out) => require('./export').exportDOCX(t, f, out) },
  'save-pdf':  { title: 'PDF', name: 'PDF', ext: 'pdf',
    write: (t, f, out) => require('./export').exportPDF(t, f, out) },
};

for (const [channel, fmt] of Object.entries(EXPORT_FORMATS)) {
  ipcMain.handle(channel, async (_, { transcript, filename }) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: `Save Transcript as ${fmt.title}`,
      defaultPath: `${filename}.${fmt.ext}`,
      filters: [{ name: fmt.name, extensions: [fmt.ext] }],
    });
    if (result.canceled) return null;
    await fmt.write(transcript, filename, result.filePath);
    return result.filePath;
  });
}

ipcMain.handle('translate-text', async (_, text) => {
  const { translate } = require('@vitalets/google-translate-api');
  // Chunk large texts to stay within API limits (~5000 chars per request)
  const CHUNK = 4800;
  const chunks = [];
  for (let i = 0; i < text.length; i += CHUNK) chunks.push(text.slice(i, i + CHUNK));
  const results = await Promise.all(chunks.map(c => translate(c, { to: 'en' })));
  return results.map(r => r.text).join('');
});

ipcMain.handle('save-recording', (_, buffer) => {
  const tmpPath = path.join(os.tmpdir(), `recording-${Date.now()}.webm`);
  fs.writeFileSync(tmpPath, Buffer.from(buffer));
  return tmpPath;
});

ipcMain.handle('get-file-info', async (_, filePath) => {
  const stat = fs.statSync(filePath);
  return {
    name: path.basename(filePath),
    size: stat.size,
    ext: path.extname(filePath).slice(1),
  };
});

app.whenReady().then(() => {
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
