// The user's SVG for the bubble (Settings → Bubble), pasted or fetched from a URL, made safe: only
// drawing elements and attributes are kept; scripts, event handlers, links, styles, embedded images,
// animations and every reference outside the SVG (url(…) but to its own #ids) are removed. Settings
// does it before saving, and the widget again before drawing it (storage.local is not the page's,
// but the copy it reads is not checked otherwise). Never inserted as markup: the widget imports the
// parsed, cleaned tree into its closed shadow root.

export const MAX_SVG = 16 * 1024; // bytes of the cleaned SVG, kept in the settings
export const MAX_SVG_FETCH = 64 * 1024; // bytes fetched from a URL, before cleaning

export const SVG_NS = 'http://www.w3.org/2000/svg';
const ELEMENTS = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask']);
const DRAWN = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon']);
// Dropped without saying: what does not draw (a title shows as a tooltip, nothing else).
const QUIET = new Set(['title', 'desc', 'metadata']);
const ATTRIBUTES = new Set([
  'id', 'd', 'points', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'width', 'height', 'viewBox', 'preserveAspectRatio',
  'transform', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray',
  'stroke-dashoffset', 'stroke-opacity', 'opacity', 'clip-path', 'clip-rule', 'mask', 'offset', 'stop-color', 'stop-opacity', 'gradientUnits',
  'gradientTransform', 'spreadMethod', 'clipPathUnits', 'maskUnits', 'maskContentUnits', 'pathLength', 'color', 'visibility', 'vector-effect',
]);
const LOCAL_URL = /^url\(\s*(['"]?)#[\w.-]+\1\s*\)$/;

export type SvgCheck = { svg: string; removed: string[] } | { error: string };

// What was removed, by kind, as "<script> ×2" or "event handlers".
function tally() {
  const counts = new Map<string, number>();
  return {
    add: (what: string) => counts.set(what, (counts.get(what) ?? 0) + 1),
    list: () => [...counts].map(([what, n]) => (n > 1 ? `${what} ×${n}` : what)),
  };
}

function attributeKind(name: string): string {
  if (/^on/i.test(name)) return 'event handlers';
  if (/href$/i.test(name)) return 'links';
  if (name === 'style' || name === 'class') return 'styles';
  return `the attribute ${name}`;
}

// The SVG cleaned, as an element of its own document, with what was removed; or why it cannot be used.
function clean(markup: string): { svg: SVGSVGElement; removed: string[] } | { error: string } {
  if (new TextEncoder().encode(markup).length > MAX_SVG_FETCH) return { error: `It is larger than ${MAX_SVG_FETCH / 1024} KB.` };
  const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const root = parsed.documentElement;
  if (parsed.getElementsByTagName('parsererror').length || root.namespaceURI !== SVG_NS || root.localName !== 'svg') return { error: 'This is not an SVG.' };
  const out = document.implementation.createDocument(SVG_NS, 'svg', null);
  const removed = tally();
  let drawn = 0;
  const copy = (from: Element, to: Element) => {
    for (const attr of Array.from(from.attributes)) {
      if (attr.name === 'xmlns' || attr.name.startsWith('xmlns:')) continue;
      const value = attr.value.trim();
      if (attr.namespaceURI || !ATTRIBUTES.has(attr.name)) removed.add(attributeKind(attr.localName));
      else if (/url\(/i.test(value) && !LOCAL_URL.test(value)) removed.add('external references');
      else if (/[\\]|javascript:|expression\s*\(/i.test(value)) removed.add(`the attribute ${attr.name}`);
      else to.setAttribute(attr.name, value);
    }
    for (const child of Array.from(from.children)) {
      if (child.namespaceURI === SVG_NS && ELEMENTS.has(child.localName) && child.localName !== 'svg') {
        const kept = out.createElementNS(SVG_NS, child.localName);
        if (DRAWN.has(child.localName)) drawn++;
        copy(child, kept);
        to.append(kept);
      } else if (!QUIET.has(child.localName)) removed.add(`<${child.localName}>`);
    }
  };
  const svg = out.documentElement as unknown as SVGSVGElement;
  copy(root, svg);
  // Sized by the bubble: its grid from the viewBox, else from its own size.
  const [w, h] = [parseFloat(svg.getAttribute('width') ?? ''), parseFloat(svg.getAttribute('height') ?? '')];
  if (!svg.hasAttribute('viewBox') && w > 0 && h > 0) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  if (!drawn) return { error: 'Nothing drawable was left once the unsafe parts were removed.' };
  return { svg, removed: removed.list() };
}

// The SVG cleaned, as markup to keep, with what was removed; or why it cannot be used.
export function safeSvg(markup: string): SvgCheck {
  const check = clean(markup);
  if ('error' in check) return check;
  const svg = new XMLSerializer().serializeToString(check.svg);
  if (new TextEncoder().encode(svg).length > MAX_SVG) return { error: `It is larger than ${MAX_SVG / 1024} KB.` };
  return { svg, removed: check.removed };
}

// The kept SVG as an element for the widget's shadow root (cleaned again), or none.
export function safeSvgElement(markup: string | undefined, doc: Document = document): SVGSVGElement | undefined {
  const check = markup ? clean(markup) : undefined;
  return check && 'svg' in check ? doc.importNode(check.svg, true) : undefined;
}
