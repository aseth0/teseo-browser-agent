import { describe, expect, it, vi } from 'vitest';
import type { DictationToChat } from '../src/voice/protocol';

// The floating chat's side of its dictation: the offscreen document opened first, the start on a port,
// settled once the microphone is on (or with its error, its name kept for micProblem); texts and the
// end handed on; dropped, nothing more; the port closed under it, an end with an error.
vi.mock('wxt/browser', () => ({ browser: {} }));
const { offscreenDictation, OFFSCREEN_GONE } = await import('../src/voice/remote');
const { micProblem } = await import('../src/voice/mic');

function fakePort() {
  const messages = new Set<(m: DictationToChat) => void>();
  const disconnects = new Set<() => void>();
  const port = {
    posted: [] as unknown[],
    disconnected: false,
    onMessage: { addListener: (l: (m: DictationToChat) => void) => messages.add(l) },
    onDisconnect: { addListener: (l: () => void) => disconnects.add(l) },
    postMessage: (m: unknown) => port.posted.push(m),
    disconnect: () => void (port.disconnected = true),
    tell: (m: DictationToChat) => messages.forEach((l) => l(m)),
    closeFromOffscreen: () => disconnects.forEach((l) => l()),
  };
  return port;
}
const provider = { id: 'p', name: 'P', baseURL: 'https://api.example.test/v1', apiKey: 'k', defaultModel: 'm' };
const options = { provider, model: 'whisper-1', chunkMs: 3000, silenceLevel: 0.01 };
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
const open = (ready: () => Promise<Record<string, never> | { error: string } | undefined> = async () => ({})) => {
  const port = fakePort();
  const insert = vi.fn();
  const onEnd = vi.fn();
  const level = vi.fn();
  const pending = vi.fn();
  const stopping = vi.fn();
  const opened = offscreenDictation(options, { insert, onEnd, level, pending, stopping }, { ready, connect: () => port as never });
  return { port, insert, onEnd, level, pending, stopping, opened };
};

describe("the floating chat's dictation, from its side", () => {
  it('starts on the port, settles once started, and hands on the texts and the end', async () => {
    const { port, insert, onEnd, opened } = open();
    await settle();
    expect(port.posted).toEqual([{ type: 'start', ...options }]);
    port.tell({ type: 'started' });
    const remote = await opened;
    port.tell({ type: 'text', text: 'one' });
    expect(insert).toHaveBeenCalledWith('one');
    remote.stop();
    expect(port.posted.at(-1)).toEqual({ type: 'stop' });
    port.tell({ type: 'text', text: 'two' });
    port.tell({ type: 'end', end: { reason: 'stopped' } });
    expect(insert).toHaveBeenLastCalledWith('two');
    expect(onEnd).toHaveBeenCalledWith({ reason: 'stopped' });
    expect(port.disconnected).toBe(true);
  });

  it("rejects with the microphone's error, its name kept: blocked, as the side panel's", async () => {
    const { port, opened } = open();
    await settle();
    port.tell({ type: 'failed', name: 'NotAllowedError', error: 'Permission denied' });
    const e = await opened.catch((x: unknown) => x);
    expect(micProblem(e)).toBe('blocked');
    expect((e as Error).message).toBe('Permission denied');
    expect(port.disconnected).toBe(true);
  });

  it('rejects with why the offscreen document could not open, before any port', async () => {
    const connect = vi.fn();
    await expect(offscreenDictation(options, { insert: vi.fn(), onEnd: vi.fn() }, { ready: async () => ({ error: 'no offscreen' }), connect })).rejects.toThrow('no offscreen');
    await expect(offscreenDictation(options, { insert: vi.fn(), onEnd: vi.fn() }, { ready: async () => undefined, connect })).rejects.toThrow(OFFSCREEN_GONE);
    expect(connect).not.toHaveBeenCalled();
  });

  it('hands on the sound level, the chunks out and that it is stopping', async () => {
    const { port, level, pending, stopping, opened } = open();
    await settle();
    port.tell({ type: 'started' });
    await opened;
    port.tell({ type: 'level', level: 0.3 });
    port.tell({ type: 'pending', count: 2 });
    port.tell({ type: 'stopping' });
    expect(stopping).toHaveBeenCalledTimes(1);
    expect(level).toHaveBeenCalledWith(0.3);
    expect(pending).toHaveBeenCalledWith(2);
  });

  it('dropped: the port closed, nothing more comes, not even the end', async () => {
    const { port, insert, onEnd, level, pending, opened } = open();
    await settle();
    port.tell({ type: 'started' });
    (await opened).drop();
    expect(port.disconnected).toBe(true);
    port.tell({ type: 'text', text: 'late' });
    port.tell({ type: 'level', level: 0.3 });
    port.tell({ type: 'pending', count: 1 });
    port.tell({ type: 'end', end: { reason: 'stopped' } });
    expect(insert).not.toHaveBeenCalled();
    expect(level).not.toHaveBeenCalled();
    expect(pending).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('the offscreen document gone: ended with an error once started, rejected before', async () => {
    const a = open();
    await settle();
    a.port.tell({ type: 'started' });
    await a.opened;
    a.port.closeFromOffscreen();
    expect(a.onEnd).toHaveBeenCalledWith({ reason: 'error', error: OFFSCREEN_GONE });
    const b = open();
    await settle();
    b.port.closeFromOffscreen();
    await expect(b.opened).rejects.toThrow(OFFSCREEN_GONE);
  });
});
