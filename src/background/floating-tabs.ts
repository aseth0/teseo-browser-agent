// The tabs whose page has the chat floating on it now, known at once: a capture's shortcut must open
// the side panel (or not) before it awaits anything (capture/run). The storage key the floating chat
// keeps (FLOATING_PREFIX) outlives the page: it brings the chat back after a reload, also when the tab
// has moved on to a page without the widget. So a tab counts once its widget says so (widget-host),
// and no longer once a page starts loading there, until that page's widget says so again. A worker
// that has just started knows none: the side panel opens.
import { browser } from 'wxt/browser';

const floating = new Set<number>();

export const floatingNow = (tabId: number) => floating.has(tabId);
export function markFloating(tabId: number, on: boolean) {
  if (on) floating.add(tabId);
  else floating.delete(tabId);
}

export function listenFloatingTabs() {
  browser.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status === 'loading') markFloating(tabId, false);
  });
  browser.tabs.onRemoved.addListener((tabId) => markFloating(tabId, false));
}
