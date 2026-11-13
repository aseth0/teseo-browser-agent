import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeEvent, fakeStorage } from './fakes/browser';

// The background's side of Speak: the shortcut reads the tab's selection (with the key's access to it)
// or stops what is read; the page widget's button reads with its own tab's pill; the pill's Stop only
// from the tab it is on; what the offscreen document says moves the status.
const onCommand = fakeEvent<(command: string, tab?: { id?: number; windowId: number }) => void>();
const onMessage = fakeEvent<(msg: unknown, sender: { url?: string; frameId?: number; tab?: { id: number; windowId?: number } }, reply: (r: unknown) => void) => unknown>();
const onUpdated = fakeEvent<(id: number, change: { status?: string }) => void>();
const notify = vi.fn(async (_o: unknown) => 'n');
const sent: { type: string; [k: string]: unknown }[] = [];
const sendMessage = vi.fn(async (m: { type: string }) => {
  sent.push(m);
  if (m.type === 'browser-agent:speak-play') return { ok: true };
  return undefined;
});
let selection = '';
const executeScript = vi.fn(async (o: { func: { name: string } }) => (o.func.name === 'pageSelection' ? [{ result: '' }, { result: selection }] : [{ result: undefined }]));
const tabMessages: [number, unknown][] = [];
const storage = fakeStorage();
vi.mock('wxt/browser', () => ({
  browser: {
    commands: { onCommand },
    offscreen: {},
    runtime: { onMessage, sendMessage, getURL: (p: string) => `chrome-extension://ext${p}`, getManifest: () => ({ commands: { 'speak-toggle': {} } }) },
    tabs: { onUpdated, sendMessage: vi.fn(async (id: number, m: unknown) => void tabMessages.push([id, m])) },
    notifications: { create: notify },
    scripting: { executeScript },
    storage,
  },
}));
vi.mock('../src/audio/offscreen-document', () => ({ offscreenReady: async () => undefined }));
let actions: object[] = [];
vi.mock('../src/agents/profiles', async (original) => ({ ...(await original<object>()), agentStore: { load: async () => [] } }));
vi.mock('../src/widget/store', () => ({ actionStore: { load: async () => actions } }));
vi.mock('../src/providers/provider-access', () => ({ unreachable: async () => undefined }));
vi.mock('../src/background/settings', () => ({
  settingsNow: async () => ({
    providers: [{ id: 'p', name: 'P', baseURL: 'https://tts.example.test/v1', apiKey: 'k', defaultModel: '' }],
    speak: { profiles: [{ id: 'a', name: 'Calm', providerId: 'p', model: 'tts-1', voice: 'nova_a', speed: 1.25 }, { id: 'b', name: 'Quick', providerId: 'p', model: 'tts-1', voice: 'nova_b' }] },
  }),
}));

const { hostSpeech } = await import('../src/background/speech-host');
const { SPEAK_COMMAND, SPEAK_ENDED, SPEAK_PILL_STOP, SPEAK_PROGRESS, SPEAK_STATUS, SPEAK_STOP, SPEAK_TEXT, SPEAK_UNQUEUE } = await import('../src/speech/protocol');

hostSpeech();
const settled = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};
const page = (tabId: number) => ({ url: 'https://news.example.test/', frameId: 0, tab: { id: tabId, windowId: 1 } });
const ask = async (msg: unknown, sender: object) => {
  const reply = vi.fn();
  onMessage.emit(msg, sender, reply);
  await settled();
  return reply;
};
const status = () => storage.session.data[SPEAK_STATUS] as { run: string; state: string; piece: number; tabId?: number } | undefined;
const played = () => sent.filter((m) => m.type === 'browser-agent:speak-play');

beforeEach(async () => {
  await ask({ type: SPEAK_STOP }, { url: 'chrome-extension://ext/popup.html' }); // anything left from the test before
  sent.length = 0;
  tabMessages.length = 0;
  vi.clearAllMocks();
});

describe('the shortcut', () => {
  it('reads the selection of the tab it was pressed on, with the default profile, its pill there', async () => {
    selection = 'Hello there. How are you?';
    onCommand.emit(SPEAK_COMMAND, { id: 3, windowId: 1 });
    await settled();
    expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 3, allFrames: true } }));
    expect(played()).toHaveLength(1);
    expect(played()[0]).toMatchObject({ pieces: [{ input: 'Hello there. How are you?', trim: false }], target: { voice: 'nova_a', speed: 1.25, model: 'tts-1' } });
    expect(status()).toMatchObject({ state: 'preparing', tabId: 3 });
    expect(executeScript.mock.calls.some(([o]) => (o as { func: { name: string } }).func.name === 'showSpeechPill')).toBe(true);
  });

  it('pressed again while reading, stops it', async () => {
    selection = 'Hello.';
    onCommand.emit(SPEAK_COMMAND, { id: 3, windowId: 1 });
    await settled();
    onCommand.emit(SPEAK_COMMAND, { id: 3, windowId: 1 });
    await settled();
    expect(sent.map((m) => m.type)).toContain('browser-agent:speak-halt');
    expect(status()).toBeUndefined();
    expect(tabMessages).toContainEqual([3, { type: 'browser-agent:speak-pill', off: true }]);
  });

  it('with nothing selected, says so', async () => {
    selection = '';
    onCommand.emit(SPEAK_COMMAND, { id: 3, windowId: 1 });
    await settled();
    expect(played()).toHaveLength(0);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Nothing read aloud' }));
  });
});

