import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeEvent } from './fakes/browser';

// What starts a screenshot into the chat: its keyboard shortcut, or the popup's buttons.
const onCommand = fakeEvent<(command: string, tab?: { id?: number; windowId: number }) => void>();
const onMessage = fakeEvent<(msg: unknown, sender: { url?: string; frameId?: number; tab?: { id: number; windowId?: number } }, reply: (r: unknown) => void) => unknown>();
const open = vi.fn(async (_o: unknown) => undefined);
vi.mock('wxt/browser', () => ({
  browser: {
    commands: { onCommand },
    sidePanel: { open },
    storage: { local: { get: async () => ({ pageKeys: { 'capture-visible': { code: 'KeyC', alt: true } } }) }, onChanged: fakeEvent() }, // its key set in Settings
    runtime: { onMessage, getURL: (p: string) => `chrome-extension://ext${p}`, getManifest: () => ({ commands: { 'capture-visible': {} } }) },
  },
}));
let stored: unknown;
vi.mock('../src/storage/area', () => ({ storageGet: async () => stored }));
vi.mock('../src/background/panel-mode', () => ({ panelFollowsNow: () => true }));
let shown = false; // the window's side panel shows, where opening it would close it (background/panel-windows)
vi.mock('../src/background/panel-windows', () => ({ panelShownIn: (windowId: number) => shown && windowId === 2 }));
const startCapture = vi.fn(async () => undefined);
vi.mock('../src/capture/run', () => ({ startCapture }));
const { hostCapture } = await import('../src/background/capture-host');
const { CAPTURE, CAPTURE_OPEN_CHAT, PAGE_KEY } = await import('../src/core/protocol');
const { listenPageKeys } = await import('../src/background/shortcuts');

hostCapture();
listenPageKeys();
await new Promise((r) => setTimeout(r, 0)); // the keys set, read
beforeEach(() => vi.clearAllMocks());

describe('a capture shortcut', () => {
  it('captures the tab it was pressed on, at once', () => {
    onCommand.emit('capture-visible', { id: 7, windowId: 2 });
    expect(startCapture).toHaveBeenCalledWith('visible', { id: 7, windowId: 2 }, { pageKey: false }, expect.anything());
  });
  it('or its key set in Settings, pressed in the page: said so (it needs access to every site)', () => {
    onMessage.emit({ type: PAGE_KEY, command: 'capture-visible' }, { url: 'https://example.com/', frameId: 0, tab: { id: 7, windowId: 2 } }, () => undefined);
    expect(startCapture).toHaveBeenCalledWith('visible', { id: 7, windowId: 2 }, { pageKey: true }, expect.anything());
  });
  it('other shortcuts, or no tab: nothing', () => {
    onCommand.emit('float-chat', { id: 7, windowId: 2 });
    onCommand.emit('capture-section', undefined);
    expect(startCapture).not.toHaveBeenCalled();
  });
});

describe("the popup's buttons", () => {
  const message = { type: CAPTURE, kind: 'full-page', tabId: 7, windowId: 2 };
  it('start it inside the click, and say so', () => {
    const reply = vi.fn();
    onMessage.emit(message, { url: 'chrome-extension://ext/popup.html' }, reply);
    expect(startCapture).toHaveBeenCalledWith('full-page', { id: 7, windowId: 2 }, {}, expect.anything());
    expect(reply).toHaveBeenCalledWith({ started: true });
  });
  it('only from the extension\'s pages', () => {
    onMessage.emit(message, { url: 'https://shop.example.com/', tab: { id: 7 } }, vi.fn());
    expect(startCapture).not.toHaveBeenCalled();
  });
});

describe('the page, once a section dragged on it is captured', () => {
  const page = { url: 'https://shop.example.com/', frameId: 0, tab: { id: 7, windowId: 2 } };
  const ask = async (sender: object) => {
    const reply = vi.fn();
    onMessage.emit({ type: CAPTURE_OPEN_CHAT }, sender as typeof page, reply);
    await vi.waitFor(() => expect(reply).toHaveBeenCalled());
    return reply.mock.calls[0]![0] as { opened: boolean };
  };
  it('opens the side panel inside the listener (the drag\'s gesture)', async () => {
    const answer = ask(page);
    expect(open).toHaveBeenCalledWith({ windowId: 2 });
    expect(await answer).toEqual({ opened: true });
  });
  it("showing already where opening it would close it (Vivaldi): left open, the capture goes there", async () => {
    shown = true;
    expect(await ask(page)).toEqual({ opened: true });
    expect(open).not.toHaveBeenCalled();
    shown = false;
  });
  it('refused: not opened while the capture waits for the chat; opened once a chat took it', async () => {
    open.mockRejectedValue(new Error('needs a user gesture'));
    stored = { at: 1, images: [] };
    expect(await ask(page)).toEqual({ opened: false });
    stored = undefined;
    expect(await ask(page)).toEqual({ opened: true });
    open.mockReset();
  });
  it("only from a page's top frame", () => {
    onMessage.emit({ type: CAPTURE_OPEN_CHAT }, { ...page, frameId: 3 }, vi.fn());
    onMessage.emit({ type: CAPTURE_OPEN_CHAT }, { url: 'chrome-extension://ext/popup.html' }, vi.fn());
    expect(open).not.toHaveBeenCalled();
  });
});
