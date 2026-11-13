// Tab watches (browser.watch): each runs in its page (content/watch) while the service worker
// sleeps; the page's message (WATCH_FIRED), the tab loading or closing, and the watch's alarm wake
// it. Once a page loads again on the same site the watch is started there again; on another site it
// ends. While a watch runs its tab is not discarded. Its end is kept for the panel (watches/store)
// and, if asked, told by a system notification.
import { browser } from 'wxt/browser';
import { openSidePanel } from '../core/side-panel';
import { errorText } from '../core/errors';
import { onRuntime } from '../core/runtime';
import { WATCH_FIRED } from '../page/protocol';
import { WATCH_CANCEL, WATCH_START } from '../core/protocol';
import { isExtensionPage } from '../core/sender';
import { loadEndedWatches, loadWatches } from '../watches/store';
import { addWatch, endWatch, originOf, startInPage, WATCH_ALARM } from '../watches/run';
import { panelFollowsNow } from './panel-mode';
import { panelShownIn } from './panel-windows';
import { settingsNow } from './settings';

export function listenWatches() {
  // From the panel only: a page's content script never starts or ends a watch.
  onRuntime(WATCH_START, ({ settings }, sender) => {
    if (!isExtensionPage(sender)) return;
    return settingsNow().then(() => addWatch({ ...settings, setBy: 'user' })).then(
      () => ({ ok: true as const }),
      (e: unknown) => ({ error: errorText(e) }),
    );
  });
  onRuntime(WATCH_CANCEL, ({ id }, sender) => {
    if (isExtensionPage(sender)) return endWatch(id, { kind: 'cancelled' });
  });
  onRuntime(WATCH_FIRED, ({ id, fired }, sender) => {
    void loadWatches().then((all) => {
      const w = all.find((x) => x.id === id);
      if (w && sender.tab?.id === w.tabId && sender.frameId === 0) void endWatch(id, { kind: 'met', fired });
    });
  });

  // A page loaded in a watched tab: watched again on the same site, else the watch ends.
  browser.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (info.status !== 'complete') return;
    void loadWatches().then((all) => {
      for (const w of all.filter((x) => x.tabId === tabId)) {
        if (originOf(tab.url) !== w.origin) void endWatch(w.id, { kind: 'left', url: tab.url ?? '' });
        else startInPage(w).catch((e: unknown) => void endWatch(w.id, { kind: 'failed', error: `It could not watch the page again: ${errorText(e)}` }));
      }
    });
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    void loadWatches().then((all) => all.filter((x) => x.tabId === tabId).forEach((w) => void endWatch(w.id, { kind: 'closed' })));
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name.startsWith(WATCH_ALARM)) void endWatch(alarm.name.slice(WATCH_ALARM.length), { kind: 'timeout' });
  });

  // Clicking a watch's notification shows its tab, and the panel when the browser lets it.
  browser.notifications.onClicked.addListener((nid) => {
    if (!nid.startsWith(WATCH_ALARM)) return;
    browser.notifications.clear(nid).catch(() => undefined);
    void loadEndedWatches().then(async (ended) => {
      const e = ended.find((x) => WATCH_ALARM + x.watch.id === nid);
      const tab = e && (await browser.tabs.get(e.watch.tabId).catch(() => undefined));
      if (!tab?.id) return;
      await browser.tabs.update(tab.id, { active: true });
      await browser.windows.update(tab.windowId, { focused: true });
      // Whether a notification click lets the side panel open (it needs a user gesture) is up to
      // the browser: when it does not, the tab is shown alone.
      await openSidePanel(tab, panelFollowsNow(), panelShownIn(tab.windowId), 'watch').catch(() => undefined);
    });
  });
}
