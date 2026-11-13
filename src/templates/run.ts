// Page templates run on a tab, each through the page's bridge: one view, the one for the page's URL,
// or every template of a turn.
import { errorText } from '../core/errors';
import { limit } from '../core/limits';
import { text } from '../core/model-texts';
import { callPage } from '../page/bridge';
import type { TemplateRun } from './liquid';
import { NOT_RUN, pickView, urlPath, viewBodies, type TemplateResult } from './render';
import type { PageTemplate } from './types';

// One view of a page template run on the tab; an error when the page cannot be read.
export async function runView(tabId: number, t: PageTemplate, view: string): Promise<TemplateRun> {
  try {
    return await callPage(tabId, { op: 'template', views: viewBodies(t), view, maxChars: limit('templateOutput') });
  } catch (e) {
    return { ...NOT_RUN, error: text('template.page_unreadable', { error: errorText(e) }) };
  }
}

// A page template on the tab: the view for its URL (or the one named), run.
export async function runPageTemplate(tabId: number, t: PageTemplate, url: string | undefined, view?: string): Promise<TemplateResult> {
  const picked = pickView(t, url, view);
  if (!picked) return { path: urlPath(url) };
  return { ...picked, run: await runView(tabId, t, picked.view.name) };
}

// The page templates on the tab, by template id.
export async function runPageTemplates(tabId: number, templates: PageTemplate[], url: string | undefined): Promise<Record<string, TemplateResult>> {
  const results = await Promise.all(templates.map((t) => runPageTemplate(tabId, t, url)));
  return Object.fromEntries(templates.map((t, i) => [t.id, results[i]!]));
}
