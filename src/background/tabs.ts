// The tabs as the background sees them now, for the site checks and the chat.
import { browser } from 'wxt/browser';
import type { TabSeen } from '../core/types';

export const tabUrl = (tabId: number) => browser.tabs.get(tabId).then((t) => t.url, () => undefined);
// For the site checks: no tab, no URL (so a call there is asked, or refused to an agent).
export const urlOfTab = async (tabId: number | undefined) => (tabId === undefined ? undefined : tabUrl(tabId));
// A tab a call names, as it is now (closed: none), for the chat and the confirmation card.
export const seenTab = async (id: number): Promise<TabSeen | undefined> => {
  const t = await browser.tabs.get(id).catch(() => undefined);
  return t ? { id, title: t.title || t.url || `tab ${id}`, ...(t.url && { url: t.url }) } : undefined;
};
