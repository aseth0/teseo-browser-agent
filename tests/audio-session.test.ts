import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeStorage } from './fakes/browser';

// The background's one capture of a tab's audio: started, stopped, transcribed as it goes, handed to a
// chat or opened for review, discarded; and what a worker that woke takes up.
const storage = fakeStorage();
vi.mock('wxt/browser', () => ({ browser: { storage } }));
let held: 'capturing' | 'stopped' | 'none' = 'none';
let open = true;
vi.mock('../src/audio/offscreen-document', () => ({ offscreenOpen: async () => open, offscreenReady: async () => undefined }));
const transcript = { lines: [] };
const sendRuntime = vi.fn(async (m: { type: string }): Promise<unknown> => {
  if (m.type === A.AUDIO_CAPTURE) return { startedAt: 1000 };
  if (m.type === A.AUDIO_END) return { size: 2048 };
  if (m.type === A.AUDIO_HELD) return { held };
  if (m.type === A.AUDIO_TRANSCRIPT) return { transcript };
  return undefined;
});
vi.mock('../src/core/runtime', () => ({ sendRuntime: (m: { type: string }) => sendRuntime(m) }));
vi.mock('../src/audio/transcript', async (actual) => ({ ...(await actual<typeof import('../src/audio/transcript')>()), attachLines: () => [{ at: 0, text: 'hello' }] }));

const A = await import('../src/audio/protocol');
const { CHAT_ATTACH } = await import('../src/capture/protocol');
const { createAudioSession } = await import('../src/audio/session');

const awake = vi.fn();
const onChange = vi.fn();
const route = vi.fn((_tabId: number) => ({ panelTab: 7 }));
const openReview = vi.fn(async () => undefined);
const make = () => createAudioSession({ awake, route, onChange, openReview });
const transcribe = { provider: { id: 'p', name: 'P', baseURL: 'https://api.example.test/v1', apiKey: 'k', defaultModel: 'm' }, model: 'whisper-1', chunkSeconds: 30 };
const opts = { tabId: 7, windowId: 2, site: 'talks.example.test', streamId: 's1', to: 'review' as const, view: 'pill' as const, transcribe, maxMs: 60_000 };
const session = () => storage.session.data;
const sent = (type: string) => sendRuntime.mock.calls.filter(([m]) => m.type === type);

beforeEach(() => {
  storage.reset();
  vi.clearAllMocks();
  held = 'none';
  open = true;
});

