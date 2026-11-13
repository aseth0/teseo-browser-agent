// Content extractors that do not depend on refs: metadata, selection,
// readable text (Readability → Markdown) and structured data.
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { gfm } from '@joplin/turndown-plugin-gfm';
import { LIMIT_DEFS } from '../core/limits';
import { clip, type Clipped } from '../core/clip';
import { parseVariable, type ItemsValue, type ItemsVariable, type PageValue } from '../skills/variables';
import { all, readField, resolveVariable, structuredData } from './page-values';
export { structuredData, type StructuredData } from './page-values'; // the page script's

export interface PageMeta {
  url: string;
  title: string;
  lang: string;
  viewport: string;
  scroll: string;
}

export function pageMeta(doc: Document): PageMeta {
  const view = doc.defaultView!;
  const el = doc.scrollingElement ?? doc.documentElement;
  const max = Math.max(1, el.scrollHeight - view.innerHeight);
  return {
    url: doc.location.href,
    title: doc.title,
    lang: doc.documentElement.lang || '',
    viewport: `${view.innerWidth}x${view.innerHeight}`,
    scroll: `${Math.round((el.scrollTop / max) * 100)}%`,
  };
}

export function selectionText(doc: Document, maxChars = LIMIT_DEFS.selection.value): Clipped {
  return clip(doc.getSelection()?.toString().trim() ?? '', maxChars);
}

// `from`: the character to start from, to read on after a cut.
export function readableMarkdown(doc: Document, maxChars = LIMIT_DEFS.pageText.value, from = 0): { title: string; markdown: Clipped } {
  const clone = doc.cloneNode(true) as Document;
  const article = new Readability(clone).parse();
  const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
  turndown.use(gfm); // tables as tables, not one cell per paragraph
  turndown.remove((node) => (UNSHOWN as readonly string[]).includes(node.nodeName.toLowerCase()));
  const markdown = article?.content ? turndown.turndown(article.content) : shownText(doc).replace(/\n\s*\n\s*/g, '\n\n').trim();
  return { title: article?.title || doc.title, markdown: clip(markdown, maxChars, from) };
}

// What holds no text a reader sees: a script's code, a style's rules, an SVG's or an embed's insides would
// otherwise be read as the page's.
const UNSHOWN = ['script', 'style', 'noscript', 'template', 'svg', 'object', 'iframe'] as const;

// The body's text without them, when Readability finds no article.
function shownText(doc: Document): string {
  const body = doc.body?.cloneNode(true) as HTMLElement | undefined;
  if (!body) return '';
  for (const el of body.querySelectorAll(UNSHOWN.join())) el.remove();
  return body.textContent ?? '';
}

// Values for site skill variables (skills/variables), resolved on this page. Each value is cut to
// maxChars, a list to maxItems records; a variable that matches nothing gets an empty string (items:
// no records). The page script has no Settings → Limits of its own: the defaults, but for what the
// background sends.
export function variableValues(doc: Document, tokens: string[], maxChars = LIMIT_DEFS.skillValue.value, maxItems = LIMIT_DEFS.skillItems.value): Record<string, PageValue> {
  const jsonLd = structuredData(doc).jsonLd;
  const out: Record<string, PageValue> = {};
  for (const token of tokens) {
    const v = parseVariable(token);
    out[token] = v?.kind === 'items' ? itemsOf(doc, v, maxChars, maxItems) : v?.kind === 'page' ? readableMarkdown(doc, maxChars).markdown : clip(resolveVariable(doc, jsonLd, v), maxChars);
  }
  return out;
}

// One record per container; each field is the first match inside it (or the container itself).
function itemsOf(doc: Document, v: ItemsVariable, maxChars: number, maxItems: number): ItemsValue {
  const containers = all(doc, v.container);
  const items = containers.slice(0, maxItems).map((box) =>
    Object.fromEntries(
      v.fields.map((f) => {
        const el = f.css ? all(box, f.css)[0] : box;
        return [f.name, el ? readField(el, f.attr).slice(0, maxChars) : ''];
      }),
    ),
  );
  return { items, total: containers.length };
}

