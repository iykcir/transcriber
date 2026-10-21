# Transcriber

A native-feeling macOS desktop app for offline audio and video transcription, powered by [whisper.cpp](https://github.com/ggerganov/whisper.cpp). No API key required — transcription runs entirely on-device.

## Features

### Input
| Method | Details |
|---|---|
| Drag & drop or browse | Drop a file anywhere on the window, click the drop zone, or use File → Open (⌘O) |
| Record from microphone | Click **Record mic** to capture live audio |
| Capture system audio | Click **System audio** to record whatever is playing on your Mac (meetings, podcasts, videos) |
| URL | Paste a direct link to audio or video and press Enter or click **Load**; YouTube links are supported out of the box (the app manages its own `yt-dlp` binary, kept up to date automatically) |

Once something is loaded, the drop zone collapses into a slim bar showing the file name and size. Click **Change** to pick another file, or **×** to close it and get back to the record and link options.

### Supported formats
Audio: MP3, M4A, WAV, OGG, WebM, FLAC  
Video: MP4, MOV, MKV, AVI, M4V, WMV, 3GP, TS — audio is extracted automatically

### File size
No limit. Files of any size are accepted; a bundled copy of ffmpeg converts them to the 16 kHz mono WAV format whisper requires before transcription — no separate ffmpeg install needed.

### Trim & preview
Once a file loads, a waveform appears with draggable start/end handles to select just the part you want transcribed — useful for skipping a long intro or trimming a recording down to the relevant clip. Drag a handle to hear a brief snippet of where it lands, or use the **play/pause button** next to the waveform to play the full selection (auto-stopping at the end). Video files show a real video preview above the waveform instead of just an audio scrubber.

### Models
Downloaded automatically on first use and cached in `~/Library/Application Support/Transcriber/models/`.

| Model | Size | Speed |
|---|---|---|
| Tiny | 75 MB | Fastest |
| Base | 142 MB | Recommended |
| Small | 466 MB | More accurate |
| Medium | 1.5 GB | Very accurate |
| Turbo (large-v3-turbo, quantized) | 574 MB | Most accurate — near large-v3 quality, faster than Medium |

### Transcription options
**Model**, **Language** and optional **Spelling hints** are chosen right next to the Transcribe button; whatever you pick is remembered for next time. **Timestamps**, **Translate to English**, recent transcripts and the launch-time update check live in Settings (⌘,).

- **Spelling hints** — names, jargon or acronyms whisper should spell exactly, separated by commas (e.g. *Okonkwo, Kubernetes, MBS*); a short explanation appears under the field while you type

- **Language** — auto-detect or choose from 14 languages (English, Spanish, French, German, Italian, Portuguese, Dutch, Polish, Russian, Chinese, Japanese, Korean, Arabic, Hindi)
- **Timestamps** — include `[HH:MM:SS → HH:MM:SS]` segment markers in the output
- **Translate to English** — whisper transcribes audio in any language and outputs English text directly

### Post-transcription
- **Translate to English** — translates any completed transcript to English via Google Translate without re-transcribing

### Recent transcripts
Every finished transcript is saved on your Mac and listed under the drop zone when no file is open — click one to reopen it. Edits and translations are saved automatically. Hover a row and click **×** to remove it, or turn off **Keep recent transcripts** in Settings to stop saving and clear the list. The 25 most recent are kept.

### Export
From the **Export** menu in the title bar (⌘S): TXT · Markdown · DOCX (Word) · SRT (subtitles) · PDF

### Other
- The Transcribe button doubles as the progress bar, showing the phase (fetching, preparing, transcribing) and percentage
- **Cancel** stops a running transcription immediately (a model download in progress finishes and is cached)
- Progress also shows on the Dock icon, and if you've switched to another app you get a notification when the transcription finishes
- Model download progress shown on first use
- Once transcribed, the waveform folds away so the transcript fills the window
- Copy transcript to clipboard (⌘⇧C)
- Light/dark mode (follows system)
- **Update check** — on launch the app checks GitHub for a newer release and shows an **Update available** button in the title bar that opens the download page (turn it off in Settings)

## Requirements

To use the packaged app (DMG), just macOS 11+ on Apple Silicon — ffmpeg ships bundled, and yt-dlp is downloaded automatically on first YouTube use and kept up to date, so neither needs a separate install. (whisper-cli is compiled on the build machine, so Intel Macs would need their own from-source build.)

To build from source:
- macOS 11+
- Node.js 18+
- [cmake](https://cmake.org/) — `brew install cmake` (needed to compile whisper-cli)

## Development

```bash
# Install dependencies
npm install

# Start in development mode
npm start

# Checks
npm test          # unit tests (node:test)
npm run typecheck # TypeScript --checkJs over src/
npm run lint      # ESLint
```

## Build

```bash
npm run build
# Compiles whisper-cli then packages the app
# Output: dist/Transcriber-<version>-arm64.dmg  (Apple Silicon)
```

## Usage

1. Launch the app (`npm start` or install from DMG)
2. Choose an input — drop a file, record, capture system audio, or paste a URL
3. Optionally drag the waveform handles to trim to just the part you want, using the play/pause button to preview the selection
4. Pick a model and language next to the Transcribe button (Settings, ⌘,, holds timestamps and Whisper translation)
5. Click **Transcribe** or press ⌘↩ — press **Cancel** to stop
6. Edit the transcript if needed
7. Use **Translate to English** to translate, **Copy**, or save via **Export** (⌘S)

## Keyboard shortcuts

| Action | Shortcut |
|---|---|
| Open audio/video file | ⌘O |
| Transcribe | ⌘↩ |
| Export menu | ⌘S (↑/↓ to choose, Enter to save) |
| Copy transcript | ⌘⇧C |
| Close Export menu / Settings | Esc |
| Settings | ⌘, |
| Quit | ⌘Q |
