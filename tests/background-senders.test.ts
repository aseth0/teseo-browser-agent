// The background's listeners, called as the browser would: a page's content script never opens the
// chat's port, nor starts a summary or a watch; the page widget's port only from a page's top frame.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeEvent, fakePort, fakeStorage } from './fakes/browser';

const EXTENSION = 'chrome-extension://ext-id/';
const storage = fakeStorage();
const onConnect = fakeEvent<(port: ReturnType<typeof fakePort>) => void>();
const onMessage = fakeEvent<(msg: unknown, sender: object, sendResponse: (reply: unknown) => void) => unknown>();
vi.mock('wxt/browser', () => ({
  browser: fakeBrowser(storage, {
    runtime: { id: 'ext-id', getURL: (path: string) => EXTENSION + path.replace(/^\//, ''), onConnect, onMessage, getPlatformInfo: async () => ({}) },
    tabs: { onUpdated: fakeEvent(), onRemoved: fakeEvent(), get: async () => ({}) },
    alarms: { onAlarm: fakeEvent(), create: vi.fn(), clear: vi.fn() },
    notifications: { onClicked: fakeEvent(), create: vi.fn(async () => '') },
  }),
}));
const runAgent = vi.fn(async () => undefined);
vi.mock('../src/background/agent-run', () => ({ runAgent }));
const createProvider = vi.fn();
vi.mock('../src/providers/registry', async (original) => ({ ...(await original<object>()), createProvider }));

const { PORT_NAME, SUMMARIZE, WATCH_CANCEL, WATCH_START } = await import('../src/core/protocol');
const { WIDGET_RUN } = await import('../src/widget/protocol');
const { createSessions } = await import('../src/background/session');
const { listenWidgetRuns } = await import('../src/background/widget-run');
const { listenSummarize } = await import('../src/background/summarize');
const { listenWatches } = await import('../src/background/watches');

const toolsFor = vi.fn();
createSessions(toolsFor);
listenWidgetRuns(toolsFor);
listenSummarize();
listenWatches();

const PANEL = { url: `${EXTENSION}sidepanel.html` };
const FLOATING_CHAT = { url: `${EXTENSION}sidepanel.html?floating`, tab: { id: 7 }, frameId: 3 }; // in a page's frame
const PAGE_TOP = { url: 'https://example.com/', tab: { id: 7 }, frameId: 0 };
const PAGE_FRAME = { url: 'https://ads.example.com/', tab: { id: 7 }, frameId: 2 };
const PAGE_DISGUISED = { url: `https://example.com/?${EXTENSION}`, tab: { id: 7 }, frameId: 0 };

const connect = (name: string, sender: Parameters<typeof fakePort>[1]) => {
  const port = fakePort(name, sender);
  onConnect.emit(port);
  return port;
};
// What a one-off message gets: its listeners' answer, or none (undefined) when all leave it.
const message = async (msg: object, sender: object) => {
  const replies: unknown[] = [];
  const kept = onMessage.emit(msg, sender, (r) => replies.push(r));
  if (kept.includes(true)) await vi.waitFor(() => expect(replies.length).toBe(1));
  return { answered: kept.includes(true) || replies.length > 0, reply: replies[0] };
};

beforeEach(() => {
  storage.reset();
  vi.clearAllMocks();
});

describe("the chat's port", () => {
  it('is disconnected when a content script opens it, and never runs', () => {
    for (const sender of [PAGE_TOP, PAGE_FRAME, PAGE_DISGUISED, {}]) {
      const port = connect(PORT_NAME, sender);
      expect(port.disconnect).toHaveBeenCalledOnce();
      expect(port.onMessage.listeners.size).toBe(0);
    }
  });

  it("runs from the extension's own pages: the side panel and the floating chat", async () => {
    for (const sender of [PANEL, FLOATING_CHAT]) {
      const port = connect(PORT_NAME, sender);
      expect(port.disconnect).not.toHaveBeenCalled();
      port.onMessage.emit({ type: 'run', history: [], conversationId: 'c1', tabId: 7 });
      await vi.waitFor(() => expect(runAgent).toHaveBeenCalledOnce());
      runAgent.mockClear();
    }
  });

  it("leaves another part's port alone", () => {
    const port = connect('another-port', PAGE_TOP);
    expect(port.disconnect).not.toHaveBeenCalled();
    expect(port.onMessage.listeners.size).toBe(0);
  });
});

describe("the page widget's port", () => {
  it("is disconnected when a page's frame or a sender without a tab opens it", () => {
    for (const sender of [PAGE_FRAME, { url: 'https://example.com/' }]) expect(connect(WIDGET_RUN, sender).disconnect).toHaveBeenCalledOnce();
  });

  it("is taken from a page's top frame and from the extension's pages", () => {
    for (const sender of [PAGE_TOP, PANEL]) {
      const port = connect(WIDGET_RUN, sender);
      expect(port.disconnect).not.toHaveBeenCalled();
      expect(port.onMessage.listeners.size).toBe(1);
    }
  });
});

describe('the messages only the extension sends', () => {
  it('are left unanswered from a content script: no summary, no watch started or cancelled', async () => {
    for (const sender of [PAGE_TOP, PAGE_DISGUISED]) {
      expect(await message({ type: SUMMARIZE, transcript: 'x', model: 'm', maxWords: 10 }, sender)).toEqual({ answered: false, reply: undefined });
      expect(await message({ type: WATCH_START, settings: { tabId: 7 } }, sender)).toEqual({ answered: false, reply: undefined });
      expect(await message({ type: WATCH_CANCEL, id: 'w1' }, sender)).toEqual({ answered: false, reply: undefined });
    }
    expect(createProvider).not.toHaveBeenCalled();
    expect(storage.local.data).toEqual({});
  });

  it("are answered from the extension's pages", async () => {
    expect((await message({ type: SUMMARIZE, transcript: 'x', model: 'm', maxWords: 10 }, PANEL)).answered).toBe(true);
    expect((await message({ type: WATCH_START, settings: { tabId: 7 } }, PANEL)).answered).toBe(true);
  });
});
