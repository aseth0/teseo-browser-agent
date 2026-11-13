// One chunk of a dictation, or of a tab's audio, to the provider's POST /audio/transcriptions (the
// OpenAI-compatible one: Whisper, gpt-4o-transcribe, Groq…), as multipart with the provider's auth and
// extra headers. Its extraBody is JSON for chat requests, so it does not go. The word blacklist does not apply.
import { buildHeaders } from '../providers/headers';
import { assertOk } from '../providers/util';
import type { ProviderConfig } from '../storage/settings';
import type { AudioTranscriber } from '../audio/protocol';

// How much of what was already transcribed goes as `prompt`: the context Whisper-style models use
// for the words and casing at the cut.
const PROMPT_CHARS = 200;
export const promptTail = (text: string): string => text.slice(-PROMPT_CHARS);
// The prompt of a chunk: the user's vocabulary (voice/settings VOCABULARY_CHARS at most), then the tail
// of what was said. Whisper-style models keep the end of a prompt too long: the tail, by the cut, last.
export const joinPrompt = (vocabulary: string | undefined, tail: string): string => [vocabulary, tail].filter(Boolean).join(' ');

// A dictation chunk's options (voice/settings voiceTarget): the model, the language, the vocabulary and
// the tail of what was said as its prompt, the temperature. Nothing unset goes.
export function dictationOptions(t: { model: string; language?: string; vocabulary?: string; temperature?: number }, tail: string): TranscribeOptions {
  const prompt = joinPrompt(t.vocabulary, tail);
  return { model: t.model, ...(t.language && { language: t.language }), ...(prompt && { prompt }), ...(t.temperature !== undefined && { temperature: t.temperature }) };
}
// A tab's audio chunk's options (voice/settings tabAudioTarget): its own language, the vocabulary alone.
export const tabAudioOptions = (t: AudioTranscriber): TranscribeOptions => ({
  model: t.model,
  ...(t.language && { language: t.language }),
  ...(t.prompt && { prompt: t.prompt }),
  ...(t.temperature !== undefined && { temperature: t.temperature }),
});

export interface TranscribeOptions {
  model: string;
  language?: string;
  prompt?: string;
  temperature?: number; // none: not sent (the server's default)
  format?: 'verbose_json'; // its segments, with their times (none: the server's default, its text)
}

export function transcriptionRequest(p: ProviderConfig, audio: Blob, o: TranscribeOptions): { url: string; init: RequestInit } {
  const form = new FormData();
  form.append('file', audio, 'chunk.webm');
  form.append('model', o.model);
  if (o.language) form.append('language', o.language);
  if (o.prompt) form.append('prompt', o.prompt);
  if (o.temperature !== undefined && Number.isFinite(o.temperature)) form.append('temperature', String(o.temperature));
  if (o.format) form.append('response_format', o.format);
  // Without Content-Type: fetch sets the multipart one, with its boundary.
  const { 'Content-Type': _json, ...headers } = buildHeaders(p.apiKey, p.extraHeaders);
  return { url: `${p.baseURL.replace(/\/+$/, '')}/audio/transcriptions`, init: { method: 'POST', headers, body: form } };
}

// A request that never answers is given up after this: a part left sending would keep the transcript
// from ever being handed on.
const REQUEST_MS = 120_000;
const limited = (signal?: AbortSignal) => (signal ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_MS)]) : AbortSignal.timeout(REQUEST_MS));

// The chunk's text: the JSON reply's `text`, or the reply itself (response_format text).
export async function transcribe(p: ProviderConfig, audio: Blob, o: TranscribeOptions, signal?: AbortSignal): Promise<string> {
  const { url, init } = transcriptionRequest(p, audio, o);
  const res = await fetch(url, { ...init, signal: limited(signal) });
  await assertOk(res, 'audio/transcriptions');
  return replyOf(await res.text()).text;
}

// A stretch of a chunk's text and when it is said, in seconds from the chunk's start.
export interface TimedText {
  start: number;
  end: number;
  text: string;
}

// "baseURL|model" pairs whose server refused the segments: their chunks go once, for the text alone.
const NO_SEGMENTS = new Set<string>();

// The chunk's text with its segments (verbose_json: whisper-1, Groq…). A server that refuses that
// format (400, 422: gpt-4o-transcribe, many local ones) is asked again for the text alone, without
// them, and once that works is not asked for them again: each chunk would be uploaded twice. A 400 the
// plain request gets too was about something else (that chunk): the segments are asked for again.
export async function transcribeTimed(p: ProviderConfig, audio: Blob, o: TranscribeOptions, signal?: AbortSignal): Promise<{ text: string; segments?: TimedText[] }> {
  const onServer = `${p.baseURL}|${o.model}`;
  if (NO_SEGMENTS.has(onServer)) return { text: await transcribe(p, audio, o, signal) };
  const { url, init } = transcriptionRequest(p, audio, { ...o, format: 'verbose_json' });
  const res = await fetch(url, { ...init, signal: limited(signal) });
  if (res.status === 400 || res.status === 422) {
    const text = await transcribe(p, audio, o, signal);
    NO_SEGMENTS.add(onServer);
    return { text };
  }
  await assertOk(res, 'audio/transcriptions');
  return replyOf(await res.text());
}

const isTimed = (s: unknown): s is TimedText => {
  const t = s as Partial<TimedText> | null;
  return !!t && typeof t.start === 'number' && typeof t.end === 'number' && typeof t.text === 'string';
};
// The JSON reply's `text` and `segments`, or the reply itself (response_format text).
function replyOf(body: string): { text: string; segments?: TimedText[] } {
  try {
    const reply = JSON.parse(body) as { text?: unknown; segments?: unknown };
    const text = typeof reply.text === 'string' ? reply.text.trim() : '';
    const segments = Array.isArray(reply.segments) ? reply.segments.filter(isTimed).map((s) => ({ start: s.start, end: s.end, text: s.text.trim() })).filter((s) => s.text) : [];
    return segments.length ? { text, segments } : { text };
  } catch {
    return { text: body.trim() };
  }
}
