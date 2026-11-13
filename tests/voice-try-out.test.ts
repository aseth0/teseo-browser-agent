import { describe, expect, it, vi } from 'vitest';
import type { AudioTranscriber } from '../src/audio/protocol';
import type { ChunkRecorder } from '../src/voice/session';
import type { VoiceTarget } from '../src/voice/settings';
import type { TranscribeOptions } from '../src/voice/transcribe';
import { tryOptions, tryTranscription, type TryDeps } from '../src/voice/try-out';

// Settings → Voice's Test: a few seconds recorded, sent as dictation's first chunk or a tab's audio
// chunk, its text or the server's refusal shown, with the loudest level heard; never stuck, the
// microphone always released.
const target = (over: Partial<VoiceTarget> = {}): VoiceTarget & { model: string } => ({ model: 'whisper-1', chunkSeconds: 3, silenceLevel: 0.01, silenceStopMs: 60_000, ...over });
const tab: AudioTranscriber = { provider: { id: 'p', name: 'P', baseURL: 'https://api.example.test/v1', apiKey: 'k', defaultModel: '' }, model: 'whisper-1', chunkSeconds: 30, language: 'en', prompt: 'Teseo', temperature: 0.2 };

function deps(over: Partial<TryDeps> = {}) {
  const stopTrack = vi.fn();
  const close = vi.fn();
  const sent: TranscribeOptions[] = [];
  const d: TryDeps = {
    open: async () => ({ getTracks: () => [{ stop: stopTrack }] }) as unknown as MediaStream,
    record: () => {
      const r: ChunkRecorder = { start: () => undefined, stop: () => r.onchunk(new Blob(['audio'])), onchunk: () => undefined };
      return r;
    },
    meter: () => ({ peak: () => 0.04, measured: () => true, close }),
    wait: async () => undefined,
    send: async (_a, o) => {
      sent.push(o);
      return 'hello';
    },
    ...over,
  };
  return { d, sent, stopTrack, close };
}
const go = () => new AbortController().signal;

describe("Settings → Voice's Test", () => {
  it("sends what dictation sends first, or what a tab's audio sends; nothing unset", () => {
    expect(tryOptions('dictation', target(), tab)).toEqual({ model: 'whisper-1' });
    expect(tryOptions('dictation', target({ language: 'es', vocabulary: 'Teseo', temperature: 0 }), tab)).toEqual({ model: 'whisper-1', language: 'es', prompt: 'Teseo', temperature: 0 });
    expect(tryOptions('tab', target({ language: 'es' }), tab)).toEqual({ model: 'whisper-1', language: 'en', prompt: 'Teseo', temperature: 0.2 });
  });
  it('gives the text and the loudest level, the microphone released', async () => {
    const h = deps();
    expect(await tryTranscription({ model: 'whisper-1', prompt: 'Teseo' }, h.d, go())).toEqual({ text: 'hello', peak: 0.04 });
    expect(h.sent).toEqual([{ model: 'whisper-1', prompt: 'Teseo' }]);
    expect(h.stopTrack).toHaveBeenCalled();
    expect(h.close).toHaveBeenCalled();
  });
  it('gives no level where it could not be measured, rather than 1', async () => {
    const h = deps({ meter: () => ({ peak: () => 1, measured: () => false, close: () => undefined }) });
    expect(await tryTranscription({ model: 'm' }, h.d, go())).toEqual({ text: 'hello', peak: undefined });
  });
  it("shows the server's refusal as it said it", async () => {
    const h = deps({ send: () => Promise.reject(new Error('audio/transcriptions 400: {"error":"temperature not supported"}')) });
    expect(await tryTranscription({ model: 'm' }, h.d, go())).toEqual({ error: 'audio/transcriptions 400: {"error":"temperature not supported"}', peak: 0.04 });
  });
  it('says the microphone is blocked, or missing', async () => {
    const blocked = deps({ open: () => Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' })) });
    expect(await tryTranscription({ model: 'm' }, blocked.d, go())).toEqual({ error: expect.stringContaining('blocked') });
    const none = deps({ open: () => Promise.reject(Object.assign(new Error('no'), { name: 'NotFoundError' })) });
    expect(await tryTranscription({ model: 'm' }, none.d, go())).toEqual({ error: 'No microphone was found.' });
  });
  it('fails, never stuck, when the recorder or the meter throws, the microphone released', async () => {
    const recorder = deps({ record: () => { throw new Error('no recorder'); } });
    expect(await tryTranscription({ model: 'm' }, recorder.d, go())).toEqual({ error: 'no recorder' });
    expect(recorder.stopTrack).toHaveBeenCalled();
    expect(recorder.close).toHaveBeenCalled();
    const meter = deps({ meter: () => { throw new Error('no audio context'); } });
    expect(await tryTranscription({ model: 'm' }, meter.d, go())).toEqual({ error: 'no audio context' });
    expect(meter.stopTrack).toHaveBeenCalled();
    expect(meter.sent).toEqual([]);
  });
  it('sends nothing once stopped (the page left), the microphone released', async () => {
    const stop = new AbortController();
    const h = deps({ wait: async () => void stop.abort() });
    expect(await tryTranscription({ model: 'm' }, h.d, stop.signal)).toEqual({ aborted: true });
    expect(h.sent).toEqual([]);
    expect(h.stopTrack).toHaveBeenCalled();
  });
  it('passes its signal to the request, and drops what comes back once stopped', async () => {
    const stop = new AbortController();
    let given: AbortSignal | undefined;
    const h = deps({
      send: (_a, _o, signal) => {
        given = signal;
        stop.abort();
        return Promise.reject(new Error('aborted'));
      },
    });
    expect(await tryTranscription({ model: 'm' }, h.d, stop.signal)).toEqual({ aborted: true });
    expect(given).toBe(stop.signal);
  });
});
