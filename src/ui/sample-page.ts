// Page data for the prompt preview's "Example" mode: an invented page, or a real URL read
// the same way the side panel reads the active tab.
import { browser } from 'wxt/browser';
import { limit } from '../core/limits';
import { withMarker } from '../core/model-texts';
import type { PageSnapshot } from '../context/page-context';
import { runPageTemplates } from '../templates/run';
import { closeBackgroundTab, createBackgroundTab, LOAD_TIMEOUT_MS } from '../page/background-tab';
import { callPage, waitForLoad } from '../page/bridge';
import { skillValueText } from '../skills/prompt';
import type { TemplateResult } from '../templates/render';
import type { PageTemplate } from '../templates/types';
import { isRestrictedUrl, originPattern } from '../page/permissions';
import type { WebSearchSettings } from '../storage/settings-types';

export const SAMPLE_MESSAGE = 'Add the white ones to the cart';
export const SAMPLE_FOLLOW_UP = 'How much is shipping?';
// What the model says after the click, in the conversation preview.
export const SAMPLE_REPLY = 'Done: I clicked it. Anything else?';
export const SAMPLE_REPLY_2 = [
  "This page **doesn't show** shipping costs; they usually appear in the *cart*:",
  '',
  '- Open the cart with `browser__click` on its link',
  '- Look for a line like **Shipping**',
  '',
  '```js',
  "await click('ref_12'); // the cart link",
  '```',
].join('\n');

export const SAMPLE_PAGE: PageSnapshot = {
  url: 'https://shop.example.com/headphones/aurora-x2',
  title: 'Aurora X2 Wireless Headphones — Shop Example',
  lang: 'en',
  viewport: '1280x800',
  scroll: '0%',
  selection: 'Active noise cancelling with 30 h of battery',
  snapshot: [
    '--- banner ---',
    '[Shop Example](/) [ref_1]',
    'search: searchbox "Search products" [ref_2] value=""',
    '--- main ---',
    '# Aurora X2 Wireless Headphones',
    'combobox "Color" [ref_3] value="Black"',
    'button "Add to cart" [ref_4]',
    '[Reviews (214)](/headphones/aurora-x2#reviews) [ref_5]',
  ].join('\n'),
};

// Opens the URL in a background tab (never focused) once it has loaded. Must be called from a
// click: the first thing it does is ask for the site permission. The caller closes the tab. `web`:
// Settings → Web search (muted, its group).
export async function openBackgroundTab(url: string, web: WebSearchSettings | undefined): Promise<number> {
  if (!/^https?:\/\//i.test(url) || isRestrictedUrl(url)) throw new Error('Only http(s) pages can be read');
  if (!(await browser.permissions.request({ origins: [originPattern(url)] }))) throw new Error('Permission to read the site was not granted');
  const tabId = await createBackgroundTab(url, { web });
  await waitForLoad(tabId, LOAD_TIMEOUT_MS); // gives up quietly after the timeout
  return tabId;
}

export const closeTab = closeBackgroundTab;

// Reads the URL in a background tab, with the page variables its site skills ask for and the
// results of its page templates, and closes it. Must be called from a click (see openBackgroundTab).
export async function capturePage(
  url: string,
  vars: string[],
  templates: PageTemplate[],
  web: WebSearchSettings | undefined,
): Promise<{ page: PageSnapshot; values: Record<string, string>; results: Record<string, TemplateResult> }> {
  const tabId = await openBackgroundTab(url, web);
  try {
    const ctx = await callPage(tabId, { op: 'context', maxNodes: limit('pageElements') });
    const read = vars.length ? await callPage(tabId, { op: 'values', vars, maxChars: limit('skillValue'), maxItems: limit('skillItems') }) : {};
    const values = Object.fromEntries(Object.entries(read).map(([v, c]) => [v, skillValueText(c)]));
    const results = await runPageTemplates(tabId, templates, ctx.meta.url);
    return { page: { ...ctx.meta, selection: '', snapshot: withMarker(ctx.snapshot, 'pageElements', 'result.snapshot_truncated') }, values, results };
  } finally {
    await closeTab(tabId);
  }
}
