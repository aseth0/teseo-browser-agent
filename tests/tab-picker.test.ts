// The page bar's tab picker: the open tabs by window, the window's type noted, the chat's tab and the
// one you are on marked, the agent's own windows left out.
import { describe, expect, it, vi } from 'vitest';
import type { Browser } from 'wxt/browser';

const updated: unknown[] = [];
vi.mock('wxt/browser', () => ({ browser: { runtime: { getURL: (p: string) => `chrome-extension://id${p}` }, tabs: { update: async (...a: unknown[]) => void updated.push(a) } } }));
const { faviconOf, pickerWindows, showTab } = await import('../src/entrypoints/sidepanel/tab-picker');

const tab = (id: number, url: string, title = '') => ({ id, url, title, active: false }) as Browser.tabs.Tab;
const windows = [
  { id: 1, type: 'normal', tabs: [tab(10, 'https://a.example.com/', 'A'), tab(11, 'chrome://extensions/', 'Extensions')] },
  { id: 2, type: 'app', tabs: [tab(20, 'https://app.example.test/', 'App')] },
  { id: 3, type: 'normal', tabs: [tab(30, 'https://search.example.com/')] }, // the agent's minimized one
  { id: 4, type: 'popup', tabs: [] },
] as Browser.windows.Window[];

describe('pickerWindows', () => {
  it('groups the tabs by window, noting an app, and marks the chat\'s tab and yours', () => {
    const got = pickerWindows(windows, { chat: 20, user: 10, skip: (id) => id === 3 });
    expect(got.map((w) => w.label)).toEqual(['Window 1', 'Window 2 (app)']);
    expect(got[0]!.tabs).toEqual([
      { tabId: 10, title: 'A', url: 'https://a.example.com/', restricted: false, workingOn: false, userOn: true },
      { tabId: 11, title: 'Extensions', url: 'chrome://extensions/', restricted: true, workingOn: false, userOn: false },
    ]);
    expect(got[1]!.tabs[0]).toMatchObject({ tabId: 20, workingOn: true, userOn: false });
  });

  it('keeps every window with tabs when none is skipped, a tab without title by its url', () => {
    const got = pickerWindows(windows, { chat: 10, user: 10 });
    expect(got.map((w) => w.windowId)).toEqual([1, 2, 3]);
    expect(got[0]!.tabs[0]).toMatchObject({ workingOn: true, userOn: true });
    expect(got[2]!.tabs[0]!.title).toBe('https://search.example.com/');
  });
});

describe('showTab', () => {
  it('brings the tab to the front of its window, without focusing the window', async () => {
    await showTab(20);
    expect(updated).toEqual([[20, { active: true }]]);
  });
});

describe('faviconOf', () => {
  it('asks the browser\'s own icon cache for the page, not the site', () => {
    expect(faviconOf('https://a.example.com/x?y=1')).toBe('chrome-extension://id/_favicon/?pageUrl=https%3A%2F%2Fa.example.com%2Fx%3Fy%3D1&size=16');
  });
});
