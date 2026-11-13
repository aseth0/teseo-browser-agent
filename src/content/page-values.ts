// What a page shows, read from its DOM without changing it: its meta tags and JSON-LD, the text or
// an attribute of the elements a selector matches. The page script uses them for site skills and
// templates (content/extractors), and the page widget for the values its actions read on load.
import type { ItemsVariable, PageVariable } from '../skills/variables';

export interface StructuredData {
  meta: Record<string, string>;
  jsonLd: unknown[];
}

export function structuredData(doc: Document): StructuredData {
  const meta: Record<string, string> = {};
  for (const m of doc.querySelectorAll('meta[property^="og:"], meta[name^="twitter:"], meta[name="description"], meta[name="author"]')) {
    const key = m.getAttribute('property') ?? m.getAttribute('name');
    const value = m.getAttribute('content');
    if (key && value) meta[key] = value;
  }
  const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute('href');
  if (canonical) meta.canonical = canonical;

  const jsonLd: unknown[] = [];
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(s.textContent ?? '');
      const graph = (data as { '@graph'?: unknown[] })?.['@graph'];
      jsonLd.push(...(Array.isArray(data) ? data : Array.isArray(graph) ? graph : [data]));
    } catch {
      // malformed JSON-LD: ignored
    }
  }
  return { meta, jsonLd };
}

// The value of a variable that is not a list of records (selector, meta, schema or the page's
// address); "" when it matches nothing. {{page}} is not read here: Readability is the page script's
// (content/extractors), too big for the page widget, whose actions get it from the background.
export function resolveVariable(doc: Document, jsonLd: unknown[], v: Exclude<PageVariable, ItemsVariable> | null): string {
  if (!v) return '';
  switch (v.kind) {
    case 'selector':
      return all(doc, v.css)
        .map((el) => readField(el, v.attr))
        .filter(Boolean)
        .join('\n');
    case 'meta':
      return metaContent(doc, v.name);
    case 'schema':
      return schemaValue(jsonLd, v.type, v.path);
    case 'url':
      return doc.URL;
    case 'page':
      return '';
  }
}

// A <meta> by name or property.
export function metaContent(doc: Document, name: string): string {
  const el = [...doc.querySelectorAll('meta')].find((m) => m.getAttribute('name') === name || m.getAttribute('property') === name);
  return el?.getAttribute('content') ?? '';
}

// The value at a path of the first JSON-LD item of a type.
export function schemaValue(jsonLd: unknown[], type: string, path: string[]): string {
  const typeOf = (o: unknown) => (o as { '@type'?: string | string[] })?.['@type'];
  const item = jsonLd.find((o) => [typeOf(o)].flat().includes(type));
  const value = path.reduce<unknown>((cur, key) => (cur as Record<string, unknown> | undefined)?.[key], item);
  return value === undefined || value === null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
}

// The matches of a selector; none when it is not valid CSS.
export function all(root: ParentNode, css: string): Element[] {
  try {
    return [...root.querySelectorAll(css)];
  } catch {
    return [];
  }
}

export const readField = (el: Element, attr?: string) => (attr ? attribute(el, attr) : elementText(el));

// An element's text as shown: its lines joined with " · ", so pieces laid out apart do not run together.
export function elementText(el: Element): string {
  const shown = (el as HTMLElement).innerText ?? el.textContent ?? ''; // jsdom has no innerText
  return shown
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' · ');
}

// An attribute; links and sources as absolute URLs.
export function attribute(el: Element, name: string): string {
  const value = el.getAttribute(name) ?? '';
  if (!value || (name !== 'href' && name !== 'src')) return value;
  try {
    return new URL(value, el.ownerDocument.baseURI).href;
  } catch {
    return value;
  }
}
