const { nodewhisper } = require('nodejs-whisper');

const MODELS = {
  tiny:   { label: 'Tiny (75 MB)',    name: 'tiny' },
  base:   { label: 'Base (142 MB)',   name: 'base' },
  small:  { label: 'Small (466 MB)',  name: 'small' },
  medium: { label: 'Medium (1.5 GB)', name: 'medium' },
};

async function transcribeAudio(filePath, language, includeTimestamps, model = 'base') {
  const modelName = MODELS[model] ? MODELS[model].name : 'base';

  let result;
  try {
    result = await nodewhisper(filePath, {
      modelName,
      autoDownloadModelName: modelName,
      removeWavFileAfterTranscription: true,
      withCuda: false,
      whisperOptions: {
        outputInText: true,
        language: (!language || language === 'auto') ? 'auto' : language,
        timestamps_length: 60,
        wordTimestamps: includeTimestamps,
        splitOnWord: true,
      },
    });
  } catch (err) {
    if (err.message?.includes('ffmpeg')) {
      throw new Error('ffmpeg is required for audio conversion. Install it with: brew install ffmpeg');
    }
    if (err.message?.includes('model')) {
      throw new Error(`Could not load model "${modelName}". Check your internet connection for the first download.`);
    }
    throw new Error(`Transcription failed: ${err.message || 'Unknown error'}`);
  }

  const text = typeof result === 'string' ? result : (result?.text ?? '');
  return text.trim();
}

module.exports = { transcribeAudio, MODELS };
