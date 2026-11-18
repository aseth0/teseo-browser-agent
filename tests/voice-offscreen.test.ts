import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DictationToChat } from '../src/voice/protocol';

// The floating chat's dictation in the offscreen document: one per port, from the extension's pages only;
// texts in order and the end back on the port; the microphone released when it stops, and when the port
// closes (the chat's frame gone), with its requests aborted.
type Listener<T> = (m: T) => void;
const connects: ((p: FakePort) => void)[] = [];
vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { id: 'ext', getURL: (p: string) => `chrome-extension://ext${p}`, onConnect: { addListener: (l: (p: FakePort) => void) => connects.push(l) } },
  },
}));
const recorders: { stop: () => void }[] = [];
vi.mock('../src/voice/recorder', () => ({
  chunkRecorder: () => {
    const r = { start: () => undefined, stop: () => r.onchunk(new Blob(['chunk'])), onchunk: (_b: Blob) => undefined };
    recorders.push(r);
    return r;
  },
  levelMeter: () => ({ peak: () => 0.5, level: () => 0.5, measured: () => true, close: () => undefined }),
}));
const sent: { prompt?: string; language?: string; signal?: AbortSignal; resolve: (t: string) => void; reject: (e: Error) => void }[] = [];
vi.mock('../src/voice/transcribe', async (original) => ({
  ...(await original<object>()),
  transcribe: (_p: unknown, _a: Blob, o: { prompt?: string; language?: string }, signal?: AbortSignal) =>
    new Promise<string>((resolve, reject) => sent.push({ prompt: o.prompt, language: o.language, signal, resolve, reject })),
}));
const { DICTATION_PORT } = await import('../src/voice/protocol');
const { listenDictation } = await import('../src/voice/offscreen');

class FakePort {
  received: DictationToChat[] = [];
  disconnected = false;
  private messages = new Set<Listener<unknown>>();
  private disconnects = new Set<() => void>();
  constructor(public name: string, public sender: { url?: string }) {}
  onMessage = { addListener: (l: Listener<unknown>) => this.messages.add(l) };
  onDisconnect = { addListener: (l: () => void) => this.disconnects.add(l) };
  postMessage(m: DictationToChat) {
    if (this.disconnected) throw new Error('Attempting to use a disconnected port object');
    this.received.push(m);
  }
  disconnect() {
    this.disconnected = true;
  }
  send(m: unknown) {
    for (const l of this.messages) l(m);
  }
  closeFromChat() {
    this.disconnected = true;
    for (const l of this.disconnects) l();
  }
}

let tracks: { stop: ReturnType<typeof vi.fn> }[] = [];
let asks: MediaStreamConstraints[] = [];
let giving: (c: MediaStreamConstraints) => Promise<MediaStream>;
const stream = () => {
  const t = { stop: vi.fn() };
  tracks.push(t);
  return { getTracks: () => [t] } as unknown as MediaStream;
};
listenDictation((c) => (asks.push(c), giving(c)));

const chat = { url: 'chrome-extension://ext/floating.html' };
const connect = (sender: { url?: string } = chat, name = DICTATION_PORT) => {
  const p = new FakePort(name, sender);
  for (const l of connects) l(p as never);
  return p;
};
const provider = { id: 'p', name: 'P', baseURL: 'https://api.example.test/v1', apiKey: 'k' };
const start = { type: 'start', provider, model: 'whisper-1', chunkMs: 1000, language: 'es', silenceLevel: 0.01 };
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  sent.length = 0;
  recorders.length = 0;
  tracks = [];
  asks = [];
  giving = async () => stream();
});

