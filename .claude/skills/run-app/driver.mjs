import { _electron as electron } from 'playwright-core';
import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, '../../..');
const SHOT_DIR = process.env.SCREENSHOT_DIR || '/tmp/shots';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const electronBin = path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');

let app = null;
let page = null;

const COMMANDS = {
  async launch() {
    if (app) return console.log('already launched');
    app = await electron.launch({
      executablePath: electronBin,
      args: [APP_DIR],
      env: { ...process.env },
      timeout: 30_000,
    });
    await new Promise(r => setTimeout(r, 4_000));
    page = app.windows().find(w => !w.url().startsWith('devtools://'))
        ?? await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    console.log('launched.', app.windows().length, 'window(s)');
  },

  async ss(name) {
    if (!page) return console.log('ERROR: launch first');
    const f = path.join(SHOT_DIR, (name || `ss-${Date.now()}`) + '.png');
    await page.screenshot({ path: f });
    console.log('screenshot:', f);
  },

  async click(sel) {
    if (!page) return console.log('ERROR: launch first');
    const r = await page.evaluate(s => {
      const el = document.querySelector(s);
      if (!el) return 'NOT_FOUND';
      el.click(); return 'OK';
    }, sel);
    console.log('click', sel, '→', r);
  },

  async 'load-file'(filePath) {
    if (!page) return console.log('ERROR: launch first');
    // Invoke the transcribe IPC directly with a file path
    const r = await page.evaluate(async (p) => {
      try {
        await window.api.getFileInfo(p);
        // Simulate file-selected IPC event path via the exposed API
        const info = await window.api.getFileInfo(p);
        return JSON.stringify(info);
      } catch(e) { return 'ERROR: ' + e.message; }
    }, filePath);
    console.log('file info:', r);
    // Trigger file-selected from main via IPC
    await app.evaluate(({ ipcMain, webContents }, p) => {
      webContents.getAllWebContents()[0].send('file-selected', p);
    }, filePath);
    console.log('file-selected sent:', filePath);
  },

  async transcribe() {
    if (!page) return console.log('ERROR: launch first');
    // Click the Transcribe button
    const r = await page.evaluate(() => {
      const btn = document.getElementById('transcribe-btn');
      if (!btn) return 'NOT_FOUND';
      btn.click(); return 'OK';
    });
    console.log('transcribe button:', r);
  },

  async text(sel) {
    if (!page) return console.log('ERROR: launch first');
    console.log(await page.evaluate(
      s => (s ? document.querySelector(s) : document.body)?.innerText ?? '(null)',
      sel || null));
  },

  async eval(expr) {
    if (!page) return console.log('ERROR: launch first');
    try { console.log(JSON.stringify(await page.evaluate(expr))); }
    catch (e) { console.log('ERROR:', e.message); }
  },

  async windows() {
    if (!app) return console.log('ERROR: launch first');
    for (const w of app.windows()) console.log(' ', w.url());
  },

  async quit() { if (app) await app.close().catch(() => {}); app = null; page = null; },
  help() { console.log('commands:', Object.keys(COMMANDS).join(', ')); },
};

const stdin = fs.createReadStream(null, { fd: fs.openSync('/dev/stdin', 'r') });
const rl = readline.createInterface({ input: stdin, output: process.stdout, prompt: 'driver> ' });

rl.on('line', async line => {
  const [cmd, ...rest] = line.trim().split(/\s+/);
  if (!cmd) return rl.prompt();
  const fn = COMMANDS[cmd];
  if (!fn) { console.log('unknown:', cmd, '— try: help'); return rl.prompt(); }
  try { await fn(rest.join(' ')); } catch (e) { console.log('ERROR:', e.message); }
  if (cmd === 'quit') { rl.close(); process.exit(0); }
  rl.prompt();
});
rl.on('close', async () => { await COMMANDS.quit(); process.exit(0); });

console.log('Transcriber driver — "launch" to start, "help" for commands');
rl.prompt();
