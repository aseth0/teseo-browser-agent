// The tabs a new agent of the agent manager can work on: not the manager's own, nor one another of
// its agents works on (two would drive the same page); the most recently used first.
import { browser, type Browser } from 'wxt/browser';
import { hostOf } from '../core/util';

export interface TabChoice {
  id: number;
  title: string;
  host: string;
}

export function tabChoices(tabs: Browser.tabs.Tab[], managerTabId: number | undefined, taken: number[]): TabChoice[] {
  return tabs
    .filter((t): t is Browser.tabs.Tab & { id: number } => t.id !== undefined && t.id !== managerTabId && !taken.includes(t.id))
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))
    .map((t) => ({ id: t.id, title: t.title || t.url || '', host: hostOf(t.url) }));
}

// Brings the tab to the front of its window, and that window to the front; a tab closed meanwhile, nothing.
export async function goToTab(tabId: number): Promise<void> {
  const tab = await browser.tabs.get(tabId).catch(() => undefined);
  if (!tab) return;
  if (tab.windowId !== undefined) await browser.windows.update(tab.windowId, { focused: true });
  await browser.tabs.update(tabId, { active: true });
}
