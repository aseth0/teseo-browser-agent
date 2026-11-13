// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeEvent } from './fakes/browser';

// The window's side panel, where the browser hosts it in a tab (Vivaldi), tells the background whether
// it shows (background/panel-windows); Chrome's, in no tab, says nothing.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Port = { name: string; postMessage: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; onDisconnect: ReturnType<typeof fakeEvent> };
const ports: Port[] = [];
const connect = vi.fn(({ name }: { name: string }) => {
  const port = { name, postMessage: vi.fn(), disconnect: vi.fn(), onDisconnect: fakeEvent() };
  ports.push(port);
  return port;
});
const onMessage = fakeEvent<(msg: unknown, sender: object, reply: (r: unknown) => void) => unknown>();
let host: { id: number; windowId: number } | undefined;
vi.mock('wxt/browser', () => ({ browser: { runtime: { connect, onMessage }, tabs: { getCurrent: async () => host } } }));
const frame = { FLOATING: false, MANAGER: false, FULL: false, PREVIEW: false };
vi.mock('../src/ui/floating-frame', () => frame);
vi.mock('../src/entrypoints/sidepanel/usePageTarget', () => ({ WINDOW_PANEL: true }));
let visibility: DocumentVisibilityState = 'visible';
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });

const { WINDOW_PANEL_PORT, PANEL_HELLO } = await import('../src/core/protocol');

const mount = async () => {
  const { usePanelPresence } = await import('../src/entrypoints/sidepanel/usePanelPresence');
  const Probe = () => (usePanelPresence(), null);
  const root = createRoot(document.createElement('div'));
  await act(async () => root.render(createElement(Probe)));
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  return root;
};

beforeEach(() => {
  ports.length = 0;
  visibility = 'visible';
  host = { id: 50, windowId: 2 };
});

describe('usePanelPresence', () => {
  it('hosted in a tab: says it shows, then each change, again to a worker that has just started, and goes with the panel', async () => {
    const root = await mount();
    expect(connect).toHaveBeenCalledWith({ name: WINDOW_PANEL_PORT });
    expect(ports[0]!.postMessage).toHaveBeenCalledWith({ windowId: 2, shown: true });
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(ports[0]!.postMessage).toHaveBeenLastCalledWith({ windowId: 2, shown: false });
    ports[0]!.onDisconnect.emit(); // the worker stopped
    visibility = 'visible';
    onMessage.emit({ type: PANEL_HELLO }, {}, () => undefined);
    expect(ports).toHaveLength(2);
    expect(ports[1]!.postMessage).toHaveBeenCalledWith({ windowId: 2, shown: true });
    await act(async () => root.unmount());
    expect(ports[1]!.disconnect).toHaveBeenCalled();
    onMessage.emit({ type: PANEL_HELLO }, {}, () => undefined);
    expect(ports).toHaveLength(2);
  });

  // A worker woken by a shortcut (a capture's) cannot wait for the panels to answer its hello: it would
  // open the panel that shows, which closes it there. Told again while it shows, the worker stays awake.
  it('while it shows, says so again before the worker would stop, so that it knows; hidden, it lets it stop', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const root = await mount();
      const port = ports.at(-1)!;
      port.postMessage.mockClear();
      await act(async () => vi.advanceTimersByTimeAsync(20_000));
      expect(port.postMessage).toHaveBeenCalledWith({ windowId: 2, shown: true });
      visibility = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
      port.postMessage.mockClear();
      await act(async () => vi.advanceTimersByTimeAsync(60_000));
      expect(port.postMessage).not.toHaveBeenCalled();
      await act(async () => root.unmount());
      visibility = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
      await act(async () => vi.advanceTimersByTimeAsync(60_000));
      expect(port.postMessage).not.toHaveBeenCalled(); // gone with the panel
    } finally {
      vi.useRealTimers();
    }
  });

  it("Chrome's side panel (in no tab) says nothing", async () => {
    host = undefined;
    connect.mockClear();
    await mount();
    expect(connect).not.toHaveBeenCalled();
  });

  it('nor the chat full screen in a tab, which is no side panel', async () => {
    vi.resetModules();
    frame.FULL = true;
    connect.mockClear();
    await mount();
    expect(connect).not.toHaveBeenCalled();
    frame.FULL = false;
  });
});
