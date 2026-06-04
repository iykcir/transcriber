# Transcriber

A native-feeling macOS desktop app for offline audio and video transcription, powered by [whisper.cpp](https://github.com/ggerganov/whisper.cpp). No API key required — transcription runs entirely on-device.

## Features

### Input
| Method | Details |
|---|---|
| Drag & drop or browse | Drop a file onto the window or use File → Open |
| Record from microphone | Click **Record from microphone** to capture live audio |
| Capture system audio | Click **Capture system audio** to record whatever is playing on your Mac (meetings, podcasts, videos) |
| URL | Paste a direct link to audio or video and click **Load**; YouTube links are supported (install `yt-dlp` via Homebrew for best reliability) |

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
- **Translate to English** — whisper transcribes audio in any language and outputs English text directly

### Post-transcription
- **Translate to English** — translates any completed transcript to English via Google Translate without re-transcribing
- **Read Aloud** — reads the transcript aloud with play, pause, resume, and stop controls

### Read Aloud engines (configurable in Settings)
| Engine | Details |
|---|---|
| System Voice | Uses macOS built-in TTS. Install **Enhanced** or **Premium** voices in System Settings → Accessibility → Spoken Content for near-Siri quality |
| Microsoft Edge | Streams high-quality neural voices from Microsoft (322 voices, 40+ languages). No API key needed. Voice list filtered to the current language setting |

### Export
TXT · Markdown · DOCX (Word) · SRT (subtitles) · PDF

### Other
- Progress bar shows file name and phase (fetching, preparing, transcribing)
- Model download progress shown on first use
- Copy transcript to clipboard
- Light/dark mode (follows system)

## Requirements

- macOS 11+
- Node.js 18+
- [ffmpeg](https://ffmpeg.org/) — `brew install ffmpeg`
- [cmake](https://cmake.org/) — `brew install cmake` (needed to build whisper-cli)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) *(recommended for YouTube)* — `brew install yt-dlp`

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
3. Open **Settings** (⌘,) to choose a model, language, read aloud engine/voice, and other options
4. Click **Transcribe**
5. Edit the transcript if needed
6. Use **▶ Read Aloud** to listen, **Translate to English** to translate, or export via the toolbar

## Keyboard shortcuts

| Action | Shortcut |
|---|---|
| Open audio/video file | ⌘O |
| Settings | ⌘, |
| Quit | ⌘Q |