describe('the reading', () => {
  it('from the page widget: its own tab, whatever it names', async () => {
    const reply = await ask({ type: SPEAK_TEXT, text: 'From the page.', tabId: 99, profile: { id: 'x', name: 'X', providerId: 'p', model: 'm', voice: 'evil' } }, page(5));
    expect(reply).toHaveBeenCalledWith({ started: true });
    expect(played()[0]).toMatchObject({ target: { voice: 'nova_a' } });
    expect(status()).toMatchObject({ tabId: 5 });
  });

  it("from a box of an action's card: its own tab, the box as what is read, the voice of the action's agent", async () => {
    const reply = await ask({ type: SPEAK_TEXT, text: 'Prices rose.', action: 'gone', box: 2, profileId: 'evil' }, page(5));
    expect(reply).toHaveBeenCalledWith({ started: true });
    expect(played()[0]).toMatchObject({ target: { voice: 'nova_a' } }); // an action not found: the active agent's
    expect(status()).toMatchObject({ tabId: 5, key: 'action:gone:2' });
  });

  it("an action's box with the action's own profile; one removed since, its agent's", async () => {
    actions = [{ id: 'own', name: 'Own', speak: { profileId: 'b' } }, { id: 'gone', name: 'Gone', speak: { profileId: 'removed' } }];
    try {
      await ask({ type: SPEAK_TEXT, text: 'Prices rose.', action: 'own', box: 0 }, page(5));
      expect(played().at(-1)).toMatchObject({ target: { voice: 'nova_b' } });
      await ask({ type: SPEAK_TEXT, text: 'Prices rose.', action: 'gone', box: 0 }, page(5));
      expect(played().at(-1)).toMatchObject({ target: { voice: 'nova_a' } });
    } finally {
      actions = [];
    }
  });

  it("boxes on their own wait their turn; the page drops its own, and the pill hears what waits", async () => {
    await ask({ type: SPEAK_TEXT, text: 'One.', action: 'x', box: 0, queued: true }, page(5));
    const reply = await ask({ type: SPEAK_TEXT, text: 'Two.', action: 'x', box: 1, queued: true }, page(5));
    expect(reply).toHaveBeenCalledWith({ started: true, queued: true });
    expect(status()).toMatchObject({ key: 'action:x:0', waiting: ['action:x:1'] });
    expect(tabMessages.at(-1)).toEqual([5, expect.objectContaining({ key: 'action:x:0', waiting: ['action:x:1'], text: 'Preparing… · 1 more waiting' })]);
    await ask({ type: SPEAK_UNQUEUE, prefix: 'action:' }, page(6)); // another tab's page: not its boxes
    expect(status()).toMatchObject({ waiting: ['action:x:1'] });
    await ask({ type: SPEAK_UNQUEUE, prefix: 'action:' }, page(5));
    expect(status()).not.toHaveProperty('waiting');
  });

  it('follows the offscreen document, and the pill says how far it is', async () => {
    await ask({ type: SPEAK_TEXT, text: 'One. Two.', tabId: 5 }, { url: 'chrome-extension://ext/sidepanel.html' });
    const run = status()!.run;
    await ask({ type: SPEAK_PROGRESS, run, piece: 1, total: 2, playing: true }, { url: 'chrome-extension://ext/offscreen.html' });
    expect(status()).toMatchObject({ state: 'reading', piece: 1 });
    await ask({ type: SPEAK_ENDED, run }, { url: 'chrome-extension://ext/offscreen.html' });
    expect(status()).toBeUndefined();
  });

  it("the pill's Stop, only from the tab it is on", async () => {
    await ask({ type: SPEAK_TEXT, text: 'One.', tabId: 5 }, { url: 'chrome-extension://ext/sidepanel.html' });
    expect(await ask({ type: SPEAK_PILL_STOP }, page(6))).not.toHaveBeenCalled();
    expect(status()).toBeDefined();
    expect(await ask({ type: SPEAK_PILL_STOP }, page(5))).toHaveBeenCalledWith({});
    expect(status()).toBeUndefined();
  });
});
