import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeEvent } from './fakes/browser';

// A command run by its browser shortcut, or by a key set in Settings → Shortcuts: pressed in a page
// (its content script) or in one of the extension's own pages.
type Tab = { id?: number; windowId: number };
type Sender = { url?: string; frameId?: number; tab?: { id: number; windowId: number } };
const onCommand = fakeEvent<(command: string, tab?: Tab) => void>();
const onMessage = fakeEvent<(msg: unknown, sender: Sender, reply: (r: unknown) => void) => unknown>();
let active: Tab | undefined = { id: 9, windowId: 4 };
const query = vi.fn(async () => (active ? [active] : []));
// The keys set in Settings → Shortcuts: none for 'record-tab'.
const onChanged = fakeEvent<(changes: Record<string, { newValue?: unknown }>, area: string) => void>();
const stored = { 'open-side-panel': { code: 'KeyP', alt: true }, 'capture-visible': { code: 'KeyC', alt: true } };
vi.mock('wxt/browser', () => ({
  browser: {
    storage: { local: { get: async () => ({ pageKeys: stored }) }, onChanged },
    commands: { onCommand },
    tabs: { query },
    runtime: {
      onMessage,
      getURL: (p: string) => `chrome-extension://ext${p}`,
      getManifest: () => ({ commands: { _execute_action: {}, 'open-side-panel': {}, 'capture-visible': {}, 'record-tab': {} } }),
    },
  },
}));
const { onShortcut, listenPageKeys } = await import('../src/background/shortcuts');
const { PAGE_KEY } = await import('../src/core/protocol');

const heard = vi.fn();
onShortcut(heard);
listenPageKeys();
await new Promise((r) => setTimeout(r, 0)); // the keys set, read
beforeEach(() => {
  vi.clearAllMocks();
  active = { id: 9, windowId: 4 };
});
const press = (command: string, sender: Sender) => onMessage.emit({ type: PAGE_KEY, command }, sender, () => undefined);
const page = { url: 'https://example.com/', frameId: 0, tab: { id: 7, windowId: 2 } };

describe("a command's browser shortcut", () => {
  it('runs it on the tab it was pressed on', () => {
    onCommand.emit('capture-visible', { id: 7, windowId: 2 });
    expect(heard).toHaveBeenCalledWith('capture-visible', { id: 7, windowId: 2 }, 'browser');
  });
});

describe('a key set here, pressed in a page', () => {
  it('runs its command on that tab at once, inside the key press', () => {
    press('open-side-panel', page);
    expect(heard).toHaveBeenCalledWith('open-side-panel', { id: 7, windowId: 2 }, 'page');
  });
  it('in a frame of the page too', () => {
    press('capture-visible', { ...page, frameId: 3 });
    expect(heard).toHaveBeenCalledWith('capture-visible', { id: 7, windowId: 2 }, 'page');
  });
  it('only for the commands the extension has, never the toolbar button', () => {
    press('remove-everything', page);
    press('_execute_action', page);
    expect(heard).not.toHaveBeenCalled();
  });
  it('only for a command a key is set for here: a page cannot run the others', () => {
    press('record-tab', page);
    press('record-tab', { url: 'chrome-extension://ext/options.html', frameId: 0, tab: { id: 5, windowId: 2 } });
    expect(heard).not.toHaveBeenCalled();
  });
  it('a key set since counts at once, one removed no more', () => {
    onChanged.emit({ pageKeys: { newValue: { 'record-tab': { code: 'KeyR', alt: true } } } }, 'local');
    press('record-tab', page);
    expect(heard).toHaveBeenCalledWith('record-tab', { id: 7, windowId: 2 }, 'page');
    heard.mockClear();
    onChanged.emit({ pageKeys: { newValue: stored } }, 'local');
    press('record-tab', page);
    expect(heard).not.toHaveBeenCalled();
  });
});

describe("a key set here, pressed in the extension's own pages", () => {
  const settings = { url: 'chrome-extension://ext/options.html', frameId: 0, tab: { id: 5, windowId: 2 } };
  const panel = { url: 'chrome-extension://ext/sidepanel.html' };
  it('opens the side panel in their window at once', () => {
    press('open-side-panel', settings);
    expect(heard).toHaveBeenCalledWith('open-side-panel', { id: 5, windowId: 2 }, 'page');
    expect(query).not.toHaveBeenCalled();
  });
  it('the side panel itself has no window of its own to open it in: nothing', () => {
    press('open-side-panel', panel);
    expect(heard).not.toHaveBeenCalled();
  });
  it('other commands run on the active tab, as the browser shortcut does', async () => {
    press('capture-visible', panel);
    await vi.waitFor(() => expect(heard).toHaveBeenCalledWith('capture-visible', { id: 9, windowId: 4 }, 'page'));
    expect(query).toHaveBeenCalledWith({ active: true, lastFocusedWindow: true });
  });
  it('no active tab: nothing', async () => {
    active = undefined;
    press('capture-visible', panel);
    await vi.waitFor(() => expect(query).toHaveBeenCalled());
    expect(heard).not.toHaveBeenCalled();
  });
});
