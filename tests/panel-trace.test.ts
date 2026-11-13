// The side panel's trace (background/panel-trace): where the browser hosts the panel in a tab (Vivaldi),
// opening it while it shows closes it, so each open the background asks for is kept with what asked and
// what the worker knew then, next to the worker's starts, the runs and each window panel's state. The
// next time the panel closes unasked, the trace says whether the extension closed it, or the browser.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeEvent, fakePort, fakeStorage } from './fakes/browser';

const storage = fakeStorage();
const onConnect = fakeEvent<(port: ReturnType<typeof fakePort>) => void>();
const onMessage = fakeEvent<(msg: unknown, sender: { url?: string }, reply: (r: unknown) => void) => unknown>();
const open = vi.fn(async (_o: unknown) => undefined);
vi.mock('wxt/browser', () => ({
  browser: {
    storage,
    sidePanel: { open, setOptions: vi.fn(async () => undefined) },
    runtime: { onConnect, onMessage, sendMessage: vi.fn(async () => undefined), getURL: (p: string) => `chrome-extension://ext${p}` },
  },
}));
vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] }); // the hello's wait, held until a test lets it end
vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));
const { listenPanelWindows } = await import('../src/background/panel-windows');
const { PANEL_TRACE_KEY, PANEL_TRACE_MAX, panelTraced, tracePanel } = await import('../src/background/panel-trace');
const { openSidePanel, closeWindowPanel } = await import('../src/core/side-panel');
const { WINDOW_PANEL_PORT } = await import('../src/core/protocol');

const PANEL = { url: 'chrome-extension://ext/sidepanel.html', tab: { id: 50 } };
listenPanelWindows();
const trace = async () => {
  await panelTraced();
  return (storage.session.data[PANEL_TRACE_KEY] ?? []) as Record<string, unknown>[];
};
const started = await trace();

beforeEach(() => {
  storage.session.data[PANEL_TRACE_KEY] = [];
  open.mockClear();
});

describe("the side panel's trace", () => {
  it("starts with the worker's start, the panels asked again", () => {
    expect(started).toEqual([{ at: '2026-01-02T03:04:05.000Z', event: 'worker-start' }]);
  });

  it("keeps each window panel's state as it says it, and its port going", async () => {
    const port = fakePort(WINDOW_PANEL_PORT, PANEL);
    onConnect.emit(port);
    port.onMessage.emit({ windowId: 2, shown: true });
    port.onMessage.emit({ windowId: 2, shown: true }); // the same again: nothing new
    port.onMessage.emit({ windowId: 2, shown: false });
    port.onDisconnect.emit();
    expect((await trace()).map(({ at: _at, ...e }) => e)).toEqual([
      { event: 'panel', windowId: 2, shown: true },
      { event: 'panel', windowId: 2, shown: false },
      { event: 'panel-gone', windowId: 2 },
    ]);
  });

  it('keeps an open asked while the worker has just started: it knew no panel shown, the panels not answered yet', async () => {
    await openSidePanel({ id: 8, windowId: 3 }, undefined, false, 'capture');
    const calls = (await trace()).map(({ at: _at, ...e }) => e);
    expect(calls).toEqual([{ event: 'call', call: 'open', by: 'capture', windowId: 3, tabId: 8, shownIn: [], hello: true }]);
    await vi.advanceTimersByTimeAsync(100); // the hello's wait over, for the tests after
  });

  it('keeps each open the background asks for: what asked, the pin, and the windows it knew shown', async () => {
    const port = fakePort(WINDOW_PANEL_PORT, PANEL);
    onConnect.emit(port);
    port.onMessage.emit({ windowId: 2, shown: true });
    await openSidePanel({ id: 7, windowId: 2 }, true, true, 'alert');
    await openSidePanel({ id: 8, windowId: 3 }, undefined, false, 'capture');
    await closeWindowPanel(2);
    port.onDisconnect.emit();
    const calls = (await trace()).filter((e) => e.event === 'call').map(({ at: _at, ...e }) => e);
    expect(calls).toEqual([
      { event: 'call', call: 'left-open', by: 'alert', windowId: 2, tabId: 7, follows: true, shownIn: [2], hello: false },
      { event: 'call', call: 'open', by: 'capture', windowId: 3, tabId: 8, shownIn: [2], hello: false },
      { event: 'call', call: 'close', windowId: 2, shownIn: [2], hello: false },
    ]);
    expect(open).toHaveBeenCalledTimes(2); // the one left open is not asked of the browser
  });

  it('keeps the last ones only', async () => {
    for (let i = 0; i < PANEL_TRACE_MAX + 5; i++) tracePanel({ event: 'run', n: i });
    const kept = await trace();
    expect(kept).toHaveLength(PANEL_TRACE_MAX);
    expect(kept[0]).toMatchObject({ n: 5 });
    expect(kept.at(-1)).toMatchObject({ n: PANEL_TRACE_MAX + 4 });
  });

  it('a trace that cannot be written is left out, and the next ones still are', async () => {
    const set = vi.spyOn(storage.session, 'set').mockRejectedValueOnce(new Error('quota'));
    tracePanel({ event: 'run', n: 1 });
    tracePanel({ event: 'run', n: 2 });
    expect((await trace()).map((e) => e.n)).toEqual([2]);
    set.mockRestore();
  });
});
