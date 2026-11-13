// Where the chat opens, as the pin in its top bar says (Settings panelFollows):
// - on (the default): the window's side panel, which stays as you go from tab to tab, while its chat
//   keeps working on the tab its conversation started on (entrypoints/sidepanel/usePageTarget);
// - off: one side panel per tab (sidepanel.html?tab=ID), each with its own chat, shown only on its tab.
import { browser } from 'wxt/browser';
import { CLOSE_WINDOW_PANEL } from './protocol';
import { sendRuntime } from './runtime';

const PANEL_PATH = 'sidepanel.html';
// The keyboard shortcut (manifest commands, ⌥⇧A) that opens the side panel, in the pin's mode.
export const PANEL_COMMAND = 'open-side-panel';
export const tabPanelPath = (tabId: number) => `${PANEL_PATH}?tab=${tabId}`;

// The tab a panel opened per tab belongs to, from its URL (none: the window's panel). Only the
// extension opens it there: pages cannot load the panel's page under its plain URL (manifest
// use_dynamic_url).
export function panelTabOf(search: string): number | undefined {
  const tab = Number(new URLSearchParams(search).get('tab') ?? NaN);
  return Number.isInteger(tab) ? tab : undefined;
}

// Whether the browser gives each tab a side panel of its own: asked from the side panel. Vivaldi does
// not: it shows the extension's side panel as one web panel for the window, hosted in a tab (which
// tabs.getCurrent finds; a Chrome side panel is in none), and keeps no options per tab. There the pin
// stays on: turned off, the window's panel would close and no tab's would open in its place.
export const panelsPerTab = async (): Promise<boolean> => (await browser.tabs.getCurrent()) === undefined;

// Closes the side panel it is called from, in the window of the page it works on: whether it did.
// Where the browser hosts the panel in a tab (Vivaldi), the background closes it, as its shortcut
// does: closed from inside (window.close(), or sidePanel.open from it), its web panel loses the page
// and shows the browser's start page until the extension is reloaded.
export async function closeSidePanel(windowId: number): Promise<boolean> {
  if (await panelsPerTab()) {
    window.close();
    return true;
  }
  return sendRuntime({ type: CLOSE_WINDOW_PANEL, windowId }).then((reply) => reply?.closed === true, () => false);
}

// The window's panel closed by the background, for a panel hosted in a tab (CLOSE_WINDOW_PANEL): there
// opening the open panel closes it (Vivaldi's web panel toggles). Only during the click that asked.
export function closeWindowPanel(windowId: number): Promise<void> {
  traced?.({ call: 'close', windowId });
  return browser.sidePanel?.open({ windowId }) ?? Promise.resolve();
}

// Firefox has no side panel API but a sidebar (manifest sidebar_action, one per window): opened, it is
// the chat's window panel; there is no panel per tab.
const sidebar = () => (browser as unknown as { sidebarAction?: { open(): Promise<void> } }).sidebarAction;

// Each open or close of the side panel asked here, told to the background's trace (background/panel-trace),
// which sets it there only. `by`: what asked; `left-open`: not asked of the browser, the panel shown.
export type PanelCall = { call: 'open' | 'left-open' | 'open-window' | 'close'; windowId: number; tabId?: number; follows?: boolean; by?: string };
let traced: ((c: PanelCall) => void) | undefined;
export const tracePanelCalls = (trace: (c: PanelCall) => void): void => void (traced = trace);

const logged = (p: Promise<unknown>) => void p.catch((e: unknown) => console.error('[side panel]', e));

// The tabs given a panel of their own (the pin off), one key each in storage.session (no read and write
// back, whichever page opens it): the ones turned off when the pin is turned on (applyPanelMode). Only
// those: in Vivaldi, which never gives a tab one, turning a tab's panel off closes the window's.
const TAB_PANEL_PREFIX = 'tabPanel:';
const tabPanelKey = (tabId: number) => `${TAB_PANEL_PREFIX}${tabId}`;
// After the open, never in its way.
const noteTabPanel = (tabId: number, has: boolean) =>
  logged(Promise.resolve().then(() => (has ? browser.storage.session.set({ [tabPanelKey(tabId)]: true }) : browser.storage.session.remove(tabPanelKey(tabId)))));

// Opens the chat for the tab, in the pin's mode. Inside a click (or a message sent from one): nothing
// is awaited before open, which the browser allows only during the gesture. `shown`: the window's panel
// shows already where the browser hosts it in a tab (background/panel-windows), and opening it would
// close it: it is left open. The pin not known yet (undefined): the window's, as on. `by`: what asked,
// for the trace.
export function openSidePanel(tab: { id?: number; windowId: number }, follows: boolean | undefined, shown = false, by?: string): Promise<void> {
  const left = follows !== false && shown;
  traced?.({ call: left ? 'left-open' : 'open', ...(by && { by }), windowId: tab.windowId, ...(tab.id !== undefined && { tabId: tab.id }), ...(follows !== undefined && { follows }) });
  if (left) return Promise.resolve();
  if (!browser.sidePanel) return sidebar()?.open() ?? Promise.resolve();
  if (follows !== false || tab.id === undefined) return browser.sidePanel.open({ windowId: tab.windowId });
  logged(browser.sidePanel.setOptions({ tabId: tab.id, path: tabPanelPath(tab.id), enabled: true }));
  const opened = browser.sidePanel.open({ tabId: tab.id });
  noteTabPanel(tab.id, true);
  return opened;
}

// The pin turned on from a tab's panel: the window's panel opens in its place, the tab's own off first
// (or the browser would keep showing it there). Run by the background, in the message the click sent
// (OPEN_WINDOW_PANEL): turning the tab's panel off closes it, and in it the browser would not take the
// open that follows.
export function openWindowPanel(tab: { id: number; windowId: number }): Promise<void> {
  traced?.({ call: 'open-window', windowId: tab.windowId, tabId: tab.id });
  if (!browser.sidePanel) return sidebar()?.open() ?? Promise.resolve();
  logged(browser.sidePanel.setOptions({ path: PANEL_PATH, enabled: true }));
  logged(browser.sidePanel.setOptions({ tabId: tab.id, enabled: false }));
  const opened = browser.sidePanel.open({ windowId: tab.windowId });
  noteTabPanel(tab.id, false);
  return opened;
}

// The browser set for the mode. On: the window's panel, the own panel of each tab given one off (a tab
// with one shows it instead). Off: no window's panel. Either way the toolbar button opens its popup (entrypoints/popup),
// never the panel itself. Setting it again as it is changes nothing open.
export async function applyPanelMode(follows: boolean): Promise<void> {
  if (!browser.sidePanel) return; // Firefox: its sidebar has no modes
  await browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  if (!follows) return browser.sidePanel.setOptions({ enabled: false });
  await browser.sidePanel.setOptions({ path: PANEL_PATH, enabled: true });
  const keys = Object.keys(await browser.storage.session.get(null)).filter((k) => k.startsWith(TAB_PANEL_PREFIX));
  const tabIds = keys.map((k) => Number(k.slice(TAB_PANEL_PREFIX.length))).filter(Number.isInteger);
  await Promise.all(tabIds.map((tabId) => browser.sidePanel.setOptions({ tabId, enabled: false }).catch(() => undefined))); // a tab closed since: refused
  if (keys.length) await browser.storage.session.remove(keys);
}
