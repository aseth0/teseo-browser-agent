// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

// The toolbar button's popup: a tile per place the chat opens in, Settings, and the agent manager.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const opened = { fullChat: vi.fn(async () => undefined), manager: vi.fn(async () => undefined), options: vi.fn(async (_s?: string) => undefined) };
let url = 'https://shop.example.com/a';
let panelShown = false; // the window's side panel shows, where opening it would close it (background/panel-windows)
const sendMessage = vi.fn(async (m: unknown): Promise<unknown> => ((m as { type: string }).type === PANEL_SHOWN ? { shown: panelShown } : { started: true }));
// The sites granted (origin patterns); a request grants it and tells the listeners, as the browser does.
const { fakeEvent } = await import('./fakes/browser');
const granted = new Set(['https://shop.example.com/*']);
const onAdded = fakeEvent<() => void>();
const permissions = {
  contains: async ({ origins }: { origins: string[] }) => origins.every((o) => granted.has(o)),
  request: vi.fn(async ({ origins }: { origins: string[] }) => (origins.forEach((o) => granted.add(o)), onAdded.emit(), true)),
  onAdded, onRemoved: fakeEvent(),
};
vi.mock('wxt/browser', () => ({
  browser: { runtime: { sendMessage }, tabCapture: {}, offscreen: {}, permissions, commands: { getAll: async () => [{ name: 'capture-visible', shortcut: 'Alt+Shift+S' }, { name: 'capture-section', shortcut: '' }] } },
}));
let settings: unknown;
vi.mock('../src/ui/useSettings', () => ({ useSettings: () => [settings, vi.fn()] }));
vi.mock('../src/ui/appearance', () => ({ useAppearance: () => undefined }));
vi.mock('../src/ui/active-tab', () => ({ activeTab: async () => ({ id: 4, windowId: 2, url }) }));
vi.mock('../src/browser/open-manager', () => ({ openFullChat: opened.fullChat, openManager: opened.manager }));
vi.mock('../src/ui/open-options', () => ({ openOptions: opened.options }));
const openSidePanel = vi.fn(async (_tab: unknown, _follows: boolean, _shown?: boolean) => undefined);
vi.mock('../src/core/side-panel', () => ({ openSidePanel, PANEL_COMMAND: 'open-side-panel' }));
let recording: unknown;
vi.mock('../src/ui/useRecordingStatus', () => ({ useRecordingStatus: () => recording }));
vi.mock('../src/ui/useAudioStatus', () => ({ useAudioStatus: () => undefined }));
let speaking: unknown;
vi.mock('../src/ui/useSpeakStatus', () => ({ useSpeakStatus: () => speaking }));
const actions = { floatChat: vi.fn(async (_tabId: number) => false), whyNoFloat: vi.fn(async (_url: string) => 'bubble' as const), enableAndFloat: vi.fn(async (_tabId: number, _url: string) => 'floated' as const) };
vi.mock('../src/ui/popup-actions', () => actions);
const { CAPTURE, PANEL_SHOWN } = await import('../src/core/protocol');
const { Popup } = await import('../src/entrypoints/popup/Popup');

async function show() {
  const box = document.createElement('div');
  await act(async () => createRoot(box).render(createElement(Popup)));
  const item = (name: string) => box.querySelector<HTMLButtonElement>(`[role="menuitem"][aria-label="${name}"]`)!;
  return { box, item };
}

