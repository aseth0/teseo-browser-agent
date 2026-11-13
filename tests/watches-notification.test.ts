import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeEvent } from './fakes/browser';

// Clicking an ended watch's notification shows its tab, and the side panel when the browser lets it.
const onClicked = fakeEvent<(nid: string) => void>();
const open = vi.fn(async (_o: unknown) => undefined);
const update = vi.fn(async () => undefined);
vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { onMessage: fakeEvent(), getURL: (p: string) => `chrome-extension://ext${p}` },
    tabs: { onUpdated: fakeEvent(), onRemoved: fakeEvent(), get: async (id: number) => ({ id, windowId: 2 }), update },
    windows: { update },
    alarms: { onAlarm: fakeEvent() },
    notifications: { onClicked, clear: async () => true },
    sidePanel: { open },
  },
}));
vi.mock('../src/watches/store', () => ({ loadWatches: async () => [], loadEndedWatches: async () => [{ watch: { id: 'w1', tabId: 7 } }] }));
vi.mock('../src/background/panel-mode', () => ({ panelFollowsNow: () => true }));
let shown = false; // the window's side panel shows, where opening it would close it (background/panel-windows)
vi.mock('../src/background/panel-windows', () => ({ panelShownIn: (windowId: number) => shown && windowId === 2 }));
const { listenWatches } = await import('../src/background/watches');
const { WATCH_ALARM } = await import('../src/watches/run');

listenWatches();
beforeEach(() => {
  shown = false;
});

describe("an ended watch's notification", () => {
  it("shows its tab, then the window's side panel", async () => {
    onClicked.emit(WATCH_ALARM + 'w1');
    await vi.waitFor(() => expect(open).toHaveBeenCalledWith({ windowId: 2 }));
    expect(update).toHaveBeenCalledWith(7, { active: true });
  });
  it('leaves the panel open where it shows already and opening it would close it (Vivaldi)', async () => {
    shown = true;
    onClicked.emit(WATCH_ALARM + 'w1');
    await vi.waitFor(() => expect(update).toHaveBeenCalledWith(2, { focused: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(open).not.toHaveBeenCalled();
  });
});
