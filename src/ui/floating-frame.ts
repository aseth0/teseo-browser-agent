// Which chat this page is: floating on a page (floating.html, in the page widget's iframe) and the tab it
// floats in, or one of sidepanel.html's (as its query says). For the side panel (entrypoints/sidepanel/
// floating) and the ui/ hooks that behave differently there (useSeen).
import { browser, type Browser } from 'wxt/browser';

const params = new URLSearchParams(location.search);

// Floating: its own page, floating.html, which starts only in a web page's frame with the widget's
// ticket (sidepanel/ticket-gate). It never gets the side panel's UI, which trusts that it is seen and
// offers the site's policy. sidepanel.html never floats, whatever its URL says: no web page can frame
// it (not web-accessible), and framed by one it would not start.
export const FLOATING = location.pathname === '/floating.html';
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
