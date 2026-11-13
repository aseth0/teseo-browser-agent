// The values a page widget action reads as {{page}}: the tab's main text as Markdown (Readability), read
// here through the page script as browser.get_page_text reads it, cut to Settings → Limits' "Page text
// for a page widget action". The widget in the page has no Readability (it is plain DOM, put into every
// page its actions match) and reads only the others, which are cut to MAX_PAGE_VALUE.
import { limit } from '../core/limits';
import { withMarker } from '../core/truncate';
import { errorText } from '../core/errors';
import { callPage } from '../page/bridge';
import { pageTextNames, type WidgetAction } from '../widget/actions';

type Values = { input: string; reads?: Record<string, string> };

// The values with the page's text under each name that reads it; as they are when none does, or when
// there is no tab (Settings → Actions' Try with none chosen: the value stays empty, as the others).
export async function withPageText(action: Pick<WidgetAction, 'reads' | 'steps'>, values: Values, tabId: number | undefined, read = readPageText): Promise<Values | { error: string }> {
  const names = pageTextNames(action);
  if (!names.length || tabId === undefined) return values;
  let page: string;
  try {
    page = await read(tabId);
  } catch (e) {
    return { error: `The page cannot be read: ${errorText(e)}` };
  }
  return { ...values, reads: { ...values.reads, ...Object.fromEntries(names.map((n) => [n, page])) } };
}

async function readPageText(tabId: number): Promise<string> {
  const res = await callPage(tabId, { op: 'text', maxChars: limit('actionPageText') });
  return withMarker(res.markdown, 'actionPageText');
}
