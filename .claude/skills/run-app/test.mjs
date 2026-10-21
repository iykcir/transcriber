import { _electron as electron } from 'playwright-core';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR   = path.resolve(__dirname, '../../..');
const SHOT_DIR  = '/tmp/shots';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const electronBin = path.join(APP_DIR,
  'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');

const SAMPLE = path.join(APP_DIR,
  'node_modules/nodejs-whisper/cpp/whisper.cpp/samples/jfk.mp3');

console.log('Launching Transcriber…');
const app = await electron.launch({
  executablePath: electronBin,
  args: [APP_DIR],
  env: { ...process.env },
  timeout: 30_000,
});

// Wait for the main window to be ready
const page = await app.firstWindow();
await page.waitForSelector('#dropzone', { timeout: 15_000 });
console.log('App ready.');

await page.screenshot({ path: `${SHOT_DIR}/01-initial.png` });
console.log('Screenshot: 01-initial.png');

// Send file-selected event from main process
await app.evaluate(({ webContents }, p) => {
  const [wc] = webContents.getAllWebContents().filter(w => w.getURL().includes('index.html'));
  if (wc) wc.send('file-selected', p);
}, SAMPLE);

await page.waitForSelector('body[data-state="loaded"]', { timeout: 5_000 });
await page.screenshot({ path: `${SHOT_DIR}/02-file-loaded.png` });
console.log('Screenshot: 02-file-loaded.png — file loaded, starting transcription…');

// Click transcribe
await page.evaluate(() => document.getElementById('transcribe-btn').click());

// Wait for transcription to complete (app moves to the transcribed state)
// Timeout generous because model download may happen first
await page.waitForSelector('body[data-state="transcribed"]', { timeout: 600_000 });
await page.screenshot({ path: `${SHOT_DIR}/03-result.png` });
console.log('Screenshot: 03-result.png');

const transcript = await page.evaluate(() =>
  document.getElementById('transcript')?.value ?? '(empty)');
console.log('\n── Transcript ──────────────────────────');
console.log(transcript);
console.log('────────────────────────────────────────\n');

// Verify the Export menu is offered once there's a transcript
console.log('Export menu visible:', await page.isVisible('#export-btn'));

await app.close();
console.log('Done.');
