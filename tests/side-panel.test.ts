// The chat's pin (core/side-panel): the window's side panel, which follows you from tab to tab, or one
// per tab; and what the browser is told for each, in the order a click needs.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeStorage } from './fakes/browser';

const calls: string[] = [];
const storage = fakeStorage();
const record = (name: string) => vi.fn(async (arg?: unknown) => void calls.push(`${name} ${JSON.stringify(arg)}`));
vi.mock('wxt/browser', () => ({
  browser: {
    storage,
    sidePanel: { open: record('open'), setOptions: record('setOptions'), setPanelBehavior: record('setPanelBehavior') },
    tabs: { query: vi.fn(async () => [{ id: 1 }, { id: 2 }]), getCurrent: vi.fn(async (): Promise<unknown> => undefined) },
    runtime: {
      sendMessage: vi.fn(async (msg: unknown): Promise<unknown> => {
        calls.push(`send ${JSON.stringify(msg)}`);
        return { closed: true };
      }),
    },
  },
}));
const { browser } = await import('wxt/browser');
const { CLOSE_WINDOW_PANEL } = await import('../src/core/protocol');
const { applyPanelMode, closeSidePanel, closeWindowPanel, openSidePanel, openWindowPanel, panelTabOf, panelsPerTab, tabPanelPath } = await import('../src/core/side-panel');

beforeEach(() => {
  calls.splice(0);
  storage.reset();
});
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('panelTabOf', () => {
  it("reads the tab of a tab's own panel from its URL", () => {
    expect(panelTabOf(`?${tabPanelPath(42).split('?')[1]}`)).toBe(42);
    expect(panelTabOf('')).toBeUndefined();
    expect(panelTabOf('?preview')).toBeUndefined();
    expect(panelTabOf('?tab=x')).toBeUndefined();
  });
});

describe('opening the side panel', () => {
  it("opens the window's with the pin on", async () => {
    await openSidePanel({ id: 3, windowId: 9 }, true);
    expect(calls).toEqual(['open {"windowId":9}']);
  });

  it("opens the tab's own with the pin off, its panel set first, and notes that tab has one", async () => {
    await openSidePanel({ id: 3, windowId: 9 }, false);
    expect(calls).toEqual(['setOptions {"tabId":3,"path":"sidepanel.html?tab=3","enabled":true}', 'open {"tabId":3}']);
    await settle();
    expect(storage.session.data).toEqual({ 'tabPanel:3': true });
  });

  it("leaves the window's open where it shows already and the browser hosts it in a tab (Vivaldi: open closes it)", async () => {
    await openSidePanel({ id: 3, windowId: 9 }, true, true);
    expect(calls).toEqual([]);
  });

  it("with the pin off, the tab's own opens all the same", async () => {
    await openSidePanel({ id: 3, windowId: 9 }, false, true);
    expect(calls).toEqual(['setOptions {"tabId":3,"path":"sidepanel.html?tab=3","enabled":true}', 'open {"tabId":3}']);
  });

  it("opens the window's in place of a tab's, that tab's off first (or the browser keeps showing it)", async () => {
    storage.session.data['tabPanel:3'] = true;
    await openWindowPanel({ id: 3, windowId: 9 });
    expect(calls).toEqual(['setOptions {"path":"sidepanel.html","enabled":true}', 'setOptions {"tabId":3,"enabled":false}', 'open {"windowId":9}']);
    await settle();
    expect(storage.session.data).toEqual({});
  });
});

describe('applyPanelMode', () => {
  it("on: the window's panel, the tabs given one of their own off, then forgotten; the toolbar button opens its popup", async () => {
    storage.session.data['tabPanel:2'] = true;
    storage.session.data['tabPanel:5'] = true; // a tab closed since: the browser refuses, nothing else to do
    storage.session.data.other = 1;
    await applyPanelMode(true);
    expect(calls).toEqual([
      'setPanelBehavior {"openPanelOnActionClick":false}',
      'setOptions {"path":"sidepanel.html","enabled":true}',
      'setOptions {"tabId":2,"enabled":false}',
      'setOptions {"tabId":5,"enabled":false}',
    ]);
    expect(storage.session.data).toEqual({ other: 1 });
  });

  // In Vivaldi turning a tab's panel off closes the window's web panel, and it never gives a tab one.
  it("on, no tab given one of its own: no tab's panel touched (Vivaldi would close the window's)", async () => {
    await applyPanelMode(true);
    expect(calls).toEqual(['setPanelBehavior {"openPanelOnActionClick":false}', 'setOptions {"path":"sidepanel.html","enabled":true}']);
  });

  it("off: no window's panel", async () => {
    await applyPanelMode(false);
    expect(calls).toEqual(['setPanelBehavior {"openPanelOnActionClick":false}', 'setOptions {"enabled":false}']);
  });
});

describe('panelsPerTab', () => {
  it('yes where the side panel is no tab of its own (Chrome)', async () => {
    vi.mocked(browser.tabs.getCurrent).mockResolvedValueOnce(undefined);
    expect(await panelsPerTab()).toBe(true);
  });

  it('no where the browser hosts the side panel in a tab (Vivaldi: one web panel for the window)', async () => {
    vi.mocked(browser.tabs.getCurrent as () => Promise<unknown>).mockResolvedValueOnce({ id: 7, windowId: 9 });
    expect(await panelsPerTab()).toBe(false);
  });
});

describe('closeSidePanel', () => {
  const closeWindow = vi.fn();
  beforeEach(() => {
    closeWindow.mockClear();
    vi.stubGlobal('window', { close: closeWindow });
  });
  afterEach(() => void vi.unstubAllGlobals());

  it('closes its own page where the side panel is no tab of its own (Chrome)', async () => {
    vi.mocked(browser.tabs.getCurrent).mockResolvedValueOnce(undefined);
    expect(await closeSidePanel(9)).toBe(true);
    expect(closeWindow).toHaveBeenCalledOnce();
    expect(calls).toEqual([]);
  });

  it("has the background close it where the browser hosts it in a tab (Vivaldi: closed from inside, its web panel loses the page)", async () => {
    vi.mocked(browser.tabs.getCurrent as () => Promise<unknown>).mockResolvedValueOnce({ id: 7, windowId: 4 });
    expect(await closeSidePanel(9)).toBe(true);
    expect(closeWindow).not.toHaveBeenCalled();
    expect(calls).toEqual([`send {"type":"${CLOSE_WINDOW_PANEL}","windowId":9}`]);
  });

  it('says so where the background could not (the click long gone)', async () => {
    vi.mocked(browser.tabs.getCurrent as () => Promise<unknown>).mockResolvedValueOnce({ id: 7, windowId: 4 });
    vi.mocked(browser.runtime.sendMessage as (msg: unknown) => Promise<unknown>).mockResolvedValueOnce({ closed: false });
    expect(await closeSidePanel(9)).toBe(false);
    vi.mocked(browser.tabs.getCurrent as () => Promise<unknown>).mockResolvedValueOnce({ id: 7, windowId: 4 });
    vi.mocked(browser.runtime.sendMessage as (msg: unknown) => Promise<unknown>).mockResolvedValueOnce(undefined);
    expect(await closeSidePanel(9)).toBe(false);
    expect(closeWindow).not.toHaveBeenCalled();
  });

  it("closes the window's from the background by opening it (Vivaldi's web panel toggles)", async () => {
    await closeWindowPanel(9);
    expect(calls).toEqual(['open {"windowId":9}']);
  });
});
