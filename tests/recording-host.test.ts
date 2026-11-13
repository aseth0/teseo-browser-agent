import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeEvent } from './fakes/browser';

// What starts, stops and opens the background's recording: the popup and the side panel (extension
// pages), the pill on the recorded page, and the shortcut.
const onCommand = fakeEvent<(command: string, tab?: { id?: number; windowId: number; url?: string }) => void>();
const onMessage = fakeEvent<(msg: unknown, sender: { url?: string; frameId?: number; tab?: { id: number; windowId?: number } }, reply: (r: unknown) => void) => unknown>();
const onUpdated = fakeEvent<(id: number, change: { status?: string }) => void>();
const tabs: Record<number, { id: number; windowId: number; url: string }> = {
  7: { id: 7, windowId: 2, url: 'https://shop.example.test/' },
  8: { id: 8, windowId: 2, url: 'chrome://settings/' },
  9: { id: 9, windowId: 2, url: 'https://other.example.test/' },
};
const notify = vi.fn(async (_o: unknown) => 'n');
const executeScript = vi.fn(async (_o: unknown) => []);
const sendMessage = vi.fn(async (_t: number, _m: unknown) => undefined);
vi.mock('wxt/browser', () => ({
  browser: {
    commands: { onCommand },
    runtime: { onMessage, getURL: (p: string) => `chrome-extension://ext${p}` },
    tabs: { get: async (id: number) => tabs[id], onUpdated, sendMessage },
    notifications: { create: notify, clear: vi.fn(async () => true), onClicked: { addListener: vi.fn() } },
    scripting: { executeScript },
    debugger: {},
  },
}));
const open = vi.fn(async (_tab: unknown, _follows: boolean, _shown: boolean) => undefined);
vi.mock('../src/core/side-panel', () => ({ openSidePanel: open }));
let shownPanels = new Set<number>(); // the windows whose side panel shows (background/panel-windows)
vi.mock('../src/background/panel-windows', () => ({ panelShownIn: (windowId: number) => shownPanels.has(windowId) }));
let floating = new Set<number>();
vi.mock('../src/background/floating-tabs', () => ({ floatingNow: (id: number) => floating.has(id) }));
vi.mock('../src/background/panel-mode', () => ({ panelFollowsNow: () => false }));
let devtools = false;
let presets: unknown[] | undefined;
let interactions: Record<string, string> | undefined; // Settings → Alerts
vi.mock('../src/background/settings', () => ({ settingsNow: async () => ({ devtoolsTools: devtools, recordingPreset: 'errors', recordingPresets: presets, interactions }) }));
vi.mock('../src/page/access', () => ({ hasAccess: async (url: string) => !url.includes('other.example') }));
vi.mock('../src/background/keep-awake', () => ({ keepAwake: () => vi.fn() }));
const badge = vi.fn();
vi.mock('../src/background/badge', () => ({ setBadgePart: badge }));

type Status = { state: 'recording' | 'stopped'; tabId: number; windowId: number; tabs: number[]; calls: number; leftOut: number; startedAt: number };
let status: Status | undefined;
let onChange: (s: Status | undefined) => void = () => undefined;
let route: (tabId: number) => unknown = () => undefined;
const recording = { tabId: 7, calls: [] };
let stopped = Promise.resolve<unknown>(recording);
let resumed: number[] = [];
const recorder = {
  status: () => status,
  start: vi.fn(async (_o: unknown) => 'started' as unknown),
  stop: vi.fn(() => stopped),
  handOff: vi.fn(async (_to: unknown) => undefined),
  discard: vi.fn(async () => undefined),
  resume: vi.fn(async (): Promise<number[]> => resumed),
};
vi.mock('../src/recording/recorder', () => ({
  createRecorder: (deps: { onChange: typeof onChange; route: typeof route }) => {
    onChange = deps.onChange;
    route = deps.route;
    return recorder;
  },
}));

const { hostRecording } = await import('../src/background/recording-host');
const P = await import('../src/recording/protocol');
const { RECORDING_COMMAND } = await import('../src/recording/recorder-protocol');
const { WIDGET_FLOAT } = await import('../src/widget/protocol');

hostRecording();
const popup = { url: 'chrome-extension://ext/popup.html' };
const page = (tabId: number) => ({ url: 'https://shop.example.test/', frameId: 0, tab: { id: tabId, windowId: 2 } });
const ask = async (msg: unknown, sender: object = popup) => {
  const reply = vi.fn();
  onMessage.emit(msg, sender, reply);
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  return reply;
};
const recordingNow = (): Status => ({ state: 'recording', tabId: 7, windowId: 2, tabs: [7], calls: 3, leftOut: 1, startedAt: 100 });

