// The tabs the extension opens in the background (web search and reading, site mentions, template
// previews): never focused, muted, in the agent's window, and kept together in a folded tab group
// (Settings → Web search), which the browser removes once its last tab is closed.
import { browser } from 'wxt/browser';
import { serialized } from '../storage/serial';
import type { TabGroupSettings, WebSearchSettings } from '../storage/settings-types';

export const TAB_GROUP_DEFAULTS = { enabled: true, title: 'Agent', color: 'grey' } as const;

// How long a page opened in the background is given to load.
export const LOAD_TIMEOUT_MS = 15_000;

// `web`: Settings → Web search, which says whether it is muted and its group. `agentTab`: the panel's
// tab, whose window it opens in.
export interface BackgroundTabOptions {
  web?: WebSearchSettings;
  agentTab?: number;
}

// The agent's window: its tab's, else the last focused normal one. Never an app (PWA) or popup
// window, which cannot hold the tab: the browser would open it in a normal window brought to the
// front, over the window the user works in. None: there is no normal window.
async function agentWindow(agentTab?: number): Promise<number | undefined> {
  const tab = agentTab === undefined ? undefined : await browser.tabs.get(agentTab).catch(() => undefined);
  const own = tab && (await browser.windows.get(tab.windowId).catch(() => undefined));
  if (own?.type === 'normal') return own.id;
  const last = await browser.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => undefined);
  return last?.id;
}

// The windows opened for a background tab alone, when there was no normal window to put it in: by
// its tab, closed with it. Also in the session storage, for the side panel's tab picker and a service
// worker that started again.
const ownWindows = new Map<number, number>();
const OWN_WINDOWS = 'backgroundTabWindows';
const keepOwnWindows = async () => {
  await browser.storage.session.set({ [OWN_WINDOWS]: [...ownWindows.values()] }).catch(() => undefined);
};

// Those windows' ids (browser.list_tabs and the tab picker leave them out).
export async function ownWindowIds(): Promise<number[]> {
  const stored: Record<string, unknown> = await browser.storage.session.get(OWN_WINDOWS).catch(() => ({}));
  const kept = stored[OWN_WINDOWS];
  return [...new Set([...ownWindows.values(), ...(Array.isArray(kept) ? (kept as number[]) : [])])];
}

// In the agent's window; without a normal window, in one of its own, minimized and never focused.
async function openTab(url: string, agentTab: number | undefined): Promise<{ id?: number; windowId: number } | undefined> {
  const windowId = await agentWindow(agentTab);
  if (windowId !== undefined) return browser.tabs.create({ url, active: false, windowId });
  const win = await browser.windows.create({ url, type: 'normal', state: 'minimized', focused: false });
  const tab = win?.tabs?.[0];
  if (win?.id !== undefined && tab?.id !== undefined) {
    ownWindows.set(tab.id, win.id);
    await keepOwnWindows();
  } else if (win?.id !== undefined) await browser.windows.remove(win.id).catch(() => undefined);
  return tab;
}

export async function createBackgroundTab(url: string, { web = {}, agentTab }: BackgroundTabOptions = {}): Promise<number> {
  const tab = await openTab(url, agentTab);
  const id = tab?.id;
  if (!tab || id === undefined) throw new Error('The browser did not open the tab.');
  try {
    if (web.muteTabs ?? true) await browser.tabs.update(id, { muted: true });
  } catch (e) {
    await closeBackgroundTab(id); // the caller never gets its id to close it
    throw e;
  }
  // A tab that cannot be grouped (a browser without tab groups) works the same.
  await addToGroup(id, tab.windowId, web.tabGroup ?? {}).catch(() => undefined);
  return id;
}

export function closeBackgroundTab(tabId: number): Promise<void> {
  const windowId = ownWindows.get(tabId);
  if (ownWindows.delete(tabId)) void keepOwnWindows();
  return (windowId === undefined ? browser.tabs.remove(tabId) : browser.windows.remove(windowId)).then(() => undefined, () => undefined);
}

// A background tab, closed when done.
export async function inBackgroundTab<T>(url: string, options: BackgroundTabOptions, run: (tabId: number) => Promise<T>): Promise<T> {
  const tabId = await createBackgroundTab(url, options);
  try {
    return await run(tabId);
  } finally {
    await closeBackgroundTab(tabId);
  }
}

// Grouping in a window, one tab at a time (also across the extension's pages): two tabs opened at
// once would each find no group and make one.
const grouping = new Map<number, ReturnType<typeof serialized>>();
const inWindow = (windowId: number) => {
  let one = grouping.get(windowId);
  if (!one) grouping.set(windowId, (one = serialized(`tabGroup:${windowId}`)));
  return one;
};

// Into the window's group with that title, or a new one, folded.
async function addToGroup(tabId: number, windowId: number, settings: TabGroupSettings): Promise<void> {
  const { enabled, title, color } = { ...TAB_GROUP_DEFAULTS, ...settings };
  if (!enabled) return;
  await inWindow(windowId)(async () => {
    const [group] = await browser.tabGroups.query({ title, windowId });
    if (group) {
      await browser.tabs.group({ tabIds: tabId, groupId: group.id });
      return;
    }
    const groupId = await browser.tabs.group({ tabIds: tabId, createProperties: { windowId } });
    await browser.tabGroups.update(groupId, { title, color, collapsed: true });
  });
}
