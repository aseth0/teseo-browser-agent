// The windows whose side panel shows, where the browser hosts it in a tab (Vivaldi): there opening an
// open panel closes it, so the background must know, at once, which ones show.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { fakeEvent, fakePort } from './fakes/browser';

const onConnect = fakeEvent<(port: ReturnType<typeof fakePort>) => void>();
const onMessage = fakeEvent<(msg: unknown, sender: { url?: string }, reply: (r: unknown) => void) => unknown>();
const sendMessage = vi.fn(async (_m: unknown): Promise<unknown> => undefined);
vi.mock('wxt/browser', () => ({
  browser: { runtime: { onConnect, onMessage, sendMessage, getURL: (p: string) => `chrome-extension://ext${p}` } },
}));
const { listenPanelWindows, panelShownIn } = await import('../src/background/panel-windows');
const { PANEL_HELLO, PANEL_SHOWN, WINDOW_PANEL_PORT } = await import('../src/core/protocol');

const PANEL = { url: 'chrome-extension://ext/sidepanel.html', tab: { id: 50 } };
const POPUP = { url: 'chrome-extension://ext/popup.html' };
vi.useFakeTimers(); // the moment after the worker starts, held for the first test
listenPanelWindows();
const hello = [...sendMessage.mock.calls]; // mocks are cleared before each test
afterAll(() => vi.useRealTimers());

const connect = (sender: object = PANEL) => {
  const port = fakePort(WINDOW_PANEL_PORT, sender);
  onConnect.emit(port);
  return port;
};

const ask = (windowId: number, sender: object = PANEL) => {
  const reply = vi.fn();
  onMessage.emit({ type: PANEL_SHOWN, windowId }, sender, reply);
  return reply;
};

describe('a worker that has just started', () => {
  it('asks the panels again (it knows none), and PANEL_SHOWN waits for their answers, up to 100 ms', async () => {
    expect(hello).toEqual([[{ type: PANEL_HELLO }]]);
    const early = ask(2, POPUP);
    await vi.advanceTimersByTimeAsync(50);
    expect(early).not.toHaveBeenCalled();
    const port = connect(); // a panel answers the hello
    port.onMessage.emit({ windowId: 2, shown: true });
    expect(early).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);
    expect(early).toHaveBeenCalledWith({ shown: true });
    expect(ask(2, POPUP)).toHaveBeenCalledWith({ shown: true }); // from now on, at once
    port.onDisconnect.emit();
    vi.useRealTimers();
  });
});

describe('panelShownIn', () => {

  it('knows a window whose panel says it shows, until it hides or goes', () => {
    expect(panelShownIn(2)).toBe(false);
    const port = connect();
    port.onMessage.emit({ windowId: 2, shown: true });
    expect(panelShownIn(2)).toBe(true);
    expect(panelShownIn(3)).toBe(false);
    port.onMessage.emit({ windowId: 2, shown: false });
    expect(panelShownIn(2)).toBe(false);
    port.onMessage.emit({ windowId: 2, shown: true });
    port.onDisconnect.emit();
    expect(panelShownIn(2)).toBe(false);
  });

  it('a window keeps its panel while another of its ports is still there', () => {
    const old = connect();
    old.onMessage.emit({ windowId: 4, shown: true });
    const next = connect();
    next.onMessage.emit({ windowId: 4, shown: true });
    old.onDisconnect.emit();
    expect(panelShownIn(4)).toBe(true);
    next.onDisconnect.emit();
    expect(panelShownIn(4)).toBe(false);
  });

  it("never from a page's content script, nor what is not a panel's state", () => {
    const page = connect({ url: 'https://shop.example.com/', tab: { id: 7 } });
    expect(page.disconnect).toHaveBeenCalled();
    page.onMessage.emit({ windowId: 5, shown: true });
    const odd = connect();
    odd.onMessage.emit({ windowId: '5', shown: true });
    odd.onMessage.emit({ windowId: 5, shown: 'yes' });
    expect(panelShownIn(5)).toBe(false);
  });

  it('other ports are left to their own listeners', () => {
    const agent = fakePort('agent', PANEL);
    onConnect.emit(agent);
    agent.onMessage.emit({ windowId: 6, shown: true });
    expect(panelShownIn(6)).toBe(false);
  });
});

describe('PANEL_SHOWN', () => {
  it("answers the extension's pages (the toolbar popup) whether the window's panel shows", () => {
    const port = connect();
    port.onMessage.emit({ windowId: 8, shown: true });
    expect(ask(8, POPUP)).toHaveBeenCalledWith({ shown: true });
    expect(ask(9, POPUP)).toHaveBeenCalledWith({ shown: false });
    expect(ask(8, { url: 'https://shop.example.com/' })).not.toHaveBeenCalled();
    port.onDisconnect.emit();
  });
});
