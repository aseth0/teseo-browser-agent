// Settings → Voice as dictation uses it: the provider and model that transcribe, the language, the
// chunk length in seconds, by half seconds, the user's vocabulary, the temperature and silence.
import type { ProviderConfig, Settings } from '../storage/settings';
import type { TabAudioView } from '../storage/settings-types';
import type { AudioTranscriber } from '../audio/protocol';

// The loudest level (RMS, 0..1) a chunk must reach to be sent (voice/session), unless Settings → Voice sets another.
export const SILENCE_LEVEL = 0.01;

export const CHUNK_SECONDS = { default: 3, min: 0.5, max: 30, step: 0.5 };

export const clampChunk = (v: number | undefined): number =>
  v === undefined || !Number.isFinite(v) ? CHUNK_SECONDS.default : Math.min(CHUNK_SECONDS.max, Math.max(CHUNK_SECONDS.min, Math.round(v / CHUNK_SECONDS.step) * CHUNK_SECONDS.step));

export interface VoiceTarget {
  provider?: ProviderConfig; // none: no model chosen (or its provider was removed)
  model?: string;
  language?: string;
  deviceId?: string; // the microphone; none: the browser's default
  chunkSeconds: number;
  vocabulary?: string;
  temperature?: number;
  silenceLevel: number;
  silenceStopMs: number; // Infinity: never
}

// The user's words for the model: at most this many characters, so that with dictation's tail
// (transcribe PROMPT_CHARS) the prompt usually stays within what Whisper-style models read (224 tokens,
// the last ones kept: the vocabulary goes first, the tail last, by the cut). Lists of names and acronyms,
// or text in other languages than English, take more tokens a character: past it, the vocabulary's start
// is what the model drops. Not a string (a hand-edited import): none.
export const VOCABULARY_CHARS = 300;
export const vocabularyOf = (v: unknown): string | undefined => (typeof v === 'string' ? v.trim().slice(0, VOCABULARY_CHARS).trim() || undefined : undefined);

// A language as the servers take it (ISO-639-1, or the 3-letter ISO-639-3): anything else is not sent.
export const LANGUAGE_CODE = /^[a-z]{2,3}$/i;
export const languageOf = (v: unknown): string | undefined => (typeof v === 'string' && LANGUAGE_CODE.test(v.trim()) ? v.trim() : undefined);

// `temperature`: none is not sent (the server's default).
export const TEMPERATURE = { min: 0, max: 1, step: 0.1 };
export const clampTemperature = (v: number | undefined): number | undefined =>
  v === undefined || !Number.isFinite(v) ? undefined : Math.min(TEMPERATURE.max, Math.max(TEMPERATURE.min, Math.round(v * 100) / 100));

// The loudest level (RMS, 0..1) a chunk must reach to be sent (voice/session SILENCE_LEVEL); 0: every chunk.
export const SILENCE_LEVELS = { default: SILENCE_LEVEL, min: 0, max: 0.1, step: 0.001 };
export const clampSilenceLevel = (v: number | undefined): number =>
  v === undefined || !Number.isFinite(v) ? SILENCE_LEVELS.default : Math.min(SILENCE_LEVELS.max, Math.max(SILENCE_LEVELS.min, Math.round(v * 1000) / 1000));

// The seconds without sound that stop a dictation; 0: never.
export const SILENCE_STOP_SECONDS = { default: 60, min: 10, max: 600, step: 1 };
export const clampSilenceStop = (v: number | undefined): number =>
  v === undefined || !Number.isFinite(v) ? SILENCE_STOP_SECONDS.default : v <= 0 ? 0 : Math.min(SILENCE_STOP_SECONDS.max, Math.max(SILENCE_STOP_SECONDS.min, Math.round(v)));
export const silenceStopMs = (seconds: number): number => (seconds ? seconds * 1000 : Infinity);
// How long that is, for the note a dictation stopped by it leaves: "a minute", "2 minutes", "90 seconds".
export function silenceText(ms: number): string {
  if (ms === 60_000) return 'a minute';
  return ms % 60_000 ? `${Math.round(ms / 1000)} seconds` : `${ms / 60_000} minutes`;
}

// A tab's audio has a chunk length of its own: longer, each chunk with no context but itself.
export const TAB_CHUNK_SECONDS = { default: 30, min: 5, max: 30, step: 5 };
export const clampTabChunk = (v: number | undefined): number =>
  v === undefined || !Number.isFinite(v) ? TAB_CHUNK_SECONDS.default : Math.min(TAB_CHUNK_SECONDS.max, Math.max(TAB_CHUNK_SECONDS.min, Math.round(v / TAB_CHUNK_SECONDS.step) * TAB_CHUNK_SECONDS.step));

// What transcribes a tab's audio: the same model, not with dictation's language (a page may speak any
// other, and a model forced to the wrong one gives no words: "[Música]") but its own, none by default;
// the vocabulary alone as its prompt (each chunk alone: the text before it can make a model give none).
export function tabAudioTarget(s: Settings): AudioTranscriber | undefined {
  const { provider, model, vocabulary, temperature, silenceLevel } = voiceTarget(s);
  if (!provider || !model) return undefined;
  const language = languageOf(s.voice?.tabLanguage);
  return {
    provider,
    model,
    chunkSeconds: clampTabChunk(s.voice?.tabChunkSeconds),
    ...(language && { language }),
    ...(vocabulary && { prompt: vocabulary }),
    ...(temperature !== undefined && { temperature }),
    ...(silenceLevel !== SILENCE_LEVEL && { silenceLevel }),
  };
}
// What the pill on the captured page shows.
export const tabAudioView = (s: Settings): TabAudioView => {
  const v = s.voice?.tabAudioView;
  return v === 'transcript' || v === 'waves' ? v : 'pill';
};

export function voiceTarget(s: Settings): VoiceTarget {
  const v = s.voice ?? {};
  const provider = s.providers.find((p) => p.id === v.providerId);
  return {
    provider,
    model: v.model?.trim() || undefined,
    language: v.language?.trim() || undefined,
    deviceId: v.deviceId || undefined,
    chunkSeconds: clampChunk(v.chunkSeconds),
    vocabulary: vocabularyOf(v.vocabulary),
    temperature: clampTemperature(v.temperature),
    silenceLevel: clampSilenceLevel(v.silenceLevel),
    silenceStopMs: silenceStopMs(clampSilenceStop(v.silenceStopSeconds)),
  };
}
