import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimedText } from '../src/voice/transcribe';

// The offscreen document's tab audio: transcribed while it captures, a chunk every 30 seconds, through
// silence; a failed chunk kept to be sent again; an edit kept; and once discarded, what an earlier
// capture's chunks bring back is dropped.
const listeners: ((m: unknown, s: unknown, r: (x: unknown) => void) => boolean | void)[] = [];
const broadcast = vi.fn(async (_m: unknown) => undefined);
vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { id: 'ext', getURL: (p: string) => `chrome-extension://ext${p}`, sendMessage: (m: unknown) => broadcast(m), onMessage: { addListener: (l: never) => listeners.push(l) } },
  },
}));
const captured = () => ({ startedAt: 1000, stream: {}, stop: vi.fn(async () => new Blob(['whole'])) });
let capturing = async () => captured();
vi.mock('../src/audio/tab-capture', () => ({
  captureTabAudio: () => capturing(),
}));
let level = 0.5;
vi.mock('../src/voice/recorder', () => ({
  chunkRecorder: () => {
    const r = { start: () => undefined, stop: () => r.onchunk(new Blob(['chunk'])), onchunk: (_b: Blob) => undefined };
    return r;
  },
  levelMeter: () => ({ peak: () => level, level: () => level, close: () => undefined }),
}));
const sent: { prompt?: string; language?: string; temperature?: number; resolve: (r: { text: string; segments?: TimedText[] }) => void; reject: (e: Error) => void }[] = [];
vi.mock('../src/voice/transcribe', async (original) => ({
  ...(await original<object>()),
  transcribeTimed: (_p: unknown, _a: Blob, o: { prompt?: string; language?: string; temperature?: number }) =>
    new Promise((resolve, reject) => sent.push({ prompt: o.prompt, language: o.language, temperature: o.temperature, resolve, reject })),
}));
globalThis.URL.createObjectURL = () => 'blob:chrome-extension://ext/1';
globalThis.URL.revokeObjectURL = () => undefined;
const A = await import('../src/audio/protocol');
const { FAILED_KEPT, listenTabAudio } = await import('../src/audio/offscreen');
listenTabAudio();

const page = { id: 'ext', url: 'chrome-extension://ext/background.js' };
async function ask(msg: { type: string; [k: string]: unknown }, sender: unknown = page): Promise<unknown> {
  let reply: unknown;
  for (const l of listeners) {
    const answered = new Promise((r) => {
      const async = l(msg, sender, r);
      if (async !== true) r(undefined);
    });
    const r = await answered;
    if (r !== undefined) reply = r;
  }
  return reply;
}
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
const transcriber = { provider: { id: 'p', name: 'P', baseURL: 'https://api.example.test/v1', apiKey: 'k' }, model: 'whisper-1', chunkSeconds: 30 };
const transcript = async () => ((await ask({ type: A.AUDIO_TRANSCRIPT })) as { transcript: import('../src/audio/transcript').Transcript }).transcript;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
  sent.length = 0;
  level = 0.5;
  broadcast.mockClear();
});
afterEach(async () => {
  await ask({ type: A.AUDIO_DROP });
  vi.useRealTimers();
});

