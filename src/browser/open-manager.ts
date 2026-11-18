// The extension's own pages opened in a tab, or brought to the front: host glue over browser.tabs,
// shared by the background, the popup, the side panel and Settings (src/browser: the modules that only
// wrap a browser API for several contexts; core calls none).
import { browser } from 'wxt/browser';

// Brings an open tab to the front, in its window brought to the front too (at `url` when given).
export async function focusTab(tab: { id: number; windowId?: number }, url?: string): Promise<void> {
  await browser.tabs.update(tab.id, { ...(url && { url }), active: true });
  if (tab.windowId !== undefined) await browser.windows.update(tab.windowId, { focused: true });
}

// Opens the extension's `page` (with `query`) in a new tab, or brings the one open to the front. Tabs
// are asked for by the page, then told apart by the whole URL. A browser that refuses the extension's own
// URL as a pattern to ask by gets a new tab.
async function openOrFocus(page: string, query = ''): Promise<void> {
  const url = page + query;
  const tab = (await browser.tabs.query({ url: `${page}*` }).catch(() => [])).find((t) => t.url?.startsWith(url));
  if (tab?.id === undefined) return void browser.tabs.create({ url });
  await focusTab({ id: tab.id, windowId: tab.windowId });
}

// The agent manager's page.
export const openManager = () => openOrFocus(browser.runtime.getURL('/manager.html'));
// The chat full-screen in a tab (sidepanel.html?full).
export const openFullChat = () => openOrFocus(browser.runtime.getURL('/sidepanel.html'), '?full');
// The review of a tab's audio, transcribed (entrypoints/audio).
export const openAudioReview = () => openOrFocus(browser.runtime.getURL('/audio.html'));
