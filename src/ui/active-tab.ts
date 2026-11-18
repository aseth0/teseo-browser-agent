import { browser } from 'wxt/browser';
import { lastFocusedNormalWindow } from '../browser/last-focused';

// "The page" (the side panel's, and the toolbar button popup's) is the active tab of the last focused
// *normal* browser window. Asking for the panel's own window is unreliable (Vivaldi shows the panel as
// a web panel, which can count as that window's active tab). Only when the panel itself is open as a
// tab (e.g. in tests) do we fall back to the most recently visited web tab of that window.
export async function activeTab() {
  const own = browser.runtime.getURL('/');
  const win = await lastFocusedNormalWindow({ populate: true });
  const tabs = win?.tabs ?? [];
  const active = tabs.find((t) => t.active);
  if (!active?.url?.startsWith(own)) return active;
  return tabs
    .filter((t) => !t.url?.startsWith(own))
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
}
