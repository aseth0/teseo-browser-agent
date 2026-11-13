// What the toolbar button's popup does that is not opening a page (browser/open-manager) or the side panel
// (core/side-panel).
import { floatOnTab } from '../widget/float';
import { hasAccess } from '../page/access';
import { originPattern } from '../page/permissions';
import { askOrigins } from './ask-permission';

// Floats the chat on the tab, as ⌥⇧F does (without folding it when shown), the bubble shown again
// where it was hidden on the site: false where the page has no widget to float it in, or it could not.
export const floatChat = (tabId: number): Promise<boolean> => floatOnTab(tabId);

// Why the chat could not float on the page: the extension may not use the site (it puts the page widget
// only where it may), or it may, and the bubble is off there (Settings → Bubble).
export async function whyNoFloat(url: string): Promise<'access' | 'bubble'> {
  return (await hasAccess(url)) ? 'bubble' : 'access';
}

const WIDGET_WAIT_MS = 3000; // a site just granted gets the widget from the background (widget/store)
const WIDGET_POLL_MS = 300;

// "Enable it": access to the site, asked at once (inside the click), then the chat floated once the
// widget is in the page. Granted with no widget coming: the bubble is off there.
export async function enableAndFloat(tabId: number, url: string): Promise<'floated' | 'refused' | 'bubble'> {
  if (!(await askOrigins(originPattern(url)))) return 'refused';
  for (const end = Date.now() + WIDGET_WAIT_MS; Date.now() < end; await new Promise((r) => setTimeout(r, WIDGET_POLL_MS))) {
    if (await floatChat(tabId)) return 'floated';
  }
  return 'bubble';
}
