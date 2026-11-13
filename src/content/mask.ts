// browser.screenshot on the engine: the page's sensitive fields painted over while it is captured. Passwords,
// card and one-time-code fields, fields named like secrets, the user's selectors for the site
// (Settings → Chromium DevTools), and frames from other sites (where payment forms live, out of this
// script's reach). Also inside open shadow roots; closed ones cannot be reached. The filter paints a
// frame's own content black too, which its background alone would not cover.
import { namedLike, SECRET_FIELDS, SECRET_KEY } from '../recording/recording';
import { contentDocumentOf } from './dom-tree';
import { all } from './page-values';

const ATTR = 'data-ba-mask';
const PAINT = 'color: #222 !important; -webkit-text-fill-color: #222 !important; background: #222 !important; text-shadow: none !important; caret-color: transparent !important; filter: brightness(0) !important;';

// The fields by selector too (SECRET_FIELDS and the user's), so one the page renders after masking is
// painted over as well; the marked ones (named like secrets, frames from other sites) by attribute.
function styleFor(selectors: string[]): string {
  const painted = [`[${ATTR}]:not(style)`, ...selectors].join(', ');
  const placeholders = [`[${ATTR}]:not(style)`, ...selectors].map((sel) => `${sel}::placeholder`).join(', ');
  return `${painted} { ${PAINT} }\n${placeholders} { color: #222 !important; -webkit-text-fill-color: #222 !important; }`;
}

type Root = Document | ShadowRoot;

// Every document and open shadow root to mask: the page's, those inside it however deep, and those
// of its frames from the same site (the script reaches into them; a frame from another site is boxed).
function roots(doc: Document): Root[] {
  const origin = doc.defaultView?.location.origin ?? '';
  const found: Root[] = [doc];
  for (let i = 0; i < found.length; i++) {
    for (const el of found[i]!.querySelectorAll('*')) {
      if (el.shadowRoot) found.push(el.shadowRoot);
      if ((el.tagName === 'IFRAME' || el.tagName === 'FRAME') && !otherSite(el as HTMLIFrameElement, origin)) {
        const inner = contentDocumentOf(el as HTMLIFrameElement);
        if (inner?.documentElement) found.push(inner);
      }
    }
  }
  return found;
}

function otherSite(frame: HTMLIFrameElement, origin: string): boolean {
  const src = frame.getAttribute('src');
  if (src && !/^(about:|javascript:)/i.test(src)) {
    try {
      if (new URL(src, frame.ownerDocument.baseURI).origin !== origin) return true;
    } catch {
      return true;
    }
  }
  return !contentDocumentOf(frame);
}

const validSelector = (doc: Document, selector: string) => {
  try {
    doc.querySelector(selector);
    return true;
  } catch {
    return false;
  }
};

// What must be masked in the page now.
function sensitive(doc: Document, extra: string[]): Set<Element> {
  const origin = doc.defaultView?.location.origin ?? '';
  const found = new Set<Element>();
  for (const root of roots(doc)) {
    for (const el of all(root, SECRET_FIELDS)) found.add(el);
    for (const el of root.querySelectorAll('input, textarea')) if (namedLike(el, SECRET_KEY)) found.add(el);
    for (const selector of extra) for (const el of all(root, selector)) found.add(el); // one not valid: left out
    for (const frame of root.querySelectorAll('iframe')) if (otherSite(frame, origin)) found.add(frame);
  }
  return found;
}

const extraOf = new Map<string, string[]>(); // each mask's own selectors, to look again when it is taken away
// A mask whose unmask never comes (the background gone mid-capture, a page too busy to answer) takes
// itself away after RESTORE_MS; the unmask that comes late then says the capture may not have been masked.
const RESTORE_MS = 30_000;
const restores = new Map<string, ReturnType<typeof setTimeout>>();

// A new mask: the sensitive fields marked and the style in every root (remaskPage with a new token).
export function maskPage(doc: Document, extra: string[]): { token: string; count: number } {
  const token = crypto.randomUUID();
  extraOf.set(token, extra);
  restores.set(token, setTimeout(() => unmaskPage(doc, token), RESTORE_MS));
  return { token, count: remaskPage(doc, token, extra) };
}

// Takes the mask away. False when what was captured may not have been masked: this document no
// longer holds it (the page navigated or replaced it, or it took itself away), or a sensitive field
// appeared since without it.
export function unmaskPage(doc: Document, token: string): boolean {
  clearTimeout(restores.get(token));
  restores.delete(token);
  const there = !!doc.querySelector(`style[${ATTR}="${token}"]`);
  const extra = extraOf.get(token) ?? [];
  extraOf.delete(token);
  const unmarked = [...sensitive(doc, extra)].some((el) => el.getAttribute(ATTR) !== token);
  for (const root of roots(doc)) for (const el of root.querySelectorAll(`[${ATTR}]`)) {
    if (el.tagName === 'STYLE') el.remove();
    else el.removeAttribute(ATTR);
  }
  return there && !unmarked;
}

// After a screenshot's view changed the layout (a phone's), what the page now shows: elements that
// look sensitive get the mask too, and new shadow roots or frames its style. How many were added.
export function remaskPage(doc: Document, token: string, extra: string[]): number {
  let added = 0;
  for (const el of sensitive(doc, extra)) {
    if (el.getAttribute(ATTR) === token) continue;
    el.setAttribute(ATTR, token);
    added++;
  }
  const selectors = [SECRET_FIELDS, ...extra.filter((sel) => validSelector(doc, sel))];
  for (const root of roots(doc)) if (!root.querySelector(`style[${ATTR}="${token}"]`)) injectStyle(root, token, selectors);
  return added;
}

// The mask's style in a document or a shadow root. A frame's document is another window's Document:
// told apart by its node type, not instanceof.
function injectStyle(root: Root, token: string, selectors: string[]) {
  const isDoc = root.nodeType === Node.DOCUMENT_NODE;
  const owner = isDoc ? (root as Document) : (root as ShadowRoot).ownerDocument;
  const style = owner.createElement('style');
  style.setAttribute(ATTR, token);
  style.textContent = styleFor(selectors);
  if (isDoc) ((root as Document).head ?? (root as Document).documentElement).appendChild(style);
  else root.appendChild(style);
}
