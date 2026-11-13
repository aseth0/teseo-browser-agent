// What the model sees of the page templates: for each one matching the tab, the view that applies
// to the URL, as a trusted note and its output, read from the page, as page content. Pure, so the
// options page builds the same thing.
import { TEMPLATE_SOURCE } from '../core/sources';
import { limit, limitText } from '../core/limits';
import type { ContextItem } from '../core/messages';
import { cutNote, stripMarks, text } from '../core/model-texts';
import { matchesAny, matchesPath } from '../skills/match';
import type { FilterCall, TemplateRun } from './liquid';
import type { PageTemplate, TemplateView } from './types';

export function templatesFor(templates: PageTemplate[], url: string | undefined): PageTemplate[] {
  return templates.filter((t) => t.enabled && matchesAny(t.matches, url));
}

// The view a page gets: the first whose paths match its URL (`matched`: that path), or the one
// asked for by name, whatever the URL. None when no view matches.
export function pickView(t: PageTemplate, url: string | undefined, name?: string): { view: TemplateView; matched?: string } | undefined {
  if (name !== undefined) {
    const view = t.views.find((v) => v.name === name);
    return view && { view };
  }
  const u = parseUrl(url);
  if (!u) return undefined;
  for (const view of t.views) {
    const matched = view.paths.find((p) => matchesPath(p, u));
    if (matched) return { view, matched };
  }
  return undefined;
}

const parseUrl = (url: string | undefined) => {
  try {
    return url ? new URL(url) : undefined;
  } catch {
    return undefined;
  }
};

// The path and query of a URL, as views match them.
export const urlPath = (url: string | undefined) => {
  const u = parseUrl(url);
  return u ? u.pathname + u.search : '';
};

// The views of a template by name: what the page script renders.
export const viewBodies = (t: PageTemplate) => Object.fromEntries(t.views.map((v) => [v.name, v.body]));

// How a template did on a page: the view applied (`matched`: the path; none when chosen by name)
// and its run, or no view for that page (`path`: the page's).
export type TemplateResult = { view: TemplateView; matched?: string; run: TemplateRun } | { view?: undefined; path: string };

// A view that could not run on the page (e.g. it cannot be read): nothing found.
export const NOT_RUN: TemplateRun = { output: '', omittedLines: 0, calls: [], found: 0 };

// What a run sends: its output and, when it was cut, how many lines were left out; or the error.
export function templateOutput(run: TemplateRun): string {
  if (run.error) return templateError(run.error);
  const lines = String(run.omittedLines);
  const note = `Site template output: ${lines} lines left out (limit ${limitText('templateOutput')})`;
  const cut = run.omittedLines ? cutNote(note) + text('template.truncated', { lines, max_chars: String(limit('templateOutput')) }) : '';
  return run.output + cut;
}

// Liquid errors that say little, and the hint that follows them.
const ERROR_HINTS = [
  ['invalid range syntax', 'template.hint_parentheses'],
  ['render limit exceeded', 'template.hint_render_limit'],
] as const;

// An error of the template, with a hint when Liquid's own words say little.
function templateError(error: string): string {
  const hint = ERROR_HINTS.find(([words]) => error.includes(words));
  return text('template.diag_error', { error }) + (hint ? `\n${text(hint[1])}` : '');
}

// The untrusted block with the template's output.
export const templateBlock = (name: string, output: string) => text('template.data', { template_name: name, template_output: output });

// The context items of the matching templates that have a view for the page, given their results
// by id, and the one whose data replaces the page's visible elements: the first whose view asks
// for it and found something on the page (otherwise the page goes as usual).
export function templateItems(active: PageTemplate[], results: Record<string, TemplateResult>): { items: ContextItem[]; replacedBy?: string } {
  const items: ContextItem[] = [];
  let replacedBy: string | undefined;
  for (const t of active) {
    const result = results[t.id];
    if (!result?.view) continue;
    if (result.view.replacePage && templateFound(result.run)) replacedBy ??= t.name;
    items.push({ kind: 'page', text: templateMessage(t.name, result.view.name, result.run), source: `${TEMPLATE_SOURCE}${t.name}/${result.view.name}` });
  }
  return { items, replacedBy };
}

// What one template adds to the message: the note and the data block.
export const templateMessage = (template: string, view: string, run: TemplateRun) =>
  `${text('template.note', { template_name: template, view_name: view })}\n${templateBlock(template, templateOutput(run))}`;

// Which view applied, how each read filter did on the page (by view and line), and the size of the
// output: what templates.run reports and the editor shows.
export function templateDiagnosis(result: TemplateResult): string {
  if (!result.view) return text('template.diag_no_view', { path: result.path });
  const { view, matched, run } = result;
  const head =
    matched === undefined ? text('template.diag_view_forced', { view_name: view.name }) : text('template.diag_view', { view_name: view.name, path: matched });
  const lines = run.calls.map((c) =>
    text('template.diag_line', { view_name: c.view, line: String(c.line), filter: c.filter, argument: c.argument, result: callResult(c) }),
  );
  const end = run.error ? templateError(run.error) : text('template.diag_size', { chars: String(stripMarks(run.output).length) });
  return [head, ...lines, end, ...(emptyInHiddenTab(run) ? [text('template.hidden_tab')] : [])].join('\n');
}

// The diagnosis in a line, for its folded block: how many lookups it made and how many came short
// (nothing found, or not every time); whether it needs a look (that, an error, no view).
export function diagnosisSummary(result: TemplateResult): { line: string; open: boolean } {
  if (!result.view) return { line: 'No view for this page', open: true };
  const { run } = result;
  if (run.error) return { line: 'Error', open: true };
  const short = run.calls.filter((c) => c.hits < c.calls).length;
  const checks = `${run.calls.length} ${run.calls.length === 1 ? 'lookup' : 'lookups'}`;
  return { line: short ? `${checks}, ${short} ⚠` : `${checks}, all found`, open: short > 0 || emptyInHiddenTab(run) };
}

function callResult(c: FilterCall): string {
  const counts = { count: String(c.elements), found: String(c.hits), calls: String(c.calls) };
  if (!c.hits) return text('template.diag_missing');
  if (c.hits < c.calls) return text('template.diag_partial', counts);
  if (c.filter === 'select') return text(c.calls === 1 ? 'template.diag_elements' : 'template.diag_elements_loop', counts);
  return text('template.diag_found', counts);
}

// It found nothing, and the tab was hidden: maybe the website did not show its content.
export const emptyInHiddenTab = (run: TemplateRun) => Boolean(run.hidden && !run.error && !run.found);

// What it found on the page itself (0: nothing, or it failed): for the panel chip and "Replace page block".
export const templateFound = (run: TemplateRun) => (run.error ? 0 : run.found);
