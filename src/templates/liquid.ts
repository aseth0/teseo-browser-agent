// Page templates are Liquid (liquidjs: an interpreter, no eval, so it runs under the extension's
// CSP). The page script renders them over the live DOM (content/template-run) with filters of its
// own that read the page:
//   page | select: "css"          the matching elements (also el | select: "css", inside an element)
//   x | one: "css"                the first match, or nothing
//   el | attr: "href"             an attribute (href and src as absolute URLs)
//   page | meta: "og:title"       a <meta> by name or property
//   page | schema: "@Type:path"   a schema.org JSON-LD value
// Printing an element gives its text. Every printed value is page content: marked as such
// (core/model-texts) and never parsed as template. A view inserts another view of its template with
// {% render "name" %}: the only "files" templates can load.
import { Liquid, Tag, type TagToken, type TopLevelToken } from 'liquidjs';
import { errorText } from '../core/errors';
import { limit } from '../core/limits';
import { MARKS, neutralizeTags, stripMarks } from '../core/origin-marks';

const READ_FILTERS = ['select', 'one', 'attr', 'meta', 'schema'] as const;
export type ReadFilter = (typeof READ_FILTERS)[number];

// One read filter at one place of a view, over every time it ran (once per loop iteration).
export interface FilterCall {
  view: string;
  line: number;
  filter: ReadFilter;
  argument: string;
  calls: number;
  hits: number; // calls that found something
  elements: number; // select: elements found in all
}

export interface TemplateRun {
  output: string; // page values marked as page content
  omittedLines: number; // lines cut to fit the output limit (core/limits templateOutput)
  calls: FilterCall[]; // in view and line order
  found: number; // read on the page itself: elements of page | select, plus page reads that found something
  error?: string; // the template could not be parsed or rendered
  hidden?: boolean; // the tab was hidden: some websites only show their content in a visible tab
}

// The engine with what templates may do, the same where they are validated and where they run.
// `views`: the template's views by name, what render can insert. `print`: how printed values are
// written (the page marks them as page content).
export function createEngine(views: Record<string, string>, print: (value: unknown) => string = String): Liquid {
  const engine = new Liquid({ templates: views, extname: '', parseLimit: 100_000, renderLimit: 200, memoryLimit: 10_000_000, outputEscape: print });
  for (const name of ['include', 'layout']) engine.registerTag(name, unavailable(name));
  // Registered here too, so validation knows them; the page script gives them their behavior.
  for (const name of READ_FILTERS) engine.registerFilter(name, () => '');
  return engine;
}

const unavailable = (name: string) =>
  class extends Tag {
    constructor(token: TagToken, remain: TopLevelToken[], liquid: Liquid) {
      super(token, remain, liquid);
      throw new Error(`the ${name} tag is not available in page templates`);
    }
    *render() {}
  };

// A printed value as site template data (empty ones stay empty). Mark characters the page itself
// contains are dropped first, so a page cannot fake where its text comes from.
export const markAsTemplateData = (text: string) => {
  const clean = neutralizeTags(stripMarks(text));
  return clean ? MARKS.template[0] + clean + MARKS.template[1] : '';
};

// A view's problems as Liquid sees them: a syntax error, or a for loop over a filtered value
// (Liquid ignores filters there without saying so).
export function liquidProblems(body: string): string[] {
  const problems: string[] = [];
  try {
    createEngine({}).parse(body);
  } catch (e) {
    problems.push(`Template error: ${errorText(e)}`);
  }
  if (/\{%-?\s*for\s+\w+\s+in\s+[^%]*\|/.test(body)) {
    problems.push('Filters are ignored in a for tag: assign the list first ({% assign items = page | select: "…" %}{% for x in items %}).');
  }
  return problems;
}

// The views a view renders, by name.
const rendered = (body: string) => [...body.matchAll(/\{%-?\s*render\s+["']([^"']+)["']/g)].map((m) => m[1]!);

// What is wrong with the renders between views: unknown names, cycles, chains too long.
export function renderProblems(views: Record<string, string>): string[] {
  const problems = new Set<string>();
  const walk = (name: string, chain: string[]) => {
    for (const next of rendered(views[name] ?? '')) {
      if (!(next in views)) problems.add(`The view "${name}" renders "${next}", which does not exist.`);
      else if (chain.includes(next)) problems.add(`The views render each other in a loop: ${[...chain, next].join(' → ')}.`);
      else if (chain.length >= limit('renderDepth')) problems.add(`Too many nested renders: ${[...chain, next].join(' → ')} (at most ${limit('renderDepth')} views).`);
      else walk(next, [...chain, next]);
    }
  };
  for (const name of Object.keys(views)) walk(name, [name]);
  return [...problems];
}

// Whether the template reads the page at all.
export const readsPage = (body: string) => new RegExp(`\\|\\s*(${READ_FILTERS.filter((f) => f !== 'attr').join('|')})\\s*:`).test(body);
