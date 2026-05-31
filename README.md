# Transcriber

A native-feeling macOS desktop application that accepts audio files as input and outputs clean, readable transcription documents powered by OpenAI Whisper.

## Features

- Drag-and-drop or browse for audio files (MP3, MP4, M4A, WAV, OGG, WebM, FLAC)
- Transcription via OpenAI Whisper API (whisper-1 model)
- Optional timestamps in output
- Export to PDF (paginated, serif font) or plain TXT
- Copy transcript to clipboard
- API key stored securely in macOS Keychain
- Light/dark mode support

## Requirements

- macOS 11+
- Node.js 18+
- An [OpenAI API key](https://platform.openai.com/api-keys)

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Start in development mode
npm start

# 3. Add your OpenAI API key via Settings (⌘,) or the gear icon
```

## Build a distributable DMG

```bash
npm run build
# Output: ./dist/Transcriber-*.dmg
```

## Generate app icon (optional, requires `canvas` package)

```bash
npm install canvas
node generate-icon.js
```

## Usage

1. Launch the app with `npm start`
2. Open **Settings** (⌘, or gear icon) and paste your OpenAI API key
3. Drag an audio file onto the drop zone, or click **File > Open Audio**
4. Click **Transcribe** and wait for the result
5. Edit the transcript if needed, then export via **Save as PDF**, **Save as TXT**, or **Copy**

## File size limits

The OpenAI Whisper API accepts files up to **25 MB**. For larger files, compress the audio first (e.g., `ffmpeg -i input.wav -b:a 64k output.mp3`).

## Keyboard shortcuts

| Action | Shortcut |
|---|---|
| Open audio file | ⌘O |
| Settings | ⌘, |
| Quit | ⌘Q |