describe("the floating chat's dictation, recorded in the offscreen document", () => {
  it('records, sends each chunk with what was said before, and hands the texts back in order, then the end', async () => {
    const port = connect();
    // What it says of the dictation itself (the level and the chunks out: the next test).
    const said = () => port.received.filter((m) => m.type !== 'level' && m.type !== 'pending');
    port.send(start);
    await settle();
    expect(said()).toEqual([{ type: 'started' }]);
    expect(asks).toEqual([{ audio: true }]);
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);
    expect(sent).toHaveLength(2);
    expect(sent[0]!.language).toBe('es');
    sent[1]!.resolve('two'); // the second back first: held until the first is in
    sent[0]!.resolve('one');
    await settle();
    expect(said().slice(1)).toEqual([{ type: 'text', text: 'one two' }]);
    port.send({ type: 'stop' });
    expect(tracks[0]!.stop).toHaveBeenCalled(); // the microphone off at once
    expect(sent).toHaveLength(3); // the chunk recording then still goes
    expect(sent[2]!.prompt).toBe('one two');
    sent[2]!.resolve('three');
    await settle();
    expect(said().slice(2)).toEqual([{ type: 'stopping' }, { type: 'text', text: 'three' }, { type: 'end', end: { reason: 'stopped' } }]);
  });

  it('tells the chat the sound level five times a second while it records, and the chunks out', async () => {
    const port = connect();
    port.send(start);
    await settle();
    const levels = () => port.received.filter((m) => m.type === 'level');
    const pendings = () => port.received.filter((m) => m.type === 'pending').map((m) => (m as { count: number }).count);
    vi.advanceTimersByTime(600);
    expect(levels()).toEqual([{ type: 'level', level: 0.5 }, { type: 'level', level: 0.5 }, { type: 'level', level: 0.5 }]);
    vi.advanceTimersByTime(400); // a chunk out
    expect(pendings()).toEqual([1]);
    sent[0]!.resolve('one');
    await settle();
    expect(pendings()).toEqual([1, 0]);
    port.send({ type: 'stop' });
    const before = levels().length;
    vi.advanceTimersByTime(1000);
    expect(levels().length).toBe(before); // none once the microphone is off
  });

  it('tells the chat it is stopping when it stops by itself', async () => {
    const port = connect();
    port.send(start);
    await settle();
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);
    sent[0]!.reject(new Error('server down'));
    await settle();
    expect(port.received.filter((m) => m.type === 'stopping')).toEqual([{ type: 'stopping' }]);
  });

  it('no level once the chat went', async () => {
    const port = connect();
    port.send(start);
    await settle();
    port.closeFromChat();
    vi.advanceTimersByTime(1000);
    expect(port.received.filter((m) => m.type === 'level')).toEqual([]);
  });

  it('opens the microphone Settings → Voice chose', async () => {
    connect().send({ ...start, deviceId: 'mic-2' });
    await settle();
    expect(asks).toEqual([{ audio: { deviceId: { exact: 'mic-2' } } }]);
  });

  it("says why the microphone could not be had, with the error's name", async () => {
    giving = async () => {
      throw Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    };
    const port = connect();
    port.send(start);
    await settle();
    expect(port.received).toEqual([{ type: 'failed', name: 'NotAllowedError', error: 'Permission denied' }]);
  });

  it('dropped when the chat goes: the microphone off, its requests aborted, nothing posted', async () => {
    const port = connect();
    port.send(start);
    await settle();
    vi.advanceTimersByTime(1000);
    expect(sent).toHaveLength(1);
    port.closeFromChat();
    expect(tracks[0]!.stop).toHaveBeenCalled();
    expect(sent.every((s) => s.signal?.aborted)).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(recorders).toHaveLength(2); // no recorder after it
  });

  it('gone while the browser gave the microphone: released at once, never recorded', async () => {
    let give!: (s: MediaStream) => void;
    giving = () => new Promise((r) => (give = r));
    const port = connect();
    port.send(start);
    await settle();
    port.closeFromChat();
    give(stream());
    await settle();
    expect(tracks[0]!.stop).toHaveBeenCalled();
    expect(recorders).toHaveLength(0);
  });

  it('one dictation a port', async () => {
    const port = connect();
    port.send(start);
    port.send(start);
    await settle();
    expect(asks).toHaveLength(1);
    expect(port.received).toEqual([{ type: 'started' }]);
  });

  it("never a content script's port, nor another port's name", async () => {
    const page = connect({ url: 'https://example.com/' });
    expect(page.disconnected).toBe(true);
    page.send(start);
    const other = connect(chat, 'something-else');
    other.send(start);
    await settle();
    expect(asks).toEqual([]);
    expect(other.disconnected).toBe(false); // left to its own listener
  });
});
