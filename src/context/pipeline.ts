// Context attached to each user message: small and cheap (push);
// the model requests anything else with tools (pull).
import { errorText } from '../core/errors';
import { limit } from '../core/limits';
import { text, withMarker } from '../core/model-texts';
import { callPage } from '../page/bridge';
import type { PageValue } from '../skills/variables';
import { formatPageContext, wrapPageContext } from './page-context';

interface PageContextOptions {
  replacedBy?: string; // the page template whose data goes instead of the visible elements
  noSelection?: boolean; // without the selected text (the user took it off with the panel's chip)
  budgetTokens?: number;
}

export async function buildPageContext(tabId: number, { replacedBy, noSelection = false, budgetTokens = limit('pageBudget') }: PageContextOptions = {}): Promise<string> {
  try {
    const maxNodes = replacedBy ? 0 : limit('pageElements');
    const ctx = await callPage(tabId, { op: 'context', maxNodes, maxChars: limit('selection') });
    const snapshot = withMarker({ ...ctx.snapshot, max: maxNodes }, 'pageElements', 'result.snapshot_truncated');
    const selection = noSelection ? '' : withMarker(ctx.selection, 'selection');
    return formatPageContext({ ...ctx.meta, selection, snapshot }, budgetTokens, replacedBy);
  } catch (e) {
    return wrapPageContext('', text('page.unreadable', { error: errorText(e) }));
  }
}

// The page values the site skills and page templates ask for, in one round trip. None when they
// ask for none; with the error when the page cannot be read.
export async function readPageValues(tabId: number, vars: string[]): Promise<{ values: Record<string, PageValue>; error?: string }> {
  if (!vars.length) return { values: {} };
  try {
    return { values: await callPage(tabId, { op: 'values', vars, maxChars: limit('skillValue'), maxItems: limit('skillItems') }) };
  } catch (e) {
    return { values: {}, error: errorText(e) };
  }
}
