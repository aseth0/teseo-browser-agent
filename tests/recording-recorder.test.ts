import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeStorage } from './fakes/browser';
import type { CaptureMessage } from '../src/recording/devtools';

// The background's one recording: started, fed by an engine, stopped, handed to a chat.
const storage = fakeStorage();
vi.mock('wxt/browser', () => ({ browser: { storage } }));
let emit: (m: CaptureMessage) => void = () => undefined;
const engineStop = vi.fn(async () => undefined);
const engine = vi.fn(async (_o: unknown, e: (m: CaptureMessage) => void) => {
  emit = e;
  return { stop: engineStop };
});
vi.mock('../src/recording/webrequest', () => ({ startWebRequest: engine }));
vi.mock('../src/recording/devtools', () => ({ startCapture: engine }));

const { createRecorder } = await import('../src/recording/recorder');
const { RECORDING_HANDOFF, RECORDING_LIVE, RECORDING_STATUS, RECORDING_WAIT_MS } = await import('../src/recording/recorder-protocol');
const { SHIPPED_PRESETS } = await import('../src/recording/presets');
const api = SHIPPED_PRESETS[0]!;

const awake = vi.fn();
const onChange = vi.fn();
const route = vi.fn((_tabId: number) => ({ panelTab: 7 }));
const make = () => createRecorder({ awake, route, onChange, timing: { settleMs: 0, statusMs: 0, mirrorMs: 0 } });
const opts = { tabId: 7, windowId: 2, url: 'https://shop.example.test/orders', mode: 'tab' as const, preset: api, devtools: false };
const session = () => storage.session.data;
const call = (id: string, url = `https://shop.example.test/api/${id}`) => emit({ call: { id, method: 'GET', url, at: Date.now(), included: true } });
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  storage.reset();
  vi.clearAllMocks();
});