beforeEach(() => {
  vi.clearAllMocks();
  status = undefined;
  floating = new Set();
  shownPanels = new Set();
  devtools = false;
  presets = undefined;
  stopped = Promise.resolve(recording);
});

describe('starting a recording', () => {
  it("from a page's script: ignored", async () => {
    const reply = await ask({ type: P.RECORDING_START, tabId: 7, windowId: 2, mode: 'tab' }, page(7));
    expect(recorder.start).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });
  it('from the popup, with the preset it chose', async () => {
    const reply = await ask({ type: P.RECORDING_START, tabId: 7, windowId: 2, mode: 'tabs', presetId: 'everything' });
    expect(recorder.start).toHaveBeenCalledWith(expect.objectContaining({ tabId: 7, windowId: 2, url: 'https://shop.example.test/', mode: 'tabs', devtools: false, preset: expect.objectContaining({ id: 'everything' }) }));
    expect(reply).toHaveBeenCalledWith({ started: true });
  });
  it('not on a page it cannot record, saying why', async () => {
    expect(await ask({ type: P.RECORDING_START, tabId: 8, windowId: 2, mode: 'tab' })).toHaveBeenCalledWith({ error: 'Pages like this one cannot be recorded.' });
    expect(await ask({ type: P.RECORDING_START, tabId: 9, windowId: 2, mode: 'tab' })).toHaveBeenCalledWith({ error: 'This site is not enabled.' });
    expect(recorder.start).not.toHaveBeenCalled();
  });
  it('with a preset that keeps no kind of call (saved before it was refused): refused, saying why', async () => {
    const { SHIPPED_PRESETS } = await import('../src/recording/presets');
    presets = [{ ...SHIPPED_PRESETS[0]!, id: 'own-1', name: 'Mine', types: [] }];
    expect(await ask({ type: P.RECORDING_START, tabId: 7, windowId: 2, mode: 'tab', presetId: 'own-1' })).toHaveBeenCalledWith({ error: 'The preset "Mine" keeps no kind of call: tick one in Settings → Recording.' });
    expect(recorder.start).not.toHaveBeenCalled();
  });
  it('one waiting for review: says so', async () => {
    recorder.start.mockResolvedValueOnce('waiting');
    expect(await ask({ type: P.RECORDING_START, tabId: 7, windowId: 2, mode: 'tab' })).toHaveBeenCalledWith({ waiting: true });
  });
});

describe('stopping it', () => {
  it('from the popup: the chat opens inside the click, then gets it', async () => {
    status = recordingNow();
    let release!: (r: unknown) => void;
    stopped = new Promise((r) => (release = r));
    onMessage.emit({ type: P.RECORDING_STOP }, popup, vi.fn());
    expect(open).toHaveBeenCalledWith({ id: 7, windowId: 2 }, false, false, 'open-chat');
    expect(recorder.handOff).not.toHaveBeenCalled();
    release(recording);
    await new Promise((r) => setTimeout(r, 0));
    expect(recorder.handOff).toHaveBeenCalledWith({ panelTab: 7 });
  });
  it("with the window's side panel showing (Vivaldi: opening it would close it): left open, it gets it", async () => {
    status = recordingNow();
    shownPanels.add(2);
    await ask({ type: P.RECORDING_STOP });
    expect(open).toHaveBeenCalledWith({ id: 7, windowId: 2 }, false, true, 'open-chat');
    expect(recorder.handOff).toHaveBeenCalledWith({ panelTab: 7 });
  });
  it('the chat floating on its tab gets it, unfolded', async () => {
    status = recordingNow();
    floating.add(7);
    await ask({ type: P.RECORDING_STOP });
    expect(open).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(7, { type: WIDGET_FLOAT });
    expect(recorder.handOff).toHaveBeenCalledWith({ tab: 7 });
  });
  it("from the pill on the recorded page; another page's ignored", async () => {
    status = recordingNow();
    onChange(status);
    await ask({ type: P.RECORDING_PILL_STOP }, page(9));
    expect(recorder.stop).not.toHaveBeenCalled();
    const reply = await ask({ type: P.RECORDING_PILL_STOP }, page(7));
    expect(open).toHaveBeenCalledWith({ id: 7, windowId: 2 }, false, false, 'open-chat');
    expect(reply).toHaveBeenCalledWith({ opened: true });
  });
});

describe('the one waiting', () => {
  it("Review opens the chat for the tab you are on, inside the click, and hands it there", async () => {
    status = { ...recordingNow(), state: 'stopped' };
    onMessage.emit({ type: P.RECORDING_REVIEW, tabId: 9, windowId: 2 }, popup, vi.fn());
    expect(open).toHaveBeenCalledWith({ id: 9, windowId: 2 }, false, false, 'open-chat');
    await new Promise((r) => setTimeout(r, 0));
    expect(recorder.handOff).toHaveBeenCalledWith({ panelTab: 9 }, { again: true });
  });
  it('Discard', async () => {
    await ask({ type: P.RECORDING_DISCARD });
    expect(recorder.discard).toHaveBeenCalled();
  });
});

