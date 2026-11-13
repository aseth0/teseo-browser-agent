// Starting and ending a tab watch (browser.watch, background/watches): saved in watches/store, run in
// its page (content/watch), timed by an alarm, its tab held from being discarded (watches/tab-holds), and
// its end told by a system notification when asked.
import { browser } from 'wxt/browser';
import { limit } from '../core/limits';
import { callPage } from '../page/bridge';
import { tabHolds } from './tab-holds';
import { addEnded, endText, saveNewWatch, takeWatch, watchCondition, type Watch, type WatchEnd, type WatchSettings } from './store';

export const WATCH_ALARM = 'watch:';
export const originOf = (url: string | undefined) => {
  try {
    return url ? new URL(url).origin : '';
  } catch {
    return '';
  }
};

export const startInPage = (w: Watch) => callPage(w.tabId, { op: 'watch-start', id: w.id, ...w.spec });

// Starts a watch on its tab, with the limits set in Settings (applied by the caller: background/settings
// settingsNow). Throws, saying why, when one more is not allowed or the page cannot be watched (no
// access to the site: AccessRequiredError, as any page call).
export async function addWatch(s: WatchSettings): Promise<Watch> {
  if (!s.spec.gone && !s.spec.appears && s.spec.stableMs === undefined) throw new Error('A watch needs something to wait for: gone, appears or stableMs.');
  const tab = await browser.tabs.get(s.tabId);
  const minutes = Math.min(s.minutes ?? limit('watchMinutes'), limit('watchMinutes'));
  const now = Date.now();
  const w: Watch = { ...s, id: crypto.randomUUID(), origin: originOf(tab.url), title: tab.title || tab.url || `tab ${s.tabId}`, createdAt: now, expiresAt: now + minutes * 60_000 };
  // Saved before the page starts watching: a condition met at once fires a watch that is there.
  await saveNewWatch(w, limit('watches'), (running) => new Error(`${running} tab watches are running already, the most allowed (Settings → Limits).`));
  await browser.alarms.create(WATCH_ALARM + w.id, { when: w.expiresAt });
  try {
    await startInPage(w);
  } catch (e) {
    await takeWatch(w.id);
    await browser.alarms.clear(WATCH_ALARM + w.id);
    throw e;
  }
  await tabHolds.watchStarted(w.tabId);
  return w;
}

// Ends a watch (once: a second end of the same one does nothing).
export async function endWatch(id: string, end: WatchEnd): Promise<void> {
  const w = await takeWatch(id);
  if (!w) return;
  void browser.alarms.clear(WATCH_ALARM + id);
  if (end.kind !== 'met' && end.kind !== 'closed') void callPage(w.tabId, { op: 'watch-stop', id }).catch(() => undefined);
  void tabHolds.watchEnded(w.tabId);
  if (end.kind === 'cancelled') return;
  await addEnded({ watch: w, end, at: Date.now() });
  if (w.notify) notify(w, end);
}

function notify(w: Watch, end: WatchEnd) {
  const site = w.origin.replace(/^https?:\/\//, '');
  browser.notifications
    .create(WATCH_ALARM + w.id, {
      type: 'basic',
      iconUrl: browser.runtime.getURL('/icon/128.png'),
      title: end.kind === 'met' ? `Watch met on ${site}` : `Watch ended on ${site}`,
      message: end.kind === 'met' ? endText(end) : `${watchCondition(w.spec)}: ${endText(end)}`,
      contextMessage: w.title,
    })
    .catch((e: unknown) => console.error('[watch]', e));
}
