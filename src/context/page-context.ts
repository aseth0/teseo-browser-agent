// The <untrusted_page_content> block attached to user messages. Pure, so the options page
// can show the same template.
import { LIMIT_DEFS } from '../core/limits';
import { text } from '../core/model-texts';
import type { ContextBlock } from '../core/types';
import { block, fitBlocks, MIN_USEFUL_TOKENS } from './budget';

export interface PageSnapshot {
  url: string;
  title: string;
  lang: string;
  viewport: string;
  scroll: string;
  selection: string;
  snapshot: string;
}

// How the model is told which part of the page block was left out.
const PART_NAMES: Partial<Record<ContextBlock['kind'], string>> = { 'page-meta': 'page details', selection: 'selected text', 'a11y-tree': 'visible elements' };
const partName = (b: ContextBlock) => PART_NAMES[b.kind] ?? b.kind;

// Fits the parts into the token budget (metadata first, then selection, then elements).
// `replacedBy`: a page template whose data goes instead of the visible elements.
export function formatPageContext(p: PageSnapshot, budgetTokens = LIMIT_DEFS.pageBudget.value, replacedBy?: string): string {
  const elements = replacedBy
    ? text('page.elements_replaced', { template_name: replacedBy })
    : p.snapshot && text('page.elements', { visible_elements: p.snapshot });
  const blocks = fitBlocks(
    [
      block('page-meta', 100, text('page.meta', { url: p.url, title: p.title, language: p.lang, viewport: p.viewport, scroll: p.scroll })),
      block('selection', 90, p.selection && text('page.selection', { selected_text: p.selection })),
      block('a11y-tree', 50, elements),
    ],
    budgetTokens,
    MIN_USEFUL_TOKENS,
    { limit: 'pageBudget', name: partName, leftOut: (b) => text('page.dropped', { left_out: partName(b) }) },
  );
  return wrapPageContext(p.url, blocks.map((b) => b.content).join('\n\n'));
}

export function wrapPageContext(url: string, body: string): string {
  return text('page.block', { url: url.replace(/"/g, '%22'), page_sections: body });
}
