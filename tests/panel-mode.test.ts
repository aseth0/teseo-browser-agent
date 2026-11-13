import { describe, expect, it, vi } from 'vitest';
import { fakeEvent } from './fakes/browser';

// The side panel's shortcut (⌥⇧A): it opens the panel of the tab it was pressed on, the toolbar button
// having a popup of its own.
const onCommand = fakeEvent<(command: string, tab?: { id?: number; windowId: number }) => void>();
const open = vi.fn(async () => undefined);
const onMessage = fakeEvent<(msg: unknown, sender: { url?: string }, sendResponse: (reply: unknown) => void) => unknown>();
vi.mock('wxt/browser', () => ({
  browser: {
    sidePanel: { open, setOptions: vi.fn(async () => undefined), setPanelBehavior: vi.fn(async () => undefined) },
    tabs: { query: vi.fn(async () => []) },
    commands: { onCommand },
    runtime: { onMessage, getURL: (path: string) => `chrome-extension://ext${path}` },
    storage: { local: { get: vi.fn(async () => ({})) }, session: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) }, onChanged: fakeEvent() },
  },
}));
vi.mock('../src/storage/settings', () => ({ loadSettings: () => new Promise(() => undefined), onSettingsChanged: () => () => undefined }));
const { listenPanelMode, panelFollowsNow } = await import('../src/background/panel-mode');
const { PANEL_COMMAND } = await import('../src/core/side-panel');
const { CLOSE_WINDOW_PANEL } = await import('../src/core/protocol');

describe('the side panel shortcut', () => {
  it("opens the window's side panel (the pin on, or not known yet), at once", () => {
    listenPanelMode();
    onCommand.emit(PANEL_COMMAND, { id: 3, windowId: 9 });
    expect(open).toHaveBeenCalledWith({ windowId: 9 });
    onCommand.emit('float-chat', { id: 3, windowId: 9 });
    expect(open).toHaveBeenCalledTimes(1);
  });
  // A click that woke the worker comes before the settings are read: the pin is not known then, so
  // that what it hands over is addressed to either panel (capture/plan chatTarget).
  it('while the pin is not known yet (the settings not read)', () => {
    expect(panelFollowsNow()).toBeUndefined();
  });
});

// Float on this page, in Vivaldi: the panel asks the background to close it, as the shortcut does
// (closed from inside, its web panel loses the page).
describe("closing the window's side panel for it", () => {
  it('closes it from an extension page, at once', async () => {
    listenPanelMode();
    open.mockClear();
    const reply = vi.fn();
    onMessage.emit({ type: CLOSE_WINDOW_PANEL, windowId: 9 }, { url: 'chrome-extension://ext/sidepanel.html' }, reply);
    expect(open).toHaveBeenCalledWith({ windowId: 9 });
    await vi.waitFor(() => expect(reply).toHaveBeenCalledWith({ closed: true }));
  });

  it('not from a web page', () => {
    listenPanelMode();
    open.mockClear();
    onMessage.emit({ type: CLOSE_WINDOW_PANEL, windowId: 9 }, { url: 'https://example.com/' }, vi.fn());
    expect(open).not.toHaveBeenCalled();
  });
});
