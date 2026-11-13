// Alerts for what waits for the user while the chat is not in view (core/interaction-kinds, Settings →
// Alerts): each raised under an id (a question's, a session's step limit, the recording) and cleared
// once nothing waits on it any more. At `badge` the toolbar icon shows "!" (background/badge) while one
// waits; at `notify` also a system notification, whose click shows the chat's tab, and its side panel
// when the browser lets it (as a watch's does, background/watches). Never a sound (silent: true).
// What the chats in view are is told by each chat on its port (background/session `view`).
import { browser } from 'wxt/browser';
import { alertOf, INTERACTION_DEFS, type AlertLevel, type InteractionKind } from '../core/interaction-kinds';
import { openSidePanel } from '../core/side-panel';
import { alertLevel } from '../storage/settings-select';
import { setBadgePart } from './badge';
import { panelFollowsNow } from './panel-mode';
import { panelShownIn } from './panel-windows';
import { settingsNow } from './settings';

const PREFIX = 'ba-alert:';

// Where the chat that waits is: its tab (floating, full screen, the Agents Panel), else its window's side panel.
export interface AlertWhere {
  tabId?: number;
  windowId?: number;
  sidePanel?: boolean;
}

interface Raised {
  where: AlertWhere;
  badge: boolean;
  notified: boolean;
}

const raised = new Map<string, Raised | null>(); // null: its level is being read
const views = new Map<object, { shown: boolean; windowId?: number }>(); // the chats that said whether they show

const levelNow = (kind: InteractionKind): Promise<AlertLevel> =>
  settingsNow().then((s) => alertLevel(s, kind), () => INTERACTION_DEFS[kind].level);

const updateBadge = () => setBadgePart('waiting', [...raised.values()].some((r) => !!r?.badge));

// A chat says whether it shows (none: it is gone).
export function noteChatView(chat: object, view: { shown: boolean; windowId?: number } | undefined): void {
  if (view) views.set(chat, view);
  else views.delete(chat);
}
// Whether a chat shows in that window (one that has not said is not counted).
export const chatShownIn = (windowId: number | undefined) =>
  [...views.values()].some((v) => v.shown && (windowId === undefined || v.windowId === windowId)) || (windowId !== undefined && panelShownIn(windowId));

export async function raiseAlert(id: string, kind: InteractionKind, opts: { message: string; where: AlertWhere; inView: boolean }): Promise<void> {
  if (raised.has(id)) return;
  raised.set(id, null);
  const level = await levelNow(kind);
  if (!raised.has(id)) return; // answered meanwhile
  const what = alertOf(level, opts.inView);
  if (!what.badge && !what.notify) return void raised.delete(id);
  raised.set(id, { where: opts.where, badge: what.badge, notified: what.notify });
  if (what.badge) updateBadge();
  if (what.notify) {
    await browser.notifications
      .create(PREFIX + id, { type: 'basic', iconUrl: browser.runtime.getURL('/icon/128.png'), title: INTERACTION_DEFS[kind].title, message: opts.message, silent: true })
      .catch((e: unknown) => console.error('[alerts]', e));
    if (!raised.has(id)) void browser.notifications.clear(PREFIX + id).catch(() => undefined); // answered while it went up
  }
}

export function clearAlert(id: string): void {
  const r = raised.get(id);
  if (!raised.delete(id)) return;
  if (r?.badge) updateBadge();
  if (r?.notified) void browser.notifications.clear(PREFIX + id).catch(() => undefined);
}

export const alertRaised = (id: string) => !!raised.get(id);

// The chat that waits, shown: its tab, its window focused, and its side panel where it is one.
async function show(where: AlertWhere): Promise<void> {
  let tab = where.tabId === undefined ? undefined : await browser.tabs.get(where.tabId).catch(() => undefined);
  if (!tab && where.windowId !== undefined) [tab] = await browser.tabs.query({ active: true, windowId: where.windowId }).catch(() => []);
  if (!tab) [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  if (tab?.id === undefined) return;
  await browser.tabs.update(tab.id, { active: true });
  await browser.windows.update(tab.windowId, { focused: true });
  // Whether a notification's click lets the side panel open (it needs a user gesture) is up to the
  // browser: when it does not, the tab is shown alone.
  if (where.sidePanel) await openSidePanel(tab, panelFollowsNow(), panelShownIn(tab.windowId), 'alert').catch(() => undefined);
}

export function listenAlerts(): void {
  browser.notifications.onClicked.addListener((nid) => {
    if (!nid.startsWith(PREFIX)) return;
    void browser.notifications.clear(nid).catch(() => undefined);
    const r = raised.get(nid.slice(PREFIX.length));
    if (r) void show(r.where).catch((e: unknown) => console.error('[alerts]', e));
  });
}
