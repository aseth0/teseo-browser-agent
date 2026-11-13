// Calling the bubble back on a site where it is hidden: a page there has nothing of the widget (not
// even a listener), so the background does it. The shortcut shows the site again instead of messaging
// the page; a site shown again (Settings → Bubble, the shortcut, the chat floated there) gets the widget
// put into its open tabs; floating the chat on such a page shows the site again and floats it once the
// widget is there.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeEvent, fakeStorage } from './fakes/browser';

const storage = fakeStorage();
const tabs = [
  { id: 1, url: 'https://shop.example.com/item', active: true },
  { id: 2, url: 'https://shop.example.com/cart' },
  { id: 3, url: 'https://news.example.com/' },
];
const executeScript = vi.fn(async (_o: { target: { tabId: number } }) => []);
const sendMessage = vi.fn(async (_tabId: number, _msg: unknown): Promise<unknown> => undefined);
const onCommand = fakeEvent<(command: string, tab?: unknown) => void>();
const event = () => fakeEvent();
vi.mock('wxt/browser', () => ({
  browser: fakeBrowser(storage, {
    runtime: { id: 'ext', onMessage: event(), onInstalled: event(), getURL: (p: string) => `chrome-extension://ext${p}`, getManifest: () => ({ commands: {} }) },
    permissions: { onAdded: event(), onRemoved: event() },
    commands: { onCommand },
    tabs: {
      onRemoved: event(),
      get: async (id: number) => tabs.find((t) => t.id === id),
      query: async (q: { active?: boolean; url?: string[] }) => tabs.filter((t) => (q.active === undefined || !!t.active === q.active) && (!q.url || q.url.length > 0)),
      sendMessage,
    },
    scripting: { getRegisteredContentScripts: async () => [{ id: 'page-widget', matches: ['https://*.example.com/*'] }], executeScript },
  }),
}));
vi.stubGlobal('location', { origin: 'chrome-extension://ext' }); // the background: its places changed in place
vi.mock('../src/widget/store', async (original) => ({ ...(await original<object>()), syncWidgetScript: async () => undefined }));
vi.mock('../src/agents/profiles', () => ({ agentStore: { load: async () => [], onChanged: () => undefined } }));
vi.mock('../src/background/settings', () => ({ settingsNow: async () => ({}) }));

const { WIDGET_COMMAND, FLOAT_COMMAND, WIDGET_FLOAT, WIDGET_PLACES, WIDGET_TOGGLE } = await import('../src/widget/protocol');
const { changePlace, loadPlaces } = await import('../src/widget/places');
const { hostWidget } = await import('../src/background/widget-host');
const { floatOnTab } = await import('../src/widget/float');
hostWidget(() => undefined);

const injected = () => executeScript.mock.calls.map(([o]) => o.target.tabId);
const settle = () => new Promise((r) => setTimeout(r, 20));

beforeEach(async () => {
  storage.reset();
  await storage.local.set({ [WIDGET_PLACES]: { 'shop.example.com': { x: 5, hidden: true } } });
  executeScript.mockClear();
  sendMessage.mockReset();
});

describe('the shortcut on a site where the bubble is hidden', () => {
  it('shows the site again and puts the widget into its open tabs, without messaging the page', async () => {
    onCommand.emit(WIDGET_COMMAND);
    await settle();
    expect((await loadPlaces())['shop.example.com']).toEqual({ x: 5, hidden: false });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(injected().sort()).toEqual([1, 2]); // not the other site's tab
  });
  it('where it shows, it asks the page to hide it, as before', async () => {
    await changePlace('shop.example.com', { hidden: false });
    executeScript.mockClear();
    onCommand.emit(WIDGET_COMMAND);
    await settle();
    expect(sendMessage).toHaveBeenCalledWith(1, { type: WIDGET_TOGGLE });
    expect(injected()).toEqual([]);
  });
});

describe('a site shown again', () => {
  it('from Settings → Bubble: its open tabs get the widget', async () => {
    await changePlace('shop.example.com', { hidden: false });
    await settle();
    expect(injected().sort()).toEqual([1, 2]);
  });
  it('another change (moved, hidden, another site) puts nothing anywhere', async () => {
    await changePlace('shop.example.com', { x: 9 });
    await changePlace('news.example.com', { hidden: true });
    await settle();
    expect(injected()).toEqual([]);
  });
});

describe('floating the chat on a page whose site has the bubble hidden', () => {
  it('shows the site again and floats it once the widget is back in the page', async () => {
    let calls = 0;
    sendMessage.mockImplementation(async () => (++calls < 3 ? Promise.reject(new Error('Could not establish connection. Receiving end does not exist.')) : { floated: true }));
    expect(await floatOnTab(1)).toBe(true);
    expect((await loadPlaces())['shop.example.com']!.hidden).toBe(false);
    expect(sendMessage).toHaveBeenLastCalledWith(1, { type: WIDGET_FLOAT });
  });
  it('the shortcut likewise, folding or unfolding as it does', async () => {
    let calls = 0;
    sendMessage.mockImplementation(async () => (++calls < 2 ? Promise.reject(new Error('no widget')) : { floated: true }));
    onCommand.emit(FLOAT_COMMAND);
    await vi.waitFor(() => expect(calls).toBe(2));
    expect((await loadPlaces())['shop.example.com']!.hidden).toBe(false);
    expect(sendMessage).toHaveBeenCalledWith(1, { type: WIDGET_FLOAT, toggle: true });
  });
  it('a page without the widget on a site where it shows: false at once, nothing changed', async () => {
    sendMessage.mockImplementation(async () => Promise.reject(new Error('no widget')));
    expect(await floatOnTab(3)).toBe(false);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect((await loadPlaces())['news.example.com']).toBeUndefined();
  });
});
