const { app, BrowserWindow, ipcMain, dialog, Menu, shell, nativeTheme } = require('electron');
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
    language:  config.language  || 'auto',
    timestamps: config.timestamps || false,
    model:     config.model     || 'base',
    translate: config.translate  || false,
  };
});

ipcMain.handle('set-settings', (_, settings) => {
  writeConfig(settings);
});

ipcMain.handle('transcribe', async (_, filePath) => {
  const { transcribeAudio } = require('./transcribe');
  const config = readConfig();
  const language  = config.language  || 'auto';
  const timestamps = config.timestamps || false;
  const model     = config.model     || 'base';
  const translate = config.translate  || false;
  return transcribeAudio(filePath, language, timestamps, model, translate,
    (pct) => mainWindow?.webContents.send('transcription-progress', pct),
    (pct) => mainWindow?.webContents.send('model-download-progress', pct),
  );
});

ipcMain.handle('save-pdf', async (_, { transcript, filename }) => {
  const { exportPDF } = require('./export');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Transcript as PDF',
    defaultPath: `${filename}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (result.canceled) return null;
  await exportPDF(transcript, filename, result.filePath);
  return result.filePath;
});

ipcMain.handle('save-txt', async (_, { transcript, filename }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Transcript as Text',
    defaultPath: `${filename}.txt`,
    filters: [{ name: 'Text File', extensions: ['txt'] }],
  });
  if (result.canceled) return null;
  fs.writeFileSync(result.filePath, transcript, 'utf8');
  return result.filePath;
});

ipcMain.handle('save-docx', async (_, { transcript, filename }) => {
  const { exportDOCX } = require('./export');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Transcript as Word Document',
    defaultPath: `${filename}.docx`,
    filters: [{ name: 'Word Document', extensions: ['docx'] }],
  });
  if (result.canceled) return null;
  await exportDOCX(transcript, filename, result.filePath);
  return result.filePath;
});

ipcMain.handle('save-srt', async (_, { transcript, filename }) => {
  const { exportSRT } = require('./export');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Transcript as Subtitles',
    defaultPath: `${filename}.srt`,
    filters: [{ name: 'SubRip Subtitle', extensions: ['srt'] }],
  });
  if (result.canceled) return null;
  fs.writeFileSync(result.filePath, exportSRT(transcript), 'utf8');
  return result.filePath;
});

ipcMain.handle('save-md', async (_, { transcript, filename }) => {
  const { exportMarkdown } = require('./export');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Transcript as Markdown',
    defaultPath: `${filename}.md`,
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  });
  if (result.canceled) return null;
  fs.writeFileSync(result.filePath, exportMarkdown(transcript, filename), 'utf8');
  return result.filePath;
});

ipcMain.handle('save-recording', (_, buffer) => {
  const tmpPath = path.join(os.tmpdir(), `recording-${Date.now()}.webm`);
  fs.writeFileSync(tmpPath, Buffer.from(buffer));
  return tmpPath;
});

ipcMain.handle('show-in-finder', (_, filePath) => {
  shell.showItemInFolder(filePath);
});

ipcMain.handle('get-file-info', async (_, filePath) => {
  const stat = fs.statSync(filePath);
  return {
    name: path.basename(filePath),
    size: stat.size,
    ext: path.extname(filePath).slice(1),
  };
});

ipcMain.handle('get-theme', () => nativeTheme.shouldUseDarkColors ? 'dark' : 'light');

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

nativeTheme.on('updated', () => {
  mainWindow?.webContents.send('theme-changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
});
