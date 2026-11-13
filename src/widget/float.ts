// The chat floated on a tab's page by the widget there (WIDGET_FLOAT): from the side panel, the popup
// and the shortcut. Floating the chat is a call for the widget: where the bubble is hidden on the site,
// nothing of it is in the page, so the site is shown again, the background puts the widget back into
// its tabs (widget/store wakeWidget), and the chat floats once it is there.
import { browser } from 'wxt/browser';
import { sendTab, type MessageOf } from '../core/runtime';
import { loadPlaces, updatePlace, widgetSite } from './places';
import { WIDGET_FLOAT } from './protocol';

const WAKE_WAIT_MS = 3000; // the widget put back into the page, its actions asked
const WAKE_POLL_MS = 200;

const sendFloat = (tabId: number, message: MessageOf<typeof WIDGET_FLOAT>) => sendTab(tabId, message).then((reply) => !!reply?.floated, () => false);

// Whether it floats there now (false: the page has no widget to float it in, hidden or not).
export async function floatOnTab(tabId: number, message: MessageOf<typeof WIDGET_FLOAT> = { type: WIDGET_FLOAT }): Promise<boolean> {
  if (await sendFloat(tabId, message)) return true;
  const site = widgetSite((await browser.tabs.get(tabId).catch(() => undefined))?.url);
  if (!site || !(await loadPlaces())[site]?.hidden) return false;
  await updatePlace(site, { hidden: false });
  for (const end = Date.now() + WAKE_WAIT_MS; Date.now() < end;) {
    await new Promise((r) => setTimeout(r, WAKE_POLL_MS));
    if (await sendFloat(tabId, message)) return true;
  }
  return false;
}
