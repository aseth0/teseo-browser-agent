// The floating chat's "Open in the side panel", on the widget's bar (widget/ui/floating-chat): the
// background opens the side panel inside the click, then asks the chat floating on that tab for its
// conversation (background/float-to-panel).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
const record = (name: string) => vi.fn(async (arg?: unknown): Promise<unknown> => void calls.push(`${name} ${JSON.stringify(arg)}`));
const sendMessage = vi.fn(async (_msg: unknown): Promise<unknown> => undefined);
vi.mock('wxt/browser', () => ({
  browser: {
    sidePanel: { open: record('open'), setOptions: record('setOptions') },
    runtime: { sendMessage },
    storage: { session: { set: async () => undefined, remove: async () => undefined } }, // the tabs given a panel (core/side-panel)
  },
}));
let shown = false; // the window's side panel shows, where opening it would close it (background/panel-windows)
vi.mock('../src/background/panel-windows', () => ({ panelShownIn: (windowId: number) => shown && windowId === 9 }));
const { browser } = await import('wxt/browser');
const { FLOATING_TO_PANEL } = await import('../src/widget/protocol');
const { floatToPanel } = await import('../src/background/float-to-panel');
const send = sendMessage;

beforeEach(() => void calls.splice(0));

describe('floatToPanel', () => {
  it("opens the window's side panel at once (the pin on), then asks the floating chat for its conversation", async () => {
    send.mockResolvedValueOnce({ moved: true });
    const reply = floatToPanel({ id: 3, windowId: 9 }, true);
    expect(calls).toEqual(['open {"windowId":9}']); // before anything awaited: the click's gesture
    expect(await reply).toEqual({ opened: true, moved: true });
    expect(send).toHaveBeenLastCalledWith({ type: FLOATING_TO_PANEL, tab: 3, to: {}, opened: true });
  });

  it("showing already where opening it would close it (Vivaldi): left open, the conversation goes there", async () => {
    shown = true;
    send.mockResolvedValueOnce({ moved: true });
    expect(await floatToPanel({ id: 3, windowId: 9 }, true)).toEqual({ opened: true, moved: true });
    expect(calls).toEqual([]);
    expect(send).toHaveBeenLastCalledWith({ type: FLOATING_TO_PANEL, tab: 3, to: {}, opened: true });
    shown = false;
  });

  it("to the tab's own panel with the pin off", async () => {
    send.mockResolvedValueOnce({ moved: true });
    await floatToPanel({ id: 3, windowId: 9 }, false);
    expect(calls).toEqual(['setOptions {"tabId":3,"path":"sidepanel.html?tab=3","enabled":true}', 'open {"tabId":3}']);
    expect(send).toHaveBeenLastCalledWith({ type: FLOATING_TO_PANEL, tab: 3, to: { panelTab: 3 }, opened: true });
  });

  it('not opened: the conversation still goes, to wait for the panel', async () => {
    vi.mocked(browser.sidePanel.open).mockRejectedValueOnce(new Error('`sidePanel.open()` may only be called in response to a user gesture.'));
    send.mockResolvedValueOnce({ moved: true });
    expect(await floatToPanel({ id: 3, windowId: 9 }, true)).toEqual({ opened: false, moved: true });
    expect(send).toHaveBeenLastCalledWith({ type: FLOATING_TO_PANEL, tab: 3, to: {}, opened: false });
  });

  it('not moved where no floating chat answers', async () => {
    send.mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.'));
    expect(await floatToPanel({ id: 3, windowId: 9 }, true)).toEqual({ opened: true, moved: false });
    send.mockResolvedValueOnce(undefined);
    expect(await floatToPanel({ id: 3, windowId: 9 }, true)).toEqual({ opened: true, moved: false });
  });
});
