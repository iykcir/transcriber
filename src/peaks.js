// Waveform peaks computed while 16-bit PCM streams in from ffmpeg, so memory
// stays small no matter how long the file is (an hour at 8 kHz would
// otherwise mean buffering ~55 MB of samples, then copying it again).

/**
 * Keeps the peak of every `blockSize` samples as it goes; finish() then
 * merges those block peaks into the requested number of buckets.
 * @param {{sampleRate: number, blockSize?: number}} opts
 */
function createPeakAccumulator({ sampleRate, blockSize = 64 }) {
  /** @type {number[]} */
  const blockPeaks = [];
  let blockMax = 0;
  let inBlock = 0;
  let totalSamples = 0;
  /** @type {Buffer | null} an odd trailing byte carried into the next chunk */
  let carry = null;

  return {
    /** @param {Buffer} chunk */
    push(chunk) {
      let buf = carry ? Buffer.concat([carry, chunk]) : chunk;
      const count = Math.floor(buf.length / 2);
      carry = buf.length % 2 ? Buffer.from(buf.subarray(buf.length - 1)) : null;
      if (count === 0) return;
      // Int16Array views need an even byte offset; pooled Buffers may not have one.
      if (buf.byteOffset % 2) buf = Buffer.from(buf.subarray(0, count * 2));
      const samples = new Int16Array(buf.buffer, buf.byteOffset, count);
      for (let i = 0; i < count; i++) {
        const v = Math.abs(samples[i]);
        if (v > blockMax) blockMax = v;
        if (++inBlock === blockSize) {
          blockPeaks.push(blockMax);
          blockMax = 0;
          inBlock = 0;
        }
      }
      totalSamples += count;
    },

    /**
     * @param {number} bucketCount
     * @returns {{peaks: number[], duration: number}} peaks in 0..1
     */
    finish(bucketCount) {
      if (inBlock > 0) blockPeaks.push(blockMax);
      const buckets = Math.max(1, Math.min(bucketCount, totalSamples));
      const blocks = blockPeaks.length;
      const peaks = new Array(buckets).fill(0);
      for (let b = 0; b < buckets && blocks > 0; b++) {
        const start = Math.floor((b * blocks) / buckets);
        const end = Math.max(start + 1, Math.floor(((b + 1) * blocks) / buckets));
        let max = 0;
        for (let i = start; i < end; i++) if (blockPeaks[i] > max) max = blockPeaks[i];
        peaks[b] = max / 32768;
      }
      return { peaks, duration: totalSamples / sampleRate };
    },
  };
}

module.exports = { createPeakAccumulator };
