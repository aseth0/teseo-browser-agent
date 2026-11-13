import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeEvent, fakeStorage } from './fakes/browser';

// What starts the background's capture of a tab's audio: the popup (an extension page) and the
// shortcut, the browser's or a key set in Settings pressed in the page. Where it refuses, it says why.
const onCommand = fakeEvent<(command: string, tab?: { id?: number; windowId: number }) => void>();
const onMessage = fakeEvent<(msg: unknown, sender: { url?: string; frameId?: number; tab?: { id: number; windowId?: number } }, reply: (r: unknown) => void) => unknown>();
const onUpdated = fakeEvent<(id: number, change: { status?: string }) => void>();
const tabs: Record<number, { id: number; windowId: number; url: string }> = {
  7: { id: 7, windowId: 2, url: 'https://talks.example.test/' },
  8: { id: 8, windowId: 2, url: 'chrome://settings/' },
  9: { id: 9, windowId: 2, url: 'https://other.example.test/' },
};
const notify = vi.fn(async (_o: unknown) => 'n');
const getMediaStreamId = vi.fn(async (_o: unknown) => 'stream-1');
const sendMessage = vi.fn(async (_m: unknown) => ({ startedAt: 1000 }));
vi.mock('wxt/browser', () => ({
  browser: {
    commands: { onCommand },
    runtime: { onMessage, sendMessage, getURL: (p: string) => `chrome-extension://ext${p}`, getManifest: () => ({ commands: { 'audio-toggle': {} } }) },
    tabs: { get: async (id: number) => tabs[id], onUpdated, sendMessage: vi.fn(async () => undefined) },
    notifications: { create: notify },
    scripting: { executeScript: vi.fn(async () => []) },
    tabCapture: { getMediaStreamId },
    storage: (() => {
      const storage = fakeStorage();
      storage.local.data.pageKeys = { 'audio-toggle': { code: 'KeyA', alt: true } }; // its key set in Settings
      return storage;
    })(),
  },
}));
vi.mock('../src/audio/offscreen-document', () => ({ offscreenOpen: async () => false, offscreenReady: async () => undefined }));
vi.mock('../src/page/access', () => ({ hasAccess: async (url: string) => !url.includes('other.example') }));
vi.mock('../src/background/settings', () => ({ settingsNow: async () => ({ providers: [], audioTo: 'review' }) }));
vi.mock('../src/voice/settings', () => ({
  tabAudioTarget: () => ({ provider: { id: 'p', name: 'P', baseURL: 'https://api.example.test/v1', apiKey: 'k' }, model: 'whisper-1', chunkSeconds: 30 }),
  tabAudioView: () => 'pill',
}));
vi.mock('../src/providers/provider-access', () => ({ unreachable: async () => undefined }));
vi.mock('../src/background/keep-awake', () => ({ keepAwake: () => vi.fn() }));
vi.mock('../src/background/badge', () => ({ setBadgePart: vi.fn() }));
vi.mock('../src/background/floating-tabs', () => ({ floatingNow: () => false }));
vi.mock('../src/background/panel-mode', () => ({ panelFollowsNow: () => false }));
vi.mock('../src/background/open-chat', () => ({ openChat: () => ({ panelTab: 7 }) }));
vi.mock('../src/browser/open-manager', () => ({ openAudioReview: vi.fn(async () => undefined) }));

const { hostAudio } = await import('../src/background/audio-host');
const { listenPageKeys } = await import('../src/background/shortcuts');
const { AUDIO_COMMAND, AUDIO_DISCARD, AUDIO_START } = await import('../src/audio/protocol');
const { PAGE_KEY } = await import('../src/core/protocol');

hostAudio();
listenPageKeys();
const popup = { url: 'chrome-extension://ext/popup.html' };
const settled = async () => {
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
};
const ask = async (msg: unknown, sender: object = popup) => {
  const reply = vi.fn();
  onMessage.emit(msg, sender, reply);
  await settled();
  return reply;
};
const notified = () => notify.mock.calls.map(([o]) => (o as { title: string; message: string }).message);

beforeEach(async () => {
  await ask({ type: AUDIO_DISCARD });
  vi.clearAllMocks();
});

describe('starting a capture', () => {
  it('from the popup, on a site enabled', async () => {
    expect(await ask({ type: AUDIO_START, tabId: 7, windowId: 2, to: 'review' })).toHaveBeenCalledWith({ started: true });
    expect(getMediaStreamId).toHaveBeenCalledWith({ targetTabId: 7 });
  });
  it('not on a page it cannot capture, nor on a site not enabled, saying why', async () => {
    expect(await ask({ type: AUDIO_START, tabId: 8, windowId: 2, to: 'review' })).toHaveBeenCalledWith({ error: 'Pages like this one cannot be captured.' });
    expect(await ask({ type: AUDIO_START, tabId: 9, windowId: 2, to: 'review' })).toHaveBeenCalledWith({ error: 'This site is not enabled.' });
    expect(getMediaStreamId).not.toHaveBeenCalled();
  });
});

describe('the shortcut', () => {
  it("the browser's: captures the tab it was pressed on", async () => {
    onCommand.emit(AUDIO_COMMAND, { id: 7, windowId: 2 });
    await settled();
    expect(getMediaStreamId).toHaveBeenCalledWith({ targetTabId: 7 });
    expect(notify).not.toHaveBeenCalled();
  });
  it("the browser's, on a site not enabled: refused, with the reason", async () => {
    onCommand.emit(AUDIO_COMMAND, { id: 9, windowId: 2 });
    await settled();
    expect(getMediaStreamId).not.toHaveBeenCalled();
    expect(notified()).toEqual(['This site is not enabled.']);
  });
  it('a key set in Settings, pressed in the page: refused, since the browser lets only its own shortcut capture', async () => {
    onMessage.emit({ type: PAGE_KEY, command: AUDIO_COMMAND }, { url: 'https://talks.example.test/', frameId: 0, tab: { id: 7, windowId: 2 } }, () => undefined);
    await settled();
    expect(getMediaStreamId).not.toHaveBeenCalled();
    expect(notified()).toEqual(["A key set in Settings → Shortcuts cannot capture a tab's audio: use the browser's shortcut or the toolbar popup."]);
  });
});
