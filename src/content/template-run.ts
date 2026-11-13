// Runs a view of a page template (templates/liquid) over this page, with the other views of its
// template available to render: the read filters query the DOM, and each call is counted for the
// diagnosis.
import { Drop } from 'liquidjs';
import { LIMIT_DEFS } from '../core/limits';
import { MARKS, stripMarks } from '../core/origin-marks';
import { parseVariable } from '../skills/variables';
import { errorText } from '../core/errors';
import { createEngine, markAsTemplateData, type FilterCall, type ReadFilter, type TemplateRun } from '../templates/liquid';
import { all, attribute, elementText, metaContent, schemaValue, structuredData } from './page-values';

// An element of the page as a template value: prints as its text.
class ElementDrop extends Drop {
  readonly #el: Element;
  constructor(el: Element) {
    super();
    this.#el = el;
  }
  get element() {
    return this.#el;
  }
  override valueOf(): string {
    return elementText(this.#el);
  }
}

// The page itself: its body, plus page.url and page.title.
class PageDrop extends ElementDrop {
  readonly url: string;
  readonly title: string;
  constructor(doc: Document) {
    super(doc.body ?? doc.documentElement);
    this.url = doc.location.href;
    this.title = doc.title;
  }
}

export async function runTemplate(doc: Document, views: Record<string, string>, view: string, maxChars = LIMIT_DEFS.templateOutput.value): Promise<TemplateRun> {
  const engine = createEngine(views, (value) => markAsTemplateData(textOf(value)));
  const page = new PageDrop(doc);
  const calls = new Map<string, FilterCall>();
  let found = 0;

  // Each call of a read filter, keyed by where it is written (view and line); `hits`: what it found
  // (elements for select).
  function track(filter: ReadFilter, self: unknown, argument: string, input: unknown, hits: number) {
    const token = (self as { token?: { begin: number; input: string; file?: string } }).token;
    const line = token ? token.input.slice(0, token.begin).split('\n').length : 0;
    const at = token?.file ?? view;
    const key = `${at} ${line} ${filter} ${argument}`;
    const call = calls.get(key) ?? { view: at, line, filter, argument, calls: 0, hits: 0, elements: 0 };
    call.calls++;
    if (hits) call.hits++;
    call.elements += hits;
    calls.set(key, call);
    if (input === page && filter !== 'attr') found += filter === 'select' ? hits : Math.min(hits, 1);
  }
  let ld: unknown[] | undefined; // the page's JSON-LD, parsed once per run (schema may be called in a loop)
  const jsonLd = () => (ld ??= structuredData(doc).jsonLd);
  const within = (input: unknown, css: string) => (input instanceof ElementDrop ? all(input.element, css) : []);

  engine.registerFilter('select', function (this: unknown, input: unknown, css: unknown) {
    const els = within(input, String(css));
    track('select', this, String(css), input, els.length);
    return els.map((el) => new ElementDrop(el));
  });
  // The filters that read one value: it counts as found when not empty.
  const reader = (filter: ReadFilter, read: (input: unknown, arg: string) => ElementDrop | string) =>
    function (this: unknown, input: unknown, arg: unknown) {
      const value = read(input, String(arg));
      track(filter, this, String(arg), input, value ? 1 : 0);
      return value;
    };
  engine.registerFilter('one', reader('one', (input, css) => {
    const el = within(input, css)[0];
    return el ? new ElementDrop(el) : '';
  }));
  engine.registerFilter('attr', reader('attr', (input, name) => (input instanceof ElementDrop ? attribute(input.element, name) : '')));
  engine.registerFilter('meta', reader('meta', (_, name) => metaContent(doc, name)));
  engine.registerFilter('schema', reader('schema', (_, spec) => {
    const v = parseVariable(`{{schema:${spec}}}`);
    return v?.kind === 'schema' ? schemaValue(jsonLd(), v.type, v.path) : '';
  }));

  // The applied view first, then the views it renders, each by line.
  const order = (c: FilterCall) => (c.view === view ? '' : c.view);
  const tracked = () => [...calls.values()].sort((a, b) => order(a).localeCompare(order(b)) || a.line - b.line);
  const hidden = doc.visibilityState === 'hidden';
  try {
    const output = await engine.renderFile(view, {}, { globals: { page } });
    return { ...fitLines(output.trim(), maxChars), calls: tracked(), found, hidden };
  } catch (e) {
    return { output: '', omittedLines: 0, calls: tracked(), found, hidden, error: errorText(e) };
  }
}

const textOf = (value: unknown): string =>
  value === null || value === undefined
    ? ''
    : Array.isArray(value)
      ? value.map(textOf).join('')
      : value instanceof Drop
        ? String(value.valueOf())
        : String(value);

// The whole lines that fit in maxChars (counted without the marks), and how many were left out.
// When not even the first line fits, its first maxChars characters, and it counts as left out.
function fitLines(output: string, maxChars: number): { output: string; omittedLines: number } {
  const length = (line: string) => stripMarks(line).length + 1;
  const lines = output.split('\n');
  let used = 0;
  let kept = 0;
  while (kept < lines.length && used + length(lines[kept]!) <= maxChars + 1) used += length(lines[kept++]!);
  const omittedLines = lines.slice(kept).filter((l) => l.trim()).length;
  if (!kept && omittedLines) return { output: cutLine(lines[0]!, maxChars), omittedLines };
  return { output: lines.slice(0, kept).join('\n'), omittedLines };
}

// The first maxChars characters of a line (counted without the marks), with a value cut in the
// middle closed again.
function cutLine(line: string, maxChars: number): string {
  const [open, close] = MARKS.template;
  let out = '';
  let count = 0;
  let inside = false;
  for (const c of line) {
    if (c === open || c === close) inside = c === open;
    else if (count++ === maxChars) break;
    out += c;
  }
  return inside ? out + close : out;
}