describe('the shortcut', () => {
  const press = async (tab: { id: number; windowId: number; url: string }) => {
    onCommand.emit(RECORDING_COMMAND, tab);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  };
  it('starts with the default preset, in this tab', async () => {
    devtools = true;
    await press(tabs[7]!);
    expect(recorder.start).toHaveBeenCalledWith(expect.objectContaining({ tabId: 7, mode: 'tab', devtools: true, preset: expect.objectContaining({ id: 'errors' }) }));
  });
  it('on a page it cannot record: a notification, nothing started', async () => {
    await press(tabs[8]!);
    await press(tabs[9]!);
    expect(recorder.start).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(2);
  });
  it('while recording: stops it and opens the review', async () => {
    status = recordingNow();
    await press(tabs[9]!);
    expect(open).toHaveBeenCalledWith({ id: 7, windowId: 2 }, false, false, 'open-chat');
    expect(recorder.handOff).toHaveBeenCalled();
  });
  it('one waiting: opens it in the chat for this tab', async () => {
    status = { ...recordingNow(), state: 'stopped' };
    await press(tabs[9]!);
    expect(recorder.stop).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith({ id: 9, windowId: 2 }, false, false, 'open-chat');
    expect(recorder.handOff).toHaveBeenCalledWith({ panelTab: 9 }, { again: true });
  });
  it('one found waiting only once the worker woke: handed to this tab\'s chat, with the badge\'s "!" (its default level)', async () => {
    recorder.start.mockImplementationOnce(async () => {
      status = { ...recordingNow(), state: 'stopped' };
      return 'waiting';
    });
    await press(tabs[7]!);
    expect(recorder.handOff).toHaveBeenCalledWith({ panelTab: 7 }, { again: true });
    await vi.waitFor(() => expect(badge).toHaveBeenCalledWith('waiting', true));
    expect(notify).not.toHaveBeenCalled();
    onChange(undefined); // reviewed: nothing waits
    expect(badge).toHaveBeenCalledWith('waiting', false);
  });
  it('the same, at Notify: a notification', async () => {
    interactions = { recording: 'notify' };
    recorder.start.mockImplementationOnce(async () => {
      status = { ...recordingNow(), state: 'stopped' };
      return 'waiting';
    });
    await press(tabs[7]!);
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith('ba-alert:recording-review', expect.objectContaining({ title: 'A recording waits for review' })));
    onChange(undefined);
    interactions = undefined;
  });
});

describe('the notice', () => {
  it('the badge counts, and the pill shows on the recorded tab and follows', async () => {
    onChange(undefined); // no pill left from another test
    vi.clearAllMocks();
    onChange(recordingNow());
    expect(badge).toHaveBeenCalledWith('recording', { state: 'recording', calls: 3 });
    expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 7 }, args: [{ stop: P.RECORDING_PILL_STOP, update: P.RECORDING_PILL }, { kind: 'recording', calls: 3, leftOut: 1, startedAt: 100 }] }));
    onChange({ ...recordingNow(), calls: 4 });
    expect(sendMessage).toHaveBeenCalledWith(7, { type: P.RECORDING_PILL, calls: 4, leftOut: 1, startedAt: 100 });
    onChange({ ...recordingNow(), state: 'stopped' });
    expect(sendMessage).toHaveBeenCalledWith(7, { type: P.RECORDING_PILL, off: true });
    onChange(undefined);
    expect(badge).toHaveBeenLastCalledWith('recording', undefined);
  });
  it('a recording that stops by itself goes to the chat for its tab', () => {
    expect(route(7)).toEqual({ panelTab: 7 });
    floating.add(7);
    expect(route(7)).toEqual({ tab: 7 });
  });
});

describe('a worker that woke up', () => {
  it('answers only once the recorder has read what it left, and puts away the pills of a recording it lost', async () => {
    vi.resetModules();
    let resolve!: (tabs: number[]) => void;
    recorder.resume.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const { hostRecording: again } = await import('../src/background/recording-host');
    onMessage.listeners.clear();
    again();
    onMessage.emit({ type: P.RECORDING_START, tabId: 7, windowId: 2, mode: 'tab' }, popup, vi.fn());
    await new Promise((r) => setTimeout(r, 0));
    expect(recorder.start).not.toHaveBeenCalled();
    resolve([7]);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(recorder.start).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(7, { type: P.RECORDING_PILL, off: true });
  });
});
