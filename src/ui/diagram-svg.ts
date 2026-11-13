// pele's SVG of a diagram, imported through an allowlist instead of inserted as markup: its source is
// the model's text (a Mermaid block, or a turn's steps), which may echo the page. pele is asked for no
// links and no images; this keeps only what it draws with (shapes, text, its classes and inline
// styles) and drops anything else: scripts, event handlers, links, embedded content, and every
// reference outside the SVG (url(…) but to its own #ids).

const NS = 'http://www.w3.org/2000/svg';
const ELEMENTS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'title', 'desc',
  'defs', 'marker', 'clipPath', 'linearGradient', 'stop']);
const ATTRIBUTES = new Set([
  'id', 'class', 'style', 'role', 'aria-roledescription', 'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-hidden', 'data-id',
  'd', 'points', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'dx', 'dy', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'viewBox', 'preserveAspectRatio',
  'transform', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
  'stroke-dashoffset', 'stroke-opacity', 'opacity', 'clip-path', 'color', 'display', 'visibility', 'cursor',
  'font-family', 'font-size', 'font-style', 'font-weight', 'text-anchor', 'dominant-baseline', 'alignment-baseline', 'letter-spacing', 'text-decoration',
  'markerWidth', 'markerHeight', 'refX', 'refY', 'orient', 'markerUnits', 'clipPathUnits', 'offset', 'stop-color', 'stop-opacity', 'gradientUnits',
  'gradientTransform', 'xml:space',
]);
// A url(…) is kept only when it points inside the SVG (#id); nor are escapes, scripts or CSS
// expressions and imports.
const URL_REF = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
const UNSAFE = /\\|javascript:|expression\s*\(|@import|image-set\(|(?:^|[^-\w])image\(/i;
const safeValue = (value: string) => !UNSAFE.test(value) && [...value.matchAll(URL_REF)].every((m) => /^#[\w.:-]+$/.test(m[2]!.trim()));

// The SVG cleaned, as an element of `doc` to insert; none when the markup is not an SVG.
export function diagramSvg(markup: string, doc: Document = document): SVGSVGElement | undefined {
  const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const root = parsed.documentElement;
  if (parsed.getElementsByTagName('parsererror').length || root.namespaceURI !== NS || root.localName !== 'svg') return undefined;
  const copy = (from: Element, to: Element) => {
    for (const attr of Array.from(from.attributes)) {
      const name = attr.namespaceURI && attr.prefix !== 'xml' ? '' : attr.name;
      if (ATTRIBUTES.has(name) && safeValue(attr.value)) to.setAttribute(name, attr.value);
    }
    for (const node of Array.from(from.childNodes)) {
      if (node.nodeType === node.TEXT_NODE) to.append(doc.createTextNode(node.textContent ?? ''));
      else if (node.nodeType === node.ELEMENT_NODE) {
        const child = node as Element;
        if (child.namespaceURI !== NS || !ELEMENTS.has(child.localName) || child.localName === 'svg') continue;
        const kept = doc.createElementNS(NS, child.localName);
        copy(child, kept);
        to.append(kept);
      }
    }
  };
  const svg = doc.createElementNS(NS, 'svg');
  copy(root, svg);
  return svg;
}
