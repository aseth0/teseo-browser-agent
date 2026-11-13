// Page templates: the built-in ones (templates/*/TEMPLATE.md, bundled at build time) plus the
// user's own, stored under their own key.
import { listField, parseFrontmatter } from '../skills/parser';
import { createCollection } from '../storage/collection';
import { newView, type PageTemplate, type TemplateView } from './types';

const files = import.meta.glob<string>('../../templates/*/TEMPLATE.md', { query: '?raw', import: 'default', eager: true });

// A view starts with a comment line: <!-- view: name | paths: /a*, /b* | replace_page: true | description: … -->
// (paths, replace_page and description optional; no paths: a block for render; no | in a description).
const VIEW_START = /^<!--\s*view:(.*)-->\s*$/gm;

// TEMPLATE.md: name, description and matches in the frontmatter; then its views.
export function parseTemplateMarkdown(md: string): Omit<PageTemplate, 'id' | 'enabled'> {
  const { fields, body } = parseFrontmatter(md, 'TEMPLATE.md');
  const name = typeof fields.name === 'string' ? fields.name : '';
  if (!name) throw new Error('TEMPLATE.md needs a name');
  const description = typeof fields.description === 'string' ? fields.description : '';
  const starts = [...body.matchAll(VIEW_START)];
  if (!starts.length) throw new Error(`TEMPLATE.md of "${name}" has no views (<!-- view: name | paths: … -->)`);
  const views = starts.map((m, i): TemplateView => {
    const [viewName = '', ...options] = m[1]!.split('|').map((s) => s.trim());
    const option = (key: string) => options.find((o) => o.startsWith(`${key}:`))?.slice(key.length + 1).trim() ?? '';
    const end = starts[i + 1]?.index ?? body.length;
    const description = option('description');
    return {
      name: viewName,
      paths: option('paths').split(',').map((p) => p.trim()).filter(Boolean),
      replacePage: option('replace_page') === 'true',
      ...(description && { description }),
      body: body.slice(m.index + m[0].length, end).trim(),
    };
  });
  return { name, description, matches: listField(fields.matches), views };
}

// Before views, a template had one body for all its pages: it becomes its only view. The body and
// replacePage stay beside it, a copy never read, for earlier versions sharing the profile (any save
// writes every item as read here).
type StoredTemplate = PageTemplate & { body?: string; replacePage?: boolean };
export function upgradeTemplate(t: StoredTemplate): PageTemplate {
  if (t.views) return t;
  const { body = '', replacePage = false } = t;
  return { ...t, views: [{ ...newView(), replacePage, body }] };
}

const BUILTIN: Omit<PageTemplate, 'enabled'>[] = Object.values(files).map((md) => {
  const t = parseTemplateMarkdown(md);
  return { ...t, id: `builtin:${t.name}`, builtin: true };
});

export const templateStore = createCollection<PageTemplate>('templates', BUILTIN, upgradeTemplate);

