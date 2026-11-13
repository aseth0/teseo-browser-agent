// The DOM as it is rendered: into open shadow roots and same-origin iframes.

// The document of a same-origin frame (none: another origin's, or not loaded yet).
export function contentDocumentOf(frame: HTMLIFrameElement | HTMLFrameElement): Document | undefined {
  try {
    return frame.contentDocument ?? undefined;
  } catch {
    return undefined; // cross-origin
  }
}

// The same for an element that is an iframe.
export const frameDocument = (el: Element): Document | undefined => (el.tagName === 'IFRAME' ? contentDocumentOf(el as HTMLIFrameElement) : undefined);

const SVG_NS = 'http://www.w3.org/2000/svg';
export const isSvg = (el: Element) => el.namespaceURI === SVG_NS;

// The SVG containers drawn where they are that may hold a foreignObject (SVG 2, the content model of the
// container elements). defs, symbol, marker, mask and pattern may too, but are drawn only where they are
// referenced; shapes, text and gradients cannot hold one.
const SVG_HOLDERS = new Set(['svg', 'g', 'a', 'switch']);

// The outermost foreignObjects of an SVG element (itself when it is one), through its groups: the HTML an
// SVG drawing holds (a chat app's rail icons). The rest of the drawing says nothing to read or act on, and
// is not gone into: a large inline map is thousands of paths.
export function svgForeignObjects(el: Element): Element[] {
  if (el.localName === 'foreignObject') return [el];
  if (!SVG_HOLDERS.has(el.localName)) return [];
  return [...el.children].filter(isSvg).flatMap(svgForeignObjects);
}

// "Rendered" children: open shadow DOM (with slots resolved) and same-origin iframes.
export function childrenOf(el: Element): Element[] {
  if (el.tagName === 'IFRAME') {
    const body = frameDocument(el)?.body;
    return body ? [body] : [];
  }
  if (el.tagName === 'SLOT') {
    const assigned = (el as HTMLSlotElement).assignedElements({ flatten: true });
    return assigned.length ? assigned : [...el.children];
  }
  if (el.shadowRoot) return [...el.shadowRoot.children];
  return [...el.children];
}
