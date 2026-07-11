# Transcriber

A native-feeling macOS desktop app for offline audio and video transcription, powered by [whisper.cpp](https://github.com/ggerganov/whisper.cpp). No API key required — transcription runs entirely on-device.

## Features

### Input
| Method | Details |
|---|---|
| Drag & drop or browse | Drop a file onto the window or use File → Open |
| Record from microphone | Click **Record from microphone** to capture live audio |
| Capture system audio | Click **Capture system audio** to record whatever is playing on your Mac (meetings, podcasts, videos) |
| URL | Paste a direct link to audio or video and click **Load**; YouTube links are supported out of the box (the app manages its own `yt-dlp` binary, kept up to date automatically) |

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
| Medium | 1.5 GB | Best quality |

### Transcription options
- **Language** — auto-detect or choose from 14 languages (English, Spanish, French, German, Italian, Portuguese, Dutch, Polish, Russian, Chinese, Japanese, Korean, Arabic, Hindi)
- **Timestamps** — include `[HH:MM:SS → HH:MM:SS]` segment markers in the output
- **Translate to English** — whisper transcribes audio in any language and outputs English text directly

### Post-transcription
- **Translate to English** — translates any completed transcript to English via Google Translate without re-transcribing

### Export
TXT · Markdown · DOCX (Word) · SRT (subtitles) · PDF

### Other
- Progress bar shows file name and phase (fetching, preparing, transcribing)
- Model download progress shown on first use
- Copy transcript to clipboard
- Light/dark mode (follows system)

## Requirements

To use the packaged app (DMG), just macOS 11+ — ffmpeg ships bundled, and yt-dlp is downloaded automatically on first YouTube use and kept up to date, so neither needs a separate install.

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
```

## Build

```bash
npm run build
# Compiles whisper-cli then packages the app
# Output: dist/Transcriber-<version>-arm64.dmg  (Apple Silicon)
#         dist/Transcriber-<version>.dmg          (Intel)
```

## Usage

1. Launch the app (`npm start` or install from DMG)
2. Choose an input — drop a file, record, capture system audio, or paste a URL
3. Optionally drag the waveform handles to trim to just the part you want, using the play/pause button to preview the selection
4. Open **Settings** (⌘,) to choose a model, language, and other options
5. Click **Transcribe**
6. Edit the transcript if needed
7. Use **Translate to English** to translate, or export via the toolbar

## Keyboard shortcuts

| Action | Shortcut |
|---|---|
| Open audio/video file | ⌘O |
| Settings | ⌘, |
| Quit | ⌘Q |
