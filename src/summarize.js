// Transcript summaries via the Claude API. Runs in the main process only:
// the API key never reaches the renderer. The helpers at the top are pure so
// they can be unit-tested without a network.

const MODEL = 'claude-opus-5-5';
const MAX_TOPICS = 6;

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    overview: { type: 'string' },
    topics: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          startSec: { anyOf: [{ type: 'number' }, { type: 'null' }] },
        },
        required: ['title', 'startSec'],
        additionalProperties: false,
      },
    },
  },
  required: ['overview', 'topics'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = [
  'You summarize podcast and audio transcripts for a listener who is deciding whether to listen.',
  'Write an overview of at most 3 sentences saying what the recording is about and who is talking, if that is clear.',
  'Then list the 4 to 6 main topics in the order they come up, each as a short title of a few words.',
  'If the transcript has timestamp markers like [HH:MM:SS.mmm --> HH:MM:SS.mmm], set each topic\'s startSec to the',
  'number of seconds where that topic begins; otherwise set startSec to null.',
  'Write in the same language as the transcript. Do not invent details that are not in the transcript.',
].join(' ');

/**
 * @typedef {{title: string, startSec: number | null}} SummaryTopic
 * @typedef {{overview: string, topics: SummaryTopic[], createdAt: number}} Summary
 */

/** @param {string} transcript */
function buildSummaryRequest(transcript) {
  return {
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: SUMMARY_SCHEMA },
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: transcript }],
  };
}

/**
 * Validates the model's JSON and trims it to what the card shows.
 * @param {unknown} raw
 * @param {() => number} [now]
 * @returns {Summary}
 */
function normalizeSummary(raw, now = Date.now) {
  const obj = /** @type {any} */ (raw);
  const overview = typeof obj?.overview === 'string' ? obj.overview.trim() : '';
  if (!overview) throw new Error('Invalid summary');
  const topics = (Array.isArray(obj.topics) ? obj.topics : [])
    .filter((t) => typeof t?.title === 'string' && t.title.trim())
    .slice(0, MAX_TOPICS)
    .map((t) => ({
      title: t.title.trim(),
      startSec: typeof t.startSec === 'number' && Number.isFinite(t.startSec) && t.startSec >= 0
        ? t.startSec : null,
    }));
  return { overview, topics, createdAt: now() };
}

/** @param {number | null} sec */
function formatTopicTime(sec) {
  if (sec == null) return '';
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** @param {SummaryTopic} t @param {(time: string) => string} wrap */
function topicLine(t, wrap) {
  const time = formatTopicTime(t.startSec);
  return time ? `${wrap(time)} ${t.title}` : t.title;
}

/** @param {Summary} s */
function summaryToText(s) {
  const lines = s.topics.map((t) => `• ${topicLine(t, (x) => x)}`);
  return `Summary\n\n${s.overview}\n\n${lines.join('\n')}\n`;
}

/** @param {Summary} s */
function summaryToMarkdown(s) {
  const lines = s.topics.map((t) => `- ${topicLine(t, (x) => `**${x}**`)}`);
  return `## Summary\n\n${s.overview}\n\n${lines.join('\n')}\n`;
}

module.exports = {
  SUMMARY_SCHEMA, buildSummaryRequest, normalizeSummary,
  formatTopicTime, summaryToText, summaryToMarkdown,
};