describe('the popup', () => {
  it('a tile per place the chat opens in, each with its full meaning', async () => {
    const { box } = await show();
    const tiles = [...box.querySelectorAll<HTMLButtonElement>('.popup-tile')];
    // Panel marked: the bubble opens the chat there by default.
    expect(tiles.map((t) => [t.textContent, t.title])).toEqual([
      ['Page', 'Chat on this page'], ['Panel', 'Chat in the side panel (where the bubble opens it)'], ['Full screen', 'Chat full screen in a tab'],
    ]);
    expect(tiles.map((t) => t.classList.contains('default'))).toEqual([false, true, false]);
    expect(tiles.every((t) => t.getAttribute('role') === 'menuitem' && !t.disabled)).toBe(true);
  });
  it('full screen opens the chat in a tab and closes the popup', async () => {
    const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    const { item } = await show();
    await act(async () => item('Chat full screen in a tab').click());
    expect(opened.fullChat).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });
  it('the panel tile opens the side panel, or leaves it open where it shows and opening it would close it (Vivaldi)', async () => {
    vi.spyOn(window, 'close').mockImplementation(() => undefined);
    const { item } = await show();
    await act(async () => item('Chat in the side panel').click());
    expect(sendMessage).toHaveBeenCalledWith({ type: PANEL_SHOWN, windowId: 2 });
    expect(openSidePanel).toHaveBeenLastCalledWith(expect.objectContaining({ id: 4, windowId: 2 }), true, false);
    panelShown = true;
    const again = await show();
    await act(async () => again.item('Chat in the side panel').click());
    expect(openSidePanel).toHaveBeenLastCalledWith(expect.objectContaining({ id: 4, windowId: 2 }), true, true);
    panelShown = false;
  });
  it('the gear opens Settings; the last row, the agent manager', async () => {
    const { box, item } = await show();
    await act(async () => item('Settings').click());
    expect(opened.options).toHaveBeenCalledWith(undefined);
    const agents = [...box.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].at(-1)!;
    expect(agents.textContent).toBe('Agents Panel');
    await act(async () => agents.click());
    expect(opened.manager).toHaveBeenCalled();
  });
  it('the page tile is off where the chat cannot float', async () => {
    url = 'chrome://extensions/';
    const { item } = await show();
    expect(item('Chat on this page').disabled).toBe(true);
    url = 'https://shop.example.com/a';
  });
});

describe("the popup's site line", () => {
  const line = (box: HTMLElement) => box.querySelector('.popup-site');
  it('none on a site granted', async () => {
    const { box } = await show();
    expect(line(box)).toBeNull();
  });
  it('a site not enabled: said, and Enable it asks for that site only, inside the click; the line goes once granted', async () => {
    url = 'https://news.example.com/a';
    const { box, item } = await show();
    expect(line(box)!.textContent).toBe('news.example.com is not enabled' + 'Enable it');
    await act(async () => item('Enable news.example.com').click());
    expect(permissions.request).toHaveBeenCalledWith({ origins: ['https://news.example.com/*'] });
    expect(line(box)).toBeNull();
    granted.delete('https://news.example.com/*');
    url = 'https://shop.example.com/a';
  });
  it('granted from elsewhere meanwhile (Settings): the line goes', async () => {
    url = 'https://news.example.com/a';
    const { box } = await show();
    expect(line(box)).not.toBeNull();
    granted.add('<all_urls>');
    await act(async () => onAdded.emit());
    expect(line(box)).toBeNull();
    granted.delete('<all_urls>');
    url = 'https://shop.example.com/a';
  });
  it('a page no extension may reach: said, with nothing to do', async () => {
    for (const u of ['chrome://extensions/', 'about:blank', 'file:///tmp/a.html', 'https://chromewebstore.google.com/detail/x']) {
      url = u;
      const { box } = await show();
      expect(line(box)!.textContent).toBe("Teseo can't work on this page");
      expect(line(box)!.querySelector('button')).toBeNull();
    }
    url = 'https://shop.example.com/a';
  });
  it('Page on a site not enabled asks for it and floats the chat', async () => {
    url = 'https://news.example.com/a';
    const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    const { item } = await show();
    await act(async () => item('Chat on this page').click());
    expect(actions.enableAndFloat).toHaveBeenCalledWith(4, 'https://news.example.com/a');
    expect(actions.floatChat).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
    url = 'https://shop.example.com/a';
  });
  it('Page on a site granted with the bubble off there: said', async () => {
    const { box, item } = await show();
    await act(async () => item('Chat on this page').click());
    expect(box.querySelector('[role="status"]')!.textContent).toContain('The bubble is off on this site.');
  });
  it('hidden from Settings → Appearance → Popup', async () => {
    url = 'https://news.example.com/a';
    settings = { providers: [], systemPrompt: '', popup: { hidden: ['site-access'] } };
    const { box } = await show();
    expect(line(box)).toBeNull();
    settings = undefined;
    url = 'https://shop.example.com/a';
  });
});

