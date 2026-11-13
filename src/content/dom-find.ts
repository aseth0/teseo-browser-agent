import { errorText } from '../core/errors';
import { HIDDEN } from '../recording/recording';
import { collapseSpaces, fold } from '../core/util';
import type { RefStore } from './a11y';
import { clipName, isHidden, nameOf, quote, roleOf } from './a11y-names';
import { frameDocument } from './dom-tree';

// browser.find_in_dom: elements matching a CSS selector, in document order, also inside open
// shadow roots and same-origin iframes (searched on their own: a selector does not cross into them).
interface DomMatch {
  ref: string;
  tag: string;
  role: string | null;
  name: string;
  hidden: boolean;
  attrs: Record<string, string>;
}

export interface DomFound {
  lines: string[];
  matches: DomMatch[];
  total: number; // every match, listed or not
}

const KEY_ATTRS = ['id', 'name', 'type', 'placeholder', 'aria-label', 'href', 'value'];
const ATTR_CHARS = 80;
// A password field's value attribute (one the server filled in) is never shown, nor matched by attr.
export const isSecret = (el: Element, attr: string) => attr === 'value' && el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'password';

// A selector the page cannot parse, as an error the model can act on.
export function checkSelector(doc: Document, selector: string): void {
  try {
    doc.querySelector(selector);
  } catch (e) {
    throw new Error(`Invalid CSS selector ${quote(selector)}: ${errorText(e)}`);
  }
}

// Every element from `el` down, in document order, also inside open shadow roots and same-origin iframes.
export function walkDeep(el: Element, visit: (el: Element) => void): void {
  visit(el);
  if (el.shadowRoot) for (const c of el.shadowRoot.children) walkDeep(c, visit);
  const inner = frameDocument(el)?.documentElement;
  if (inner) walkDeep(inner, visit);
  for (const c of el.children) walkDeep(c, visit);
}

export function findInDom(doc: Document, refs: RefStore, selector: string, opts: { attr?: string; limit?: number } = {}): DomFound {
  checkSelector(doc, selector);
  const limit = opts.limit ?? 20;
  const needle = fold(opts.attr?.trim() ?? ''); // matched whatever its case and accents
  const has = (value: string) => fold(value).includes(needle);
  const found: Element[] = [];
  let total = 0;

  walkDeep(doc.documentElement, (el) => {
    if (!el.matches(selector)) return;
    const hit = !needle || [...el.attributes].some((a) => !isSecret(el, a.name) && has(a.value));
    if (hit && total++ < limit) found.push(el);
  });

  const origin = doc.location?.origin ?? '';
  const matches = found.map((el): DomMatch => {
    const role = roleOf(el);
    const attrs: Record<string, string> = {};
    for (const a of KEY_ATTRS) {
      let v = a === 'value' && 'value' in el && el.tagName !== 'BUTTON' ? String((el as HTMLInputElement).value) : el.getAttribute(a);
      if (v === null || (a === 'value' && v === '' && !el.hasAttribute('value'))) continue;
      if (isSecret(el, a) && v) v = HIDDEN;
      if (a === 'href' && origin && v.startsWith(origin)) v = v.slice(origin.length) || '/';
      attrs[a] = clipName(collapseSpaces(v), ATTR_CHARS);
    }
    // The attribute that matched attr, when it is not one of the usual ones.
    if (needle && !KEY_ATTRS.some((a) => attrs[a] !== undefined && has(attrs[a]))) {
      const a = [...el.attributes].find((x) => !(x.name in attrs) && !isSecret(el, x.name) && has(x.value));
      if (a) attrs[a.name] = clipName(collapseSpaces(a.value), ATTR_CHARS);
    }
    return { ref: refs.refFor(el), tag: el.tagName.toLowerCase(), role, name: nameOf(el, role), hidden: isHidden(el), attrs };
  });
  const lines = matches.map((m) =>
    [m.tag, m.role, m.name && quote(m.name), `[${m.ref}]`, ...Object.entries(m.attrs).map(([k, v]) => `${k}=${quote(v)}`), m.hidden && 'hidden']
      .filter(Boolean)
      .join(' '),
  );
  return { lines, matches, total };
}
