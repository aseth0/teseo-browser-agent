import { clip } from '../core/clip';
import { HIDDEN } from '../recording/recording';
import { checkSelector, isSecret, walkDeep } from './dom-find';
import { frameDocument, svgForeignObjects } from './dom-tree';

// browser.get_html: the cleaned markup of the elements matching a CSS selector (the outermost ones,
// also inside open shadow roots and same-origin iframes), read from character `from` on.
export interface HtmlRead {
  text: string; // at most `max` characters, from `from`
  next: number; // the character after it
  total: number; // the length of the whole cleaned markup
  count: number; // the elements it shows
}

const SKIPPED = new Set(['script', 'style', 'noscript']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
// Attributes that are long and say little about the structure: only their start.
const SHORT_ATTRS = new Set(['style', 'srcset', 'sizes']);
const SHORT_CHARS = 40;
const ATTR_CHARS = 200;

const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

function attrValue(el: Element, a: Attr): string {
  if (isSecret(el, a.name)) return HIDDEN;
  const v = a.value.replace(/\s+/g, ' ').trim();
  const max = SHORT_ATTRS.has(a.name) || v.startsWith('data:') ? SHORT_CHARS : ATTR_CHARS;
  const cut = clip(v, max);
  return cut.truncated ? `${cut.text}…` : v;
}

// An open shadow root as declarative shadow DOM; a same-origin iframe with its document's body inside.
function serialize(node: Node, out: string[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = (node as Text).data.replace(/\s+/g, ' ');
    if (t.trim()) out.push(escapeText(t));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return; // comments, processing instructions
  const el = node as Element;
  const tag = el.localName;
  if (SKIPPED.has(tag)) return;
  out.push(`<${tag}${[...el.attributes].map((a) => ` ${a.name}="${escapeAttr(attrValue(el, a))}"`).join('')}>`);
  if (VOID.has(tag)) return;
  // An SVG's drawing left out, but for the HTML in its foreignObjects.
  if (tag === 'svg') {
    for (const f of svgForeignObjects(el)) serialize(f, out);
  } else {
    if (el.shadowRoot) {
      out.push('<template shadowrootmode="open">');
      for (const c of el.shadowRoot.childNodes) serialize(c, out);
      out.push('</template>');
    }
    const body = frameDocument(el)?.body;
    for (const c of body ? [body] : el.childNodes) serialize(c, out);
  }
  out.push(`</${tag}>`);
}

export function cleanHtml(el: Element): string {
  const out: string[] = [];
  serialize(el, out);
  return out.join('');
}

export function getHtml(doc: Document, selector: string, opts: { from?: number; max: number }): HtmlRead {
  checkSelector(doc, selector);
  // Found in document order: one inside the last one kept is already shown by it.
  const found: Element[] = [];
  walkDeep(doc.documentElement, (el) => {
    if (el.matches(selector) && !found.at(-1)?.contains(el)) found.push(el);
  });
  const parts = found.map(cleanHtml);
  const all = parts.length > 1 ? parts.map((p, i) => `<!-- ${i + 1} of ${parts.length} -->\n${p}`).join('\n') : (parts[0] ?? '');
  const from = Math.min(Math.max(0, opts.from ?? 0), all.length);
  const read = clip(all.slice(from), opts.max).text;
  return { text: read, next: from + read.length, total: all.length, count: found.length };
}