describe('the audio session', () => {
  it('starts in the offscreen document, keeps the worker awake, and publishes its status', async () => {
    const s = make();
    expect(await s.start(opts)).toBe('started');
    expect(sent(A.AUDIO_CAPTURE)[0]![0]).toMatchObject({ streamId: 's1', maxMs: 60_000, transcribe, waves: false });
    expect(awake).toHaveBeenLastCalledWith(true);
    expect(s.status()).toMatchObject({ state: 'capturing', tabId: 7, site: 'talks.example.test', startedAt: 1000, to: 'review', progress: { sending: 0, failed: 0, done: false } });
    expect(session()[A.AUDIO_STATUS]).toEqual(s.status());
    expect(onChange).toHaveBeenLastCalledWith(s.status());
  });
  it('one at a time; one kept is saved or discarded first', async () => {
    const s = make();
    await s.start(opts);
    expect(s.whyNotStart()).toBe("A tab's audio is being captured already: stop it first.");
    expect(await s.start(opts)).toEqual({ error: "A tab's audio is being captured already: stop it first." });
    await s.stop();
    expect(s.whyNotStart()).toBe('Save or discard the audio kept first.');
    await s.discard();
    expect(s.whyNotStart()).toBeUndefined();
  });
  it('the offscreen document refusing it: nothing kept, the reason said', async () => {
    sendRuntime.mockImplementationOnce(async () => ({ error: 'no stream' }));
    const s = make();
    expect(await s.start(opts)).toEqual({ error: 'no stream' });
    expect(s.status()).toBeUndefined();
    expect(awake).not.toHaveBeenCalledWith(true);
  });
  it('stopped: kept with its size, the worker let sleep, and the review page opened when it goes there', async () => {
    const s = make();
    await s.start(opts);
    await s.stop();
    expect(sent(A.AUDIO_END)).toHaveLength(1);
    expect(s.status()).toMatchObject({ state: 'stopped', size: 2048 });
    expect(s.status()!.endedAt).toBeGreaterThan(0);
    expect(awake).toHaveBeenLastCalledWith(false);
    expect(openReview).toHaveBeenCalledTimes(1);
    await s.stop(); // already stopped: nothing more
    expect(sent(A.AUDIO_END)).toHaveLength(1);
  });
  it('going to the chat: the chat opened inside the gesture is told, and gets the transcript once every chunk is back', async () => {
    const s = make();
    await s.start({ ...opts, to: 'chat' });
    const openChat = vi.fn(() => ({ tab: 7 }));
    await s.stop(openChat);
    expect(openChat).toHaveBeenCalledWith({ id: 7, windowId: 2 });
    expect(session()[CHAT_ATTACH]).toMatchObject({ payload: { kind: 'images', images: [], note: "The tab's audio is being transcribed…" }, tab: 7 });
    expect(openReview).not.toHaveBeenCalled();
    await s.progressed({ sending: 1, failed: 0, done: false });
    expect(s.status()!.sent).toBeUndefined();
    await s.progressed({ sending: 0, failed: 0, done: true });
    expect(route).toHaveBeenCalledWith(7);
    expect(session()[CHAT_ATTACH]).toMatchObject({ payload: { kind: 'audio', site: 'talks.example.test', lines: [{ at: 0, text: 'hello' }] }, panelTab: 7 });
    expect(s.status()!.sent).toBe(true);
    await s.progressed({ sending: 0, failed: 0, done: true }); // once
    expect(sent(A.AUDIO_TRANSCRIPT)).toHaveLength(1);
  });
  it('the file only: not transcribed, so no progress and nothing for the chat', async () => {
    const s = make();
    await s.start({ ...opts, to: 'file', transcribe: undefined });
    expect(s.status()!.progress).toBeUndefined();
    await s.progressed({ sending: 0, failed: 0, done: true });
    expect(s.status()!.progress).toBeUndefined();
    expect(await s.toChat({})).toEqual({ error: 'This audio is not transcribed.' });
  });
  it('discarded: dropped by the offscreen document (where it is open), nothing left', async () => {
    const s = make();
    await s.start(opts);
    await s.discard();
    expect(sent(A.AUDIO_DROP)).toHaveLength(1);
    expect(s.status()).toBeUndefined();
    expect(session()[A.AUDIO_STATUS]).toBeUndefined();
    open = false;
    await s.discard();
    expect(sent(A.AUDIO_DROP)).toHaveLength(1);
  });
});

describe('a worker that woke up', () => {
  const kept = { state: 'capturing' as const, tabId: 7, windowId: 2, site: 'talks.example.test', startedAt: 1000, to: 'review' as const };
  it('takes up what the offscreen document still captures', async () => {
    await storage.session.set({ [A.AUDIO_STATUS]: kept });
    held = 'capturing';
    const s = make();
    expect(await s.resume()).toEqual([]);
    expect(s.status()).toEqual(kept);
    expect(awake).toHaveBeenLastCalledWith(true);
  });
  it('one the document stopped meanwhile (the tab closed) is kept as stopped', async () => {
    await storage.session.set({ [A.AUDIO_STATUS]: kept });
    held = 'stopped';
    const s = make();
    expect(await s.resume()).toEqual([7]); // the pill on its tab goes
    expect(s.status()).toMatchObject({ state: 'stopped', endedAt: expect.any(Number) });
  });
  it('one the document no longer holds, or without the document: nothing', async () => {
    await storage.session.set({ [A.AUDIO_STATUS]: kept });
    const s = make();
    expect(await s.resume()).toEqual([7]);
    expect(s.status()).toBeUndefined();
    expect(session()[A.AUDIO_STATUS]).toBeUndefined();
    await storage.session.set({ [A.AUDIO_STATUS]: { ...kept, state: 'stopped' } });
    open = false;
    expect(await make().resume()).toEqual([]);
    expect(session()[A.AUDIO_STATUS]).toBeUndefined();
  });
  it('nothing left: nothing', async () => {
    expect(await make().resume()).toEqual([]);
    expect(onChange).not.toHaveBeenCalled();
  });
});
