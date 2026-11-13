// Site templates as JSON, to back them up or share them (Settings → Site templates): { "templates":
// [...] }, each with its views. Imported checked as the editor checks them, and off until the user
// switches them on (what they read from pages goes with every message there). One of the name of one
// of yours replaces it; one of a built-in template's name is left out.
import { importNamed, listFrom, stringList, type ImportRow } from '../storage/import';
import type { PageTemplate, TemplateView } from './types';
import { templateProblems } from './validate';

type Shared = Pick<PageTemplate, 'name' | 'description' | 'matches' | 'views' | 'webRead'>;

export function exportTemplates(templates: PageTemplate[]): string {
  const shared = templates.filter((t) => !t.builtin).map(({ name, description, matches, views, webRead }): Shared => ({ name, description, matches, views, ...(webRead && { webRead }) }));
  return JSON.stringify({ templates: shared }, null, 2);
}

const viewOf = (v: Partial<TemplateView>): TemplateView => ({
  name: String(v?.name ?? '').trim(),
  paths: stringList(v?.paths, { trim: true }),
  replacePage: v?.replacePage === true,
  ...(typeof v?.description === 'string' && v.description.trim() && { description: v.description.trim() }),
  body: String(v?.body ?? ''),
});

// The templates in the JSON ({ "templates": [...] }, a list, or one), those left out, with why, and a row each.
export function importTemplates(json: string, existing: PageTemplate[]): { templates: PageTemplate[]; skipped: string[]; rows: ImportRow<PageTemplate>[] } {
  const { items: templates, skipped, rows } = importNamed<PageTemplate>({
    list: listFrom(json, 'templates'),
    existing,
    build: (raw, old) => {
      const item = raw as Partial<Shared>;
      const name = String(item.name ?? '').trim();
      if (old?.builtin) return { skip: `${name}: a built-in template has this name.` };
      return {
        name,
        description: String(item.description ?? '').trim(),
        matches: stringList(item.matches, { trim: true }),
        views: (Array.isArray(item.views) ? item.views : []).map(viewOf),
        enabled: false,
        ...(item.webRead === true && { webRead: true }),
      };
    },
    problems: templateProblems,
  });
  return { templates, skipped, rows };
}