describe("the popup's screenshots", () => {
  it('a row of them, each named with its shortcut when it has one', async () => {
    const { box } = await show();
    const row = box.querySelector('[role="group"][aria-label="Screenshot"]')!;
    expect(row.textContent).toContain('Screenshot');
    const names = [...row.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].map((b) => [b.title, b.getAttribute('aria-label')]);
    expect(names).toEqual([['Section', 'Section'], ['Visible (Alt+Shift+S)', 'Visible (Alt+Shift+S)'], ['Full page', 'Full page']]);
  });
  it('one asks the background to capture the tab, then the popup closes', async () => {
    const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    const { item } = await show();
    await act(async () => item('Full page').click());
    expect(sendMessage).toHaveBeenCalledWith({ type: CAPTURE, kind: 'full-page', tabId: 4, windowId: 2 });
    expect(close).toHaveBeenCalled();
  });
  it('off where the page cannot be captured', async () => {
    url = 'chrome://extensions/';
    const { item } = await show();
    expect(['Section', 'Visible (Alt+Shift+S)', 'Full page'].every((n) => item(n).disabled)).toBe(true);
    url = 'https://shop.example.com/a';
  });
});

describe('what the popup shows (Settings → Appearance → Popup)', () => {
  const names = (box: HTMLElement) => [...box.querySelectorAll('[role="menuitem"]')].map((b) => b.getAttribute('aria-label') ?? b.textContent);
  it('leaves out what is hidden, and a block with nothing left', async () => {
    settings = { providers: [], systemPrompt: '', popup: { hidden: ['page', 'full-screen', 'visible', 'audio', 'requests', 'agents'] } };
    const { box } = await show();
    expect(names(box)).toEqual(['Settings', 'Chat in the side panel', 'Section', 'Full page']);
    expect(box.querySelector('[aria-label="Screenshot"] .popup-row-sub')!.textContent).toBe('Section, full page');
    settings = { providers: [], systemPrompt: '', popup: { hidden: ['screenshot', 'audio', 'requests'] } };
    const none = await show();
    expect(none.box.querySelector('.popup-rows')!.childElementCount).toBe(0);
    settings = undefined;
  });
  it('a hidden line shows while it is busy', async () => {
    settings = { providers: [], systemPrompt: '', popup: { hidden: ['requests'] } };
    recording = { state: 'recording', tabId: 4, windowId: 2, tabs: [4], site: 'shop.example.com', calls: 2, leftOut: 0, startedAt: Date.now(), preset: 'API calls', mode: 'tab' };
    const { item } = await show();
    expect(item('Stop recording')).not.toBeNull();
    recording = undefined;
    settings = undefined;
  });
  it('a reading aloud shows how far it is, and its Stop', async () => {
    settings = { providers: [], systemPrompt: '' };
    const { item } = await show();
    expect(item('Stop reading aloud')).toBeNull();
    speaking = { run: 'r', state: 'reading', piece: 2, total: 5, startedAt: 1 };
    const again = await show();
    expect(again.box.textContent).toContain('Reading 2 of 5');
    sendMessage.mockClear();
    (again.item('Stop reading aloud') as HTMLButtonElement).click();
    expect(sendMessage).toHaveBeenCalledWith({ type: 'browser-agent:speak-stop' });
    speaking = undefined;
    settings = undefined;
  });
  it('without the keys or the titles, by class', async () => {
    settings = { providers: [], systemPrompt: '', popup: { noShortcuts: true, noTitles: true } };
    const { box } = await show();
    expect([...box.querySelector('.popup')!.classList]).toEqual(['popup', 'no-shortcuts', 'no-titles']);
    settings = undefined;
  });
  it("where the browser cannot capture a tab's audio: its line greyed, saying why, until hidden", async () => {
    const { browser } = await import('wxt/browser');
    const api = browser as unknown as Record<string, unknown>;
    const { tabCapture, offscreen } = api;
    delete api.tabCapture;
    delete api.offscreen;
    try {
      settings = { providers: [], systemPrompt: '' };
      const { box } = await show();
      const line = box.querySelector('.popup-row.off[aria-label="Audio"]')!;
      expect(line.getAttribute('aria-disabled')).toBe('true');
      expect(line.textContent).toContain("Tab's audio");
      // The notice's sentence, without "See the documentation." (no link in the popup); whole in the mark's title.
      expect(line.querySelector('.popup-row-sub')?.textContent).toBe('This feature is not available in your browser.');
      expect(line.querySelector('.feature-mark')?.getAttribute('title')).toBe('This feature is not available in your browser. See the documentation.');
      expect(line.querySelector('button')).toBeNull();
      settings = { providers: [], systemPrompt: '', popup: { hidden: ['audio'] } };
      expect((await show()).box.querySelector('[aria-label="Audio"]')).toBeNull();
    } finally {
      Object.assign(api, { tabCapture, offscreen });
      settings = undefined;
    }
  });
});
