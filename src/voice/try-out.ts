// Settings → Voice's Test: a few seconds from the chosen microphone, sent once with dictation's options
// (its model, language, vocabulary and temperature) or a tab's audio's (its own language, the vocabulary),
// the text it gave or the server's refusal as it said it, and the loudest level heard (to set the
// silence level by; none where it could not be measured). Never rejects; stopped by its signal (the
// page left), the microphone is released and nothing is sent.
import { errorText } from '../core/errors';
import { micProblem } from './mic';
import type { ChunkRecorder } from './session';
import type { VoiceTarget } from './settings';
import type { AudioTranscriber } from '../audio/protocol';
import { dictationOptions, tabAudioOptions, type TranscribeOptions } from './transcribe';

export const TRY_SECONDS = 5;

export type TryAs = 'dictation' | 'tab';
export type TryResult = { text: string; peak?: number } | { error: string; peak?: number } | { aborted: true };

export interface TryDeps {
  open: () => Promise<MediaStream>; // the microphone (voice/mic openMic)
  record: (stream: MediaStream) => ChunkRecorder;
  meter: (stream: MediaStream) => { peak: () => number; measured: () => boolean; close: () => void };
  wait: (ms: number, signal: AbortSignal) => Promise<void>; // resolves early once aborted
  send: (audio: Blob, o: TranscribeOptions, signal: AbortSignal) => Promise<string>;
}

const MIC_PROBLEM = {
  blocked: 'The microphone is blocked: allow it from the 🎤 button in the side panel, then test again.',
  'no-device': 'No microphone was found.',
};

// The options the test chunk goes with: those of dictation's first chunk, or of a tab's audio chunk.
export const tryOptions = (as: TryAs, dictation: VoiceTarget & { model: string }, tab: AudioTranscriber | undefined): TranscribeOptions =>
  as === 'tab' && tab ? tabAudioOptions(tab) : dictationOptions(dictation, '');

export async function tryTranscription(o: TranscribeOptions, d: TryDeps, signal: AbortSignal, seconds = TRY_SECONDS): Promise<TryResult> {
  let stream: MediaStream;
  try {
    stream = await d.open();
  } catch (e) {
    const problem = micProblem(e);
    return { error: problem ? MIC_PROBLEM[problem] : errorText(e) };
  }
  let audio: Blob;
  let peak: number | undefined;
  let meter: ReturnType<TryDeps['meter']> | undefined;
  try {
    if (signal.aborted) return { aborted: true };
    meter = d.meter(stream);
    const rec = d.record(stream);
    const done = new Promise<Blob>((resolve) => (rec.onchunk = resolve));
    rec.start();
    await d.wait(seconds * 1000, signal);
    rec.stop();
    audio = await done;
    const p = meter.peak();
    peak = meter.measured() ? p : undefined;
  } catch (e) {
    return { error: errorText(e) };
  } finally {
    meter?.close();
    stream.getTracks().forEach((track) => track.stop());
  }
  if (signal.aborted) return { aborted: true };
  if (!audio.size) return { error: 'Nothing was recorded.', peak };
  try {
    return { text: await d.send(audio, o, signal), peak };
  } catch (e) {
    return signal.aborted ? { aborted: true } : { error: errorText(e), peak };
  }
}
