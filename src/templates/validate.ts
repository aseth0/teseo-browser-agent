// What makes a page template valid, for the options editor and for templates.save (the model).
import { NAME, PATTERN } from '../skills/validate';
import { findVariables } from '../skills/variables';
import { liquidProblems, readsPage, renderProblems } from './liquid';
import { viewBodies } from './render';
import type { PageTemplate, TemplateView } from './types';

// Problems to fix before saving; empty when it can be saved. `others`: the rest of the templates.
export function templateProblems(t: PageTemplate, others: PageTemplate[]): string[] {
  const names = t.views.map((v) => v.name);
  return [
    !NAME.test(t.name) && 'Name: lowercase letters, digits and dashes (e.g. "youtube-videos").',
    others.some((o) => o.id !== t.id && o.name === t.name) && 'Another template already has this name.',
    !t.matches.length && 'URL patterns: at least one (e.g. *://www.youtube.com/*).',
    ...t.matches.filter((m) => !PATTERN.test(m)).map((m) => `Not a URL pattern: ${m} (e.g. *://www.youtube.com/*)`),
    !t.views.some((v) => v.paths.length) && 'No view has paths: add the paths of the pages a view applies to (e.g. /app/project/*, or * for all).',
    ...[...new Set(names.filter((n, i) => names.indexOf(n) !== i))].map((n) => `Two views are named "${n}".`),
    ...t.views.flatMap(viewProblems),
    ...renderProblems(viewBodies(t)),
    !t.views.some((v) => readsPage(v.body)) && 'Reads nothing from the page: use page | select, one, meta or schema.',
  ].filter((p): p is string => Boolean(p));
}

function viewProblems(v: TemplateView): string[] {
  const label = `View "${v.name}": `;
  if (!NAME.test(v.name)) return [`${label}name with lowercase letters, digits and dashes (e.g. "project").`];
  const oldSyntax = findVariables(v.body).length > 0 || /\{\{\s*(selector|meta|schema|items):/.test(v.body);
  return [
    ...v.paths.filter((p) => !p.startsWith('/') && p !== '*').map((p) => `${label}not a path: ${p} (e.g. /app/project/*, or *)`),
    ...(oldSyntax
      ? ['Uses the old {{selector:…}} / {{items:…}} syntax: rewrite it with Liquid filters (page | select: "…").']
      : liquidProblems(v.body)),
  ].map((p) => (p.startsWith(label) ? p : label + p));
}
