import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SILENCE_LEVEL, startSession, type ChunkRecorder, type SessionDeps, type SessionEnd } from '../src/voice/session';

// A dictation with fake recorders (each delivers its chunk when stopped), a fake level and a send the
// test answers by hand.
function harness(over: Partial<SessionDeps> = {}) {
  const recorders: ChunkRecorder[] = [];
  const sent: { audio: Blob; prompt: string; n: number; resolve: (t: string) => void; reject: (e: Error) => void }[] = [];
  const inserted: string[] = [];
  const ends: SessionEnd[] = [];
  let level = 0.5;
  let chunk = 0;
  const release = vi.fn();
  const deps: SessionDeps = {
    chunkMs: 1000,
    record: () => {
      const n = chunk++;
      const r: ChunkRecorder = { start: () => recorders.push(r), stop: () => r.onchunk(new Blob([`audio ${n}`])), onchunk: () => {} };
      return r;
    },
    peak: () => level,
    send: (audio, prompt, n) => new Promise((resolve, reject) => sent.push({ audio, prompt, n, resolve, reject })),
    insert: (t) => inserted.push(t),
    release,
    onEnd: (e) => ends.push(e),
    now: () => Date.now(),
    ...over,
  };
  const session = startSession(deps);
  return { session, recorders, sent, inserted, ends, release, setLevel: (v: number) => (level = v) };
}
const flush = () => new Promise<void>((r) => queueMicrotask(r)).then(() => undefined);
const settle = async () => {
  for (let i = 0; i < 5; i++) await flush();
};

beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] }));
afterEach(() => vi.useRealTimers());

describe('a dictation', () => {
  it('inserts the texts in recording order, with what came before as the prompt', async () => {
    const h = harness();
    vi.advanceTimersByTime(3000);
    expect(h.sent).toHaveLength(3);
    expect(h.recorders).toHaveLength(4); // the next one runs while the last is sent
    h.sent[2]!.resolve('three');
    await settle();
    expect(h.inserted).toEqual([]);
    h.sent[0]!.resolve('one');
    await settle();
    expect(h.inserted).toEqual(['one']);
    h.sent[1]!.resolve('two');
    await settle();
    expect(h.inserted).toEqual(['one', 'two three']); // ready together: one insertion
    vi.advanceTimersByTime(1000);
    expect(h.sent[3]!.prompt).toBe('one two three');
  });

  it('does not send a silent chunk', () => {
    const h = harness();
    h.setLevel(SILENCE_LEVEL / 2);
    vi.advanceTimersByTime(1000);
    expect(h.sent).toHaveLength(0);
    h.setLevel(0.5);
    vi.advanceTimersByTime(1000);
    expect(h.sent).toHaveLength(1);
  });

  it('takes the silence level it is given, 0 sending every chunk', () => {
    const h = harness({ silenceLevel: 0.05 });
    h.setLevel(0.03);
    vi.advanceTimersByTime(1000);
    expect(h.sent).toHaveLength(0);
    const all = harness({ silenceLevel: 0 });
    all.setLevel(0);
    vi.advanceTimersByTime(1000);
    expect(all.sent).toHaveLength(1);
  });

  it('stops after the silence it is given', async () => {
    const h = harness({ silenceStopMs: 10_000 });
    h.setLevel(0);
    vi.advanceTimersByTime(9_000);
    expect(h.ends).toEqual([]);
    vi.advanceTimersByTime(1000);
    await settle();
    expect(h.ends).toEqual([{ reason: 'silence' }]);
  });

  it('with level 0, sends every chunk yet still stops after silence under the default level', async () => {
    const h = harness({ silenceLevel: 0, silenceStopMs: 3_000 });
    h.setLevel(SILENCE_LEVEL / 2);
    vi.advanceTimersByTime(3_000);
    expect(h.sent).toHaveLength(4); // the third stops it, and the one recording ends and goes too
    h.sent.forEach((s) => s.resolve(''));
    await settle();
    expect(h.ends).toEqual([{ reason: 'silence' }]);
  });

  it('stops on its own after a minute of silence, the microphone released', async () => {
    const h = harness();
    h.setLevel(0);
    vi.advanceTimersByTime(59_000);
    expect(h.ends).toEqual([]);
    vi.advanceTimersByTime(1000);
    await settle();
    expect(h.ends).toEqual([{ reason: 'silence' }]);
    expect(h.release).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(h.recorders).toHaveLength(61); // no new recorder after the stop
  });

  it('a failed chunk stops it; the text already in stays, and one sent before still lands', async () => {
    const h = harness();
    vi.advanceTimersByTime(3000);
    h.sent[0]!.resolve('one');
    await settle();
    h.sent[2]!.reject(new Error('audio/transcriptions 401: bad key'));
    await settle();
    expect(h.release).toHaveBeenCalledTimes(1);
    expect(h.ends).toEqual([]); // the second is still out
    h.sent[1]!.resolve('two');
    await settle();
    expect(h.inserted).toEqual(['one', 'two']);
    expect(h.ends).toEqual([{ reason: 'error', error: 'audio/transcriptions 401: bad key' }]);
    expect(h.sent).toHaveLength(3); // the chunk recording when it failed is not sent
  });

  it('stop sends the current chunk and ends once its text is in', async () => {
    const h = harness();
    vi.advanceTimersByTime(1500);
    h.session.stop();
    expect(h.session.stopping).toBe(true);
    expect(h.release).toHaveBeenCalledTimes(1);
    expect(h.sent).toHaveLength(2);
    h.sent[0]!.resolve('one');
    await settle();
    expect(h.ends).toEqual([]);
    h.sent[1]!.resolve('two');
    await settle();
    expect(h.inserted).toEqual(['one', 'two']);
    expect(h.ends).toEqual([{ reason: 'stopped' }]);
    h.session.stop();
    expect(h.release).toHaveBeenCalledTimes(1);
    expect(h.ends).toHaveLength(1);
  });

  it('ends at once when stopped with nothing pending', async () => {
    const h = harness();
    h.setLevel(0);
    h.session.stop();
    await settle();
    expect(h.ends).toEqual([{ reason: 'stopped' }]);
  });
});

