// What (if anything) to tell the user when a transcription ends. Only when
// they've switched away — if the window is focused they can already see it.

/**
 * @param {{outcome: 'done'|'failed'|'cancelled', name?: string, focused: boolean}} o
 * @returns {{title: string, body: string} | null}
 */
function jobNotice({ outcome, name, focused }) {
  if (focused || outcome === 'cancelled') return null;
  return {
    title: outcome === 'done' ? 'Transcription complete' : 'Transcription failed',
    body: name || 'Your transcript is ready.',
  };
}

module.exports = { jobNotice };