describe("the offscreen document's tab audio", () => {
  it('transcribes it as it goes, its lines timed, each chunk alone: the text before can make a model give none', async () => {
    expect(await ask({ type: A.AUDIO_CAPTURE, streamId: 's', name: 'a.webm', maxMs: 3_600_000, transcribe: transcriber })).toEqual({ startedAt: 1000 });
    vi.advanceTimersByTime(30_000);
    expect(sent).toHaveLength(1);
    sent[0]!.resolve({ text: 'one two', segments: [{ start: 0, end: 4, text: 'one' }, { start: 4, end: 9, text: 'two' }] });
    await settle();
    vi.advanceTimersByTime(30_000);
    expect(sent[1]!.prompt).toBeUndefined();
    sent[1]!.resolve({ text: 'three' });
    await settle();
    const t = await transcript();
    expect(t.parts).toEqual([
      { n: 0, state: 'done', lines: [{ at: 0, text: 'one' }, { at: 4, text: 'two' }] },
      { n: 1, state: 'done', lines: [{ at: 30, text: 'three' }] },
    ]);
    expect(broadcast).toHaveBeenLastCalledWith({ type: A.AUDIO_CHANGED, progress: { sending: 0, failed: 0, done: false } });
  });

  it('sends each chunk with the language, vocabulary and temperature chosen, skipping under its silence level', async () => {
    await ask({ type: A.AUDIO_CAPTURE, streamId: 's', name: 'a.webm', maxMs: 3_600_000, transcribe: { ...transcriber, language: 'en', prompt: 'Teseo', temperature: 0.2, silenceLevel: 0.6 } });
    vi.advanceTimersByTime(30_000);
    expect(sent).toHaveLength(0); // 0.5 is under 0.6
    level = 0.7;
    vi.advanceTimersByTime(30_000);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ prompt: 'Teseo', language: 'en', temperature: 0.2 });
    sent[0]!.resolve({ text: 'x' });
    await settle();
  });

  it('goes on through silence, and once stopped is done when the last chunk is back', async () => {
    await ask({ type: A.AUDIO_CAPTURE, streamId: 's', name: 'a.webm', maxMs: 3_600_000, transcribe: transcriber });
    level = 0;
    vi.advanceTimersByTime(120_000);
    await settle();
    expect(sent).toHaveLength(0);
    level = 0.5;
    expect(await ask({ type: A.AUDIO_END })).toEqual({ size: 5 });
    sent[0]!.resolve({ text: 'late' });
    await settle();
    const t = await transcript();
    expect(t.parts).toEqual([{ n: 4, state: 'done', lines: [{ at: 120, text: 'late' }] }]);
    expect(t.done).toBe(true);
    expect(await ask({ type: A.AUDIO_FILE })).toEqual({ url: 'blob:chrome-extension://ext/1', name: 'a.webm' });
  });

  it('a failed chunk stays out and is sent again on Retry', async () => {
    await ask({ type: A.AUDIO_CAPTURE, streamId: 's', name: 'a.webm', maxMs: 3_600_000, transcribe: transcriber });
    vi.advanceTimersByTime(60_000);
    sent[0]!.resolve({ text: 'first' });
    sent[1]!.reject(new Error('audio/transcriptions 500: busy'));
    await settle();
    expect((await transcript()).parts[1]).toEqual({ n: 1, state: 'failed', error: 'audio/transcriptions 500: busy' });
    expect(broadcast).toHaveBeenLastCalledWith({ type: A.AUDIO_CHANGED, progress: { sending: 0, failed: 1, done: false } });
    await ask({ type: A.AUDIO_RETRY, n: 1 });
    sent[2]!.resolve({ text: 'second' });
    await settle();
    expect((await transcript()).parts[1]).toEqual({ n: 1, state: 'done', lines: [{ at: 30, text: 'second' }] });
  });

  it('keeps the audio of the last failed chunks only: an older one cannot be sent again, and says so', async () => {
    await ask({ type: A.AUDIO_CAPTURE, streamId: 's', name: 'a.webm', maxMs: 3_600_000, transcribe: transcriber });
    const many = FAILED_KEPT + 1;
    vi.advanceTimersByTime(30_000 * many);
    for (let n = 0; n < many; n++) sent[n]!.reject(new Error('busy'));
    await settle();
    expect(broadcast).toHaveBeenLastCalledWith({ type: A.AUDIO_CHANGED, progress: { sending: 0, failed: many, done: false } });
    await ask({ type: A.AUDIO_RETRY, n: 0 });
    expect(sent).toHaveLength(many);
    expect((await transcript()).parts[0]).toEqual({ n: 0, state: 'failed', error: `Its audio is not kept any more: only the last ${FAILED_KEPT} failed chunks are.` });
    await ask({ type: A.AUDIO_RETRY, n: 1 });
    expect(sent).toHaveLength(many + 1);
  });

  it('a chunk with sound that comes back without text fails, and does not vanish', async () => {
    await ask({ type: A.AUDIO_CAPTURE, streamId: 's', name: 'a.webm', maxMs: 3_600_000, transcribe: transcriber });
    vi.advanceTimersByTime(60_000);
    sent[0]!.resolve({ text: 'first' });
    sent[1]!.resolve({ text: '' });
    await settle();
    expect((await transcript()).parts[1]).toEqual({ n: 1, state: 'failed', error: 'the model gave no text, though there is sound' });
    expect(broadcast).toHaveBeenLastCalledWith({ type: A.AUDIO_CHANGED, progress: { sending: 0, failed: 1, done: false } });
    await ask({ type: A.AUDIO_RETRY, n: 1 });
    sent[2]!.resolve({ text: 'second' });
    await settle();
    expect((await transcript()).parts[1]).toEqual({ n: 1, state: 'done', lines: [{ at: 30, text: 'second' }] });
  });

  it('keeps an edit; the time up ends it as the tab closing would', async () => {
    await ask({ type: A.AUDIO_CAPTURE, streamId: 's', name: 'a.webm', maxMs: 45_000, transcribe: transcriber });
    await ask({ type: A.AUDIO_EDIT, key: '0:0', text: 'Fixed.' });
    expect((await transcript()).edits).toEqual({ '0:0': 'Fixed.' });
    vi.advanceTimersByTime(45_000);
    expect(broadcast).toHaveBeenCalledWith({ type: A.AUDIO_ENDED });
  });

  it('discarded: what an earlier capture brings back is dropped', async () => {
    await ask({ type: A.AUDIO_CAPTURE, streamId: 's', name: 'a.webm', maxMs: 3_600_000, transcribe: transcriber });
    vi.advanceTimersByTime(30_000);
    await ask({ type: A.AUDIO_DROP });
    sent[0]!.resolve({ text: 'stale' });
    await settle();
    expect(await ask({ type: A.AUDIO_TRANSCRIPT })).toEqual({ error: 'The audio is not kept any more.' });
  });

  it('discarded while the tab\'s stream is still asked for: the stream that comes is stopped', async () => {
    let give!: (audio: ReturnType<typeof captured>) => void;
    capturing = () => new Promise((resolve) => (give = resolve));
    try {
      const started = ask({ type: A.AUDIO_CAPTURE, streamId: 's', name: 'a.webm', maxMs: 3_600_000 });
      await ask({ type: A.AUDIO_DROP });
      const audio = captured();
      give(audio);
      expect(await started).toEqual({ error: 'The capture was discarded.' });
      expect(audio.stop).toHaveBeenCalled();
    } finally {
      capturing = async () => captured();
    }
  });

  it('the chunk length chosen: when they go, and their lines\' times', async () => {
    await ask({ type: A.AUDIO_CAPTURE, streamId: 's', name: 'a.webm', maxMs: 3_600_000, transcribe: { ...transcriber, chunkSeconds: 15 } });
    vi.advanceTimersByTime(30_000);
    expect(sent).toHaveLength(2);
    sent[0]!.resolve({ text: 'a' });
    sent[1]!.resolve({ text: 'b' });
    await settle();
    expect((await transcript()).parts[1]).toEqual({ n: 1, state: 'done', lines: [{ at: 15, text: 'b' }] });
  });

  it('with waves, says the sound level as it goes, until it stops; without them, never', async () => {
    const levels = () => broadcast.mock.calls.filter(([m]) => (m as { type: string }).type === A.AUDIO_LEVEL);
    await ask({ type: A.AUDIO_CAPTURE, streamId: 's', name: 'a.webm', maxMs: 3_600_000, transcribe: transcriber });
    vi.advanceTimersByTime(1000);
    expect(levels()).toHaveLength(0);
    await ask({ type: A.AUDIO_DROP });
    await ask({ type: A.AUDIO_CAPTURE, streamId: 's', name: 'a.webm', maxMs: 3_600_000, waves: true });
    vi.advanceTimersByTime(1000);
    expect(levels()).toHaveLength(5);
    expect(levels()[0]![0]).toEqual({ type: A.AUDIO_LEVEL, level: 0.5 });
    await ask({ type: A.AUDIO_END });
    vi.advanceTimersByTime(1000);
    expect(levels()).toHaveLength(5);
  });

  it('audio only: nothing is sent, and there is no transcript', async () => {
    await ask({ type: A.AUDIO_CAPTURE, streamId: 's', name: 'a.webm', maxMs: 3_600_000 });
    vi.advanceTimersByTime(60_000);
    expect(sent).toHaveLength(0);
    expect(await ask({ type: A.AUDIO_TRANSCRIPT })).toEqual({ error: 'This audio is not transcribed.' });
  });

  it("answers no page's content script", async () => {
    expect(await ask({ type: A.AUDIO_FILE }, { id: 'ext', url: 'https://video.example.test/', tab: { id: 1 } })).toBeUndefined();
  });
});