describe("a tab's audio", () => {
  it('goes on through silence when told to', async () => {
    const h = harness({ silenceStopMs: Infinity });
    h.setLevel(0);
    vi.advanceTimersByTime(120_000);
    await settle();
    expect(h.ends).toEqual([]);
    h.setLevel(0.5);
    vi.advanceTimersByTime(1000);
    expect(h.sent.map((s) => s.n)).toEqual([120]); // numbered as recorded: the silent ones count
  });

  it('says it is stopping as it stops, by itself too, before the chunks out are back', async () => {
    const onStopping = vi.fn();
    const h = harness({ onStopping });
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);
    h.sent[0]!.reject(new Error('server down')); // stops it by itself, the second chunk still out
    await settle();
    expect(onStopping).toHaveBeenCalledTimes(1);
    expect(h.ends).toEqual([]);
    h.session.stop(); // already stopping: not said again
    expect(onStopping).toHaveBeenCalledTimes(1);
  });

  it('a failed chunk is handed back and the rest goes on', async () => {
    const failed: [number, string][] = [];
    const h = harness({ onFailed: (n, _audio, error) => failed.push([n, error]) });
    vi.advanceTimersByTime(2000);
    h.sent[0]!.reject(new Error('audio/transcriptions 500: busy'));
    h.sent[1]!.resolve('two');
    await settle();
    expect(failed).toEqual([[0, 'audio/transcriptions 500: busy']]);
    expect(h.inserted).toEqual(['two']);
    expect(h.release).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(h.sent).toHaveLength(3);
    h.session.stop();
    h.sent[2]!.resolve('three');
    h.sent[3]!.resolve('');
    await settle();
    expect(h.ends).toEqual([{ reason: 'stopped' }]);
  });
});
