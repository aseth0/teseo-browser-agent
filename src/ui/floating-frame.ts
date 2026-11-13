// sidepanel.html?floating: the chat floating on a page, in the page widget's iframe. Whether this page
// is that chat, and the tab it floats in: for the side panel (entrypoints/sidepanel/floating) and the
// ui/ hooks that behave differently there (useSeen).
import { browser, type Browser } from 'wxt/browser';

const params = new URLSearchParams(location.search);

// Whether this page is in a frame whose parent is not the extension: a page's. Every ancestor's origin
// where the browser lists them (location.ancestorOrigins); else the parent's, which a page's denies.
export function framedByPage(win: Pick<Window, 'top' | 'parent'> & { location: Pick<Location, 'origin'> & { ancestorOrigins?: DOMStringList } }): boolean {
  if (win.top === win) return false;
  const own = win.location.origin;
  const ancestors = win.location.ancestorOrigins;
  if (ancestors) return Array.from(ancestors).some((origin) => origin !== own);
  try {
    return win.parent.location.origin !== own;
  } catch {
    return true;
  }
}

// Floating: so its URL says, or a page frames it (whatever its URL says, it never gets the side
// panel's UI, which trusts that it is seen and offers the site's policy). The extension's own pages
// that frame it (the agent manager's chats, the Appearance preview) leave it as it is.
export const FLOATING = params.has('floating') || framedByPage(window);
// sidepanel.html?tab=<id>&manager&agent=<id>: one of the chats of the agent manager's page (an iframe
// there), working on that tab, with that agent (none: Default) as its own (sidepanel/manager-chat).
export const MANAGER = params.has('manager');
export const MANAGER_AGENT = params.get('agent') || undefined;
// &conversation=<id>: the saved conversation it goes on with (none: a new one).
export const MANAGER_CONVERSATION = params.get('conversation') || undefined;
// &row=<key>: its row; &parent=<key>: the row whose agent started it (agents/panel). A row the user
// started (none) has the panel's tools: its runs carry it.
export const MANAGER_PANEL_ROW = MANAGER && !params.get('parent') ? params.get('row') || undefined : undefined;
// sidepanel.html?full: the chat full-screen, in a normal tab (browser/open-manager). Its agent and model are
// its own, as in the agent manager; it works on the page as the window's side panel does.
export const FULL = params.has('full');
// sidepanel.html?preview: the panel as Settings → Appearance shows it, with an example conversation.
export const PREVIEW = params.has('preview');

// The tab it floats in, as the browser says (tabs.getCurrent), never what its URL says. Kept once
// known: the background's asks for it name that tab (knownFloatingTab).
let current: Browser.tabs.Tab | undefined;
export const floatingTab = async () => (current ??= await browser.tabs.getCurrent());
export const knownFloatingTab = () => current;
if (FLOATING) void floatingTab();