describe('the recorder', () => {
  it('starts with the preset, keeps the worker awake, and says so', async () => {
    const rec = make();
    expect(await rec.start(opts)).toBe('started');
    expect(engine).toHaveBeenCalledWith({ tabId: 7, preset: api, site: 'shop.example.test' }, expect.any(Function));
    expect(awake).toHaveBeenCalledWith(true);
    expect(session()[RECORDING_STATUS]).toMatchObject({ state: 'recording', tabId: 7, windowId: 2, tabs: [7], site: 'shop.example.test', calls: 0, leftOut: 0, preset: 'API calls', mode: 'tab' });
  });
  it('follows what the engine catches: calls, drops, left out', async () => {
    const rec = make();
    await rec.start(opts);
    call('a');
    call('b');
    emit({ drop: 'b' });
    emit({ leftOut: 4 });
    await flush();
    expect(rec.status()).toMatchObject({ calls: 1, leftOut: 4 });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ calls: 1, leftOut: 4 }));
  });
  it('one at a time; one waiting for review is opened instead', async () => {
    const rec = make();
    await rec.start(opts);
    expect(await rec.start(opts)).toEqual({ error: 'A recording is already running.' });
    await rec.stop();
    expect(await rec.start(opts)).toBe('waiting');
  });
  it('stop gives the recording, reviewed-ready, once; asked twice, the same', async () => {
    const rec = make();
    await rec.start(opts);
    call('a');
    const [first, second] = await Promise.all([rec.stop(), rec.stop()]);
    expect(first).toBe(second);
    expect(first).toMatchObject({ tabId: 7, preset: 'API calls', leftOut: 0, calls: [expect.objectContaining({ id: 'a' })] });
    expect(engineStop).toHaveBeenCalledTimes(1);
    expect(awake).toHaveBeenLastCalledWith(false);
    expect(session()[RECORDING_STATUS]).toMatchObject({ state: 'stopped', calls: 1 });
    expect(session()[RECORDING_LIVE]).toBeUndefined();
    expect(await rec.stop()).toBe(first);
  });
  it('keeps what arrives while the bodies on their way settle after a stop', async () => {
    vi.useFakeTimers();
    try {
      const rec = createRecorder({ awake, route, onChange, timing: { settleMs: 500, statusMs: 0, mirrorMs: 0 } });
      await rec.start(opts);
      call('a');
      const stopped = rec.stop();
      await vi.advanceTimersByTimeAsync(100); // the engine stopped, the settle window open
      call('b');
      emit({ update: { id: 'a', status: 200 } });
      await vi.advanceTimersByTimeAsync(500);
      const recording = await stopped;
      expect(recording?.calls).toEqual([expect.objectContaining({ id: 'a', status: 200 }), expect.objectContaining({ id: 'b' })]);
      expect(rec.status()).toMatchObject({ state: 'stopped', calls: 2 });
    } finally {
      vi.useRealTimers();
    }
  });
  it('stopped by itself: handed to the chat for its tab, nothing opened', async () => {
    const rec = make();
    await rec.start(opts);
    call('a');
    emit({ ended: 'the tab was closed' });
    await flush();
    await flush();
    expect(route).toHaveBeenCalledWith(7);
    expect(session()[RECORDING_HANDOFF]).toMatchObject({ panelTab: 7, payload: { kind: 'recording', recording: { stopped: 'the tab was closed', calls: [expect.objectContaining({ id: 'a' })] } } });
    expect(rec.status()).toMatchObject({ state: 'stopped' });
  });
  it('a start that fails midway leaves nothing behind and says why', async () => {
    const rec = make();
    engine.mockImplementationOnce(async (_o, e) => {
      e({ ended: 'no access to shop.example.test' }); // the engine gave up before it started
      return { stop: engineStop };
    });
    expect(await rec.start(opts)).toEqual({ error: 'No access to shop.example.test.' });
    await flush();
    expect(rec.status()).toBeUndefined();
    expect(session()).toEqual({});
    expect(route).not.toHaveBeenCalled();
    expect(awake).toHaveBeenLastCalledWith(false);
    expect(onChange).not.toHaveBeenCalled(); // no badge, no pill
    expect(await rec.start(opts)).toBe('started');
  });
  it('an engine that throws while starting: the same', async () => {
    const rec = make();
    engine.mockImplementationOnce(async () => {
      throw new Error('Another debugger is attached to this tab');
    });
    expect(await rec.start(opts)).toEqual({ error: 'Another debugger is attached to this tab.' });
    await flush();
    expect(rec.status()).toBeUndefined();
    expect(session()).toEqual({});
    expect(await rec.stop()).toBeUndefined();
  });
  it('a stop after it stopped by itself: no second handoff', async () => {
    const rec = make();
    await rec.start(opts);
    emit({ ended: 'it reached 100 calls' });
    await flush();
    await flush();
    const at = (session()[RECORDING_HANDOFF] as { at: number }).at;
    await rec.stop();
    expect((session()[RECORDING_HANDOFF] as { at: number }).at).toBe(at);
  });
  it('keeps only the calls it kept, anywhere', async () => {
    const rec = make();
    await rec.start(opts);
    call('a');
    emit({ leftOut: 1 }); // the engine never sends a left-out call's address
    call('gone', 'https://shop.example.test/api/dropped-later');
    emit({ drop: 'gone' });
    await flush();
    expect(JSON.stringify(session())).not.toContain('dropped-later');
    await rec.stop();
    await rec.handOff({});
    expect(JSON.stringify(session())).not.toContain('dropped-later');
  });
  it('a chat taking it, or a discard, clears it', async () => {
    const rec = make();
    await rec.start(opts);
    await rec.stop();
    await rec.handOff({ panelTab: 7 });
    await storage.session.remove(RECORDING_HANDOFF);
    await flush();
    expect(rec.status()).toBeUndefined();
    expect(session()[RECORDING_STATUS]).toBeUndefined();
    await rec.start(opts);
    await rec.discard();
    expect(rec.status()).toBeUndefined();
    expect(session()).toEqual({});
  });
  it('one no chat took in time is discarded, with its bodies', async () => {
    vi.useFakeTimers();
    try {
      const rec = make();
      await rec.start(opts);
      emit({ call: { id: 'a', method: 'POST', url: 'https://shop.example.test/api/login', at: 0, included: true, requestBody: 'user=ann' } });
      await rec.stop();
      await rec.handOff({ panelTab: 7 });
      expect(session()[RECORDING_HANDOFF]).toBeDefined();
      await vi.advanceTimersByTimeAsync(RECORDING_WAIT_MS);
      expect(session()).toEqual({});
      expect(rec.status()).toBeUndefined();
      expect(await rec.start(opts)).toBe('started');
    } finally {
      vi.useRealTimers();
    }
  });
  it('a worker that restarts with one that waited too long drops it', async () => {
    const handoff = { at: Date.now() - RECORDING_WAIT_MS, payload: { kind: 'recording', recording: { tabId: 7, site: 'shop.example.test', startedAt: 0, calls: [], hidden: [] } }, panelTab: 7 };
    await storage.session.set({ [RECORDING_HANDOFF]: handoff, [RECORDING_STATUS]: { state: 'stopped', tabId: 7, windowId: 2, tabs: [7], site: 's', calls: 0, leftOut: 0, startedAt: 0, preset: 'API calls', mode: 'tab' } });
    const rec = make();
    expect(await rec.resume()).toEqual([]);
    expect(session()).toEqual({});
    expect(rec.status()).toBeUndefined();
  });
  it('a worker that restarted turns what was caught into a stopped recording', async () => {
    const before = make();
    await before.start(opts);
    call('a');
    call('b');
    call('c');
    await flush();
    const left = { ...session() };
    storage.reset();
    await storage.session.set(left);
    const after = make();
    await after.resume();
    expect(session()[RECORDING_HANDOFF]).toMatchObject({ payload: { recording: { stopped: 'the extension restarted', calls: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] } } });
    expect(after.status()).toMatchObject({ state: 'stopped', calls: 3 });
    expect(session()[RECORDING_LIVE]).toBeUndefined();
  });
  it('one waiting when the worker restarted waits again', async () => {
    const before = make();
    await before.start(opts);
    await before.stop();
    await before.handOff({ panelTab: 7 });
    const after = make();
    await after.resume();
    expect(after.status()).toMatchObject({ state: 'stopped' });
    expect(await after.start(opts)).toBe('waiting');
  });
  it('through DevTools with its mode, the tabs it went to listed', async () => {
    const rec = make();
    await rec.start({ ...opts, devtools: true, mode: 'tabs' });
    expect(engine).toHaveBeenCalledWith({ tabId: 7, mode: 'tabs', preset: api, site: 'shop.example.test' }, expect.any(Function));
    emit({ step: { at: 1, tabId: 9, kind: 'tab', target: 'Pay (pay.example.test)' } });
    await flush();
    expect(rec.status()).toMatchObject({ tabs: [7, 9], mode: 'tabs' });
  });
  it('hands a recording off once; Review may hand it again', async () => {
    const rec = make();
    await rec.start(opts);
    await rec.stop();
    const set = vi.spyOn(storage.session, 'set');
    await Promise.all([rec.handOff({ panelTab: 7 }), rec.handOff({ panelTab: 7 })]);
    expect(set.mock.calls.filter((c) => RECORDING_HANDOFF in c[0])).toHaveLength(1);
    await rec.handOff({ tab: 9 }, { again: true });
    expect(session()[RECORDING_HANDOFF]).toMatchObject({ tab: 9 });
    set.mockRestore();
  });
  it('a recording too big for storage is handed off with its bodies shortened, saying so', async () => {
    const rec = make();
    await rec.start(opts);
    for (let i = 0; i < 5; i++) emit({ call: { id: `c${i}`, method: 'POST', url: `https://shop.example.test/api/${i}`, at: i, included: true, requestBody: 's'.repeat(20_000), responseBody: 'r'.repeat(20_000) } });
    await flush();
    await rec.stop();
    const set = storage.session.set.bind(storage.session);
    const quota = vi.spyOn(storage.session, 'set').mockImplementation(async (items) => {
      if (JSON.stringify(items).length > 60_000) throw new Error('QUOTA_BYTES quota exceeded');
      return set(items);
    });
    await rec.handOff({ panelTab: 7 });
    quota.mockRestore();
    const handed = (session()[RECORDING_HANDOFF] as { payload: { recording: { calls: { requestBody: string; responseBody: string }[]; notes: string[] } } }).payload;
    expect(handed.recording.calls).toHaveLength(5);
    expect(handed.recording.calls[0]!.responseBody.length).toBeLessThanOrEqual(2000);
    expect(handed.recording.notes).toContain('Bodies cut to 2,000 characters: the recording was too big to hand to the chat.');
  });
  it('a mirror the storage refuses does not break the recording', async () => {
    const rec = make();
    const set = vi.spyOn(storage.session, 'set').mockImplementation(async (items) => {
      if (RECORDING_LIVE in items) throw new Error('QUOTA_BYTES quota exceeded');
    });
    expect(await rec.start(opts)).toBe('started');
    call('a');
    await flush();
    set.mockRestore();
    expect(rec.status()).toMatchObject({ calls: 1 });
  });
  it('a stopped status left without its recording (taken while the worker slept) is cleared', async () => {
    await storage.session.set({ [RECORDING_STATUS]: { state: 'stopped', tabId: 7, windowId: 2, tabs: [7], site: 's', calls: 1, leftOut: 0, startedAt: 0, preset: 'API calls', mode: 'tab' } });
    const rec = make();
    expect(await rec.resume()).toEqual([]);
    expect(rec.status()).toBeUndefined();
    expect(session()[RECORDING_STATUS]).toBeUndefined();
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });
  it('resume says which tabs were being recorded, for their pills', async () => {
    const before = make();
    await before.start({ ...opts, devtools: true, mode: 'tabs' });
    emit({ step: { at: 1, tabId: 9, kind: 'tab', target: 'Pay' } });
    await flush();
    const after = make();
    expect(await after.resume()).toEqual([7, 9]);
  });
});
