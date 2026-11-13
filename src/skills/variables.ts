import type { Clipped } from '../core/clip';

// Page values a site skill asks for, written in its instructions as Web Clipper–style variables:
//   {{selector:h1.title}}         text of the matching elements
//   {{selector:img.hero?src}}     an attribute of the matching elements
//   {{meta:og:price}}             a <meta> by name or property
//   {{schema:@Product:offers.price}}  a schema.org JSON-LD value
//   {{items:li.result; title=h3; url=a?href}}  one record per container, each field the first match inside
//   {{url}}                       the page's address (an id in it: a ticket's key)
//   {{page}}                      the page's main text as Markdown (Readability), as browser.get_page_text reads it
// The page script resolves them; the values are page content, sent apart as untrusted.

export type PageVariable =
  | { kind: 'selector'; css: string; attr?: string }
  | { kind: 'meta'; name: string }
  | { kind: 'schema'; type: string; path: string[] }
  | { kind: 'url' }
  | { kind: 'page' }
  | ItemsVariable;

export type ItemsVariable = { kind: 'items'; container: string; fields: ItemField[] };

// A field of an items record: an element inside the container (none: the container itself),
// its text or one of its attributes.
interface ItemField {
  name: string;
  css?: string;
  attr?: string;
}

// The records of an items variable as the page read them ("" = field not found), and how many
// containers matched (more than the records when there were too many to send).
export interface ItemsValue {
  items: Record<string, string>[];
  total: number;
}

// What the page reads for one variable.
export type PageValue = Clipped | ItemsValue;

const VARIABLE_SOURCE = String.raw`\{\{(?:(url|page)|(selector|meta|schema|items):([^}]+))\}\}`;
const VARIABLE = new RegExp(VARIABLE_SOURCE, 'g');
const ONE_VARIABLE = new RegExp(`^${VARIABLE_SOURCE}$`);
const FIELD = /^(\w+)\s*=\s*(.*)$/;

// The variables written in a text, each once, in order.
export function findVariables(text: string): string[] {
  return [...new Set([...text.matchAll(VARIABLE)].map((m) => m[0]))];
}

export function parseVariable(token: string): PageVariable | null {
  const m = ONE_VARIABLE.exec(token);
  if (!m) return null;
  if (m[1]) return { kind: m[1] as 'url' | 'page' };
  const arg = m[3]!.trim();
  switch (m[2]) {
    case 'selector':
      return { kind: 'selector', ...cssAndAttr(arg) };
    case 'items':
      return parseItems(arg);
    case 'meta':
      return { kind: 'meta', name: arg };
    default: {
      // @Type:path.to.value
      const typed = /^@([^:]+):(.+)$/.exec(arg);
      return typed ? { kind: 'schema', type: typed[1]!, path: typed[2]!.split('.') } : null;
    }
  }
}

// "css?attr" → its parts; either may be missing.
function cssAndAttr(arg: string): { css: string; attr?: string } {
  const [css, attr] = arg.split('?');
  return { css: css!.trim(), attr: attr?.trim() || undefined };
}

// "container; name=css?attr; …": at least one field, every one named.
function parseItems(arg: string): PageVariable | null {
  const [container, ...rest] = arg.split(';').map((p) => p.trim());
  const fields: ItemField[] = [];
  for (const part of rest.filter(Boolean)) {
    const f = FIELD.exec(part);
    if (!f) return null;
    const { css, attr } = cssAndAttr(f[2]!);
    fields.push({ name: f[1]!, css: css || undefined, attr });
  }
  return container && fields.length ? { kind: 'items', container, fields } : null;
}
