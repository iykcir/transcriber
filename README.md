# Transcriber

A native-feeling macOS desktop app for offline audio and video transcription, powered by [whisper.cpp](https://github.com/ggerganov/whisper.cpp). No API key, no internet required — everything runs on-device.

## Features

### Input
| Method | Details |
|---|---|
| Drag & drop or browse | Drop a file onto the window or use File → Open |
| Record from microphone | Click **Record from microphone** to capture live audio |
| Capture system audio | Click **Capture system audio** to record whatever is playing on your Mac |
| URL | Paste a direct link to audio or video and click **Load**; YouTube links are supported natively |

### Supported formats
Audio: MP3, M4A, WAV, OGG, WebM, FLAC  
Video: MP4, MOV, MKV, AVI, M4V, WMV, 3GP, TS — audio is extracted automatically

### File size
No limit. Files of any size are accepted; ffmpeg converts them to the 16 kHz mono WAV format whisper requires before transcription.

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
- **Translate to English** — transcribes audio in any language and outputs English text

### Export
TXT · Markdown · DOCX (Word) · SRT (subtitles) · PDF

### Other
- Progress bar during model download and transcription
- Copy transcript to clipboard
- Light/dark mode (follows system)

## Requirements

- macOS 11+
- Node.js 18+
- [ffmpeg](https://ffmpeg.org/) — `brew install ffmpeg`
- [cmake](https://cmake.org/) — `brew install cmake` (needed to build whisper-cli)

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
3. Open **Settings** (⌘,) to choose a model, language, and other options
4. Click **Transcribe**
5. Edit the transcript if needed, then export or copy

## Keyboard shortcuts

| Action | Shortcut |
|---|---|
| Open audio/video file | ⌘O |
| Settings | ⌘, |
| Quit | ⌘Q |
