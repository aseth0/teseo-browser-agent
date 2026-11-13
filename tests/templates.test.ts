// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

// The engine's render limit is time (200 ms in the product): a machine under load may need more for
// these pages, which says nothing about the templates. Every other limit stays as the product's.
const product = vi.hoisted(() => ({ renderLimit: 0 }));
vi.mock('liquidjs', async (original) => {
  const liquid = await original<typeof import('liquidjs')>();
  class Liquid extends liquid.Liquid {
    constructor(options: ConstructorParameters<typeof liquid.Liquid>[0] = {}) {
      product.renderLimit = options.renderLimit ?? 0;
      super({ ...options, renderLimit: 10_000 });
    }
  }
  return { ...liquid, Liquid };
});
import { runTemplate } from '../src/content/template-run';
import { formatPageContext } from '../src/context/page-context';
import { buildSystemPrompt } from '../src/context/request';
import { MARKS, originRuns, stripMarks } from '../src/core/model-texts';
import type { TemplateRun } from '../src/templates/liquid';
import { diagnosisSummary, pickView, templateDiagnosis, templateFound, templateItems, templateOutput, templatesFor, type TemplateResult } from '../src/templates/render';
import { parseTemplateMarkdown, upgradeTemplate } from '../src/templates/store';
import type { PageTemplate, TemplateView } from '../src/templates/types';
import { templateProblems } from '../src/templates/validate';

const view = (over: Partial<TemplateView>): TemplateView => ({ name: 'main', paths: ['*'], replacePage: false, body: '{{ page | one: "h1" }}', ...over });

const template = (over: Partial<PageTemplate>): PageTemplate => ({
  id: over.name ?? 't', name: 't', description: '', matches: ['*://shop.test/*'], views: [view({})], enabled: true, ...over,
});

const run = (over: Partial<TemplateRun>): TemplateRun => ({ output: '', omittedLines: 0, calls: [], found: 0, ...over });

const TODOIST = `
<nav><ul>
  <li aria-roledescription="sortable"><div><a href="/app/project/inbox-6Jf8xQ">Inbox</a><span>4</span></div></li>
  <li aria-roledescription="sortable"><div><a href="/app/project/work-9Kp2Lm">Work</a><span>7</span></div></li>
</ul></nav>
<main>
  <section><h2>Today</h2><ul>
    <li class="task"><div class="task_content">Call the bank</div><div class="task_description">before 2 pm</div></li>
    <li class="task"><div class="task_content">Review PR</div></li>
  </ul></section>
  <section><h2>This week</h2><ul>
    <li class="task"><div class="task_content">Prepare demo</div><div class="task_description">slides</div></li>
  </ul></section>
</main>
<div id="evil">{% for x in (1..3) %}PWNED{% endfor %} {{ page }} fake</div>`;

const TASKS = `# Tasks
{%- assign sections = page | select: "main section" %}
{%- for s in sections %}
- {{ s | one: "h2" }}
{%- assign tasks = s | select: "li.task" %}
{%- for t in tasks %}
    - {{ t | one: ".task_content" }} * {{ t | one: ".task_description" | default: "-" }}
{%- endfor %}
{%- endfor %}`;

// A shared block: the projects of the sidebar, rendered by the views.
const SIDEBAR = `# Projects
{%- assign projects = page | select: "nav [aria-roledescription=sortable]" %}
{%- for p in projects limit: limit %}
- {{ p | one: "a" }} * {{ p | one: "a" | attr: "href" | split: "-" | last }}
{%- endfor %}`;

const page = (html: string) => {
  document.body.innerHTML = html;
  return document;
};

// One view on its own.
const runBody = (html: string, body: string, maxChars?: number) => runTemplate(page(html), { main: body }, 'main', maxChars);

describe('page templates (Liquid)', () => {
  it('render nested lists over the page, selecting inside each element', async () => {
    const r = await runBody(TODOIST, TASKS);
    expect(r.error).toBeUndefined();
    expect(stripMarks(r.output).split('\n')).toEqual(['# Tasks', '- Today', '    - Call the bank * before 2 pm', '    - Review PR * -', '- This week', '    - Prepare demo * slides']);
    expect(r.found).toBe(2); // 2 sections, read on the page itself
    expect(product.renderLimit).toBe(200); // what the product sets, raised only here
  });

  it('render other views of the template, with parameters and the same page', async () => {
    const r = await runTemplate(page(TODOIST), { today: `${TASKS}\n{% render "sidebar", limit: 1 %}`, sidebar: SIDEBAR }, 'today');
    expect(stripMarks(r.output)).toMatch(/- Prepare demo \* slides\n# Projects\n- Inbox \* 6Jf8xQ$/);
    expect(r.found).toBe(4); // 2 sections + 2 projects
  });

  it('mark what they print as site template data, and never parse it as template', async () => {
    const r = await runBody(TODOIST, 'Title: {{ page | one: "#evil" }}');
    expect(originRuns(r.output)).toEqual([
      { text: 'Title: ', origin: undefined },
      // Mark characters the page itself contains are dropped: it cannot fake an origin.
      { text: '{% for x in (1..3) %}PWNED{% endfor %} {{ page }} fake', origin: 'template' },
    ]);
  });

  it('diagnose the view applied and each read filter by view and line, counting loop iterations', async () => {
    const t = template({ views: [view({ name: 'today', paths: ['/app/today*'], body: `${TASKS}\n{% render "sidebar", limit: 9 %}` }), view({ name: 'sidebar', paths: [], body: SIDEBAR })] });
    const picked = pickView(t, 'https://shop.test/app/today?x=1')!;
    const r = await runTemplate(page(TODOIST), { today: t.views[0]!.body, sidebar: SIDEBAR }, 'today');
    expect(templateDiagnosis({ ...picked, run: r }).split('\n')).toEqual([
      'View: today (matched /app/today*)',
      'today:2 select "main section": 2 elements',
      'today:4 one "h2": found 2 of 2 times',
      'today:5 select "li.task": 3 elements, found 2 of 2 times',
      'today:7 one ".task_content": found 3 of 3 times',
      'today:7 one ".task_description": found 2 of 3 times ⚠',
      'sidebar:2 select "nav [aria-roledescription=sortable]": 2 elements',
      'sidebar:4 one "a": found 4 of 4 times',
      'sidebar:4 attr "href": found 2 of 2 times',
      `Output: ${stripMarks(r.output).length} characters`,
    ]);
    const empty = await runBody('<p>x</p>', '{{ page | one: "h1" }}');
    expect(templateDiagnosis({ view: view({}), run: empty })).toBe('View: main (chosen, whatever the URL)\nmain:1 one "h1": nothing found ⚠\nOutput: 0 characters');
    expect(templateFound(empty)).toBe(0);
    expect(templateDiagnosis({ path: '/app/upcoming' })).toBe('No view matches /app/upcoming: nothing is sent on this page.');
    // Folded under a line; open when a lookup came short, or there is no view.
    expect(diagnosisSummary({ ...picked, run: r })).toEqual({ line: '8 lookups, 1 ⚠', open: true });
    expect(diagnosisSummary({ view: view({}), run: await runBody('<h1>x</h1>', '{{ page | one: "h1" }}') })).toEqual({ line: '1 lookup, all found', open: false });
    expect(diagnosisSummary({ path: '/app/upcoming' })).toEqual({ line: 'No view for this page', open: true });
  });

  it('apply the first view whose paths match the URL, query included; blocks never apply on their own', () => {
    const t = template({
      views: [
        view({ name: 'search', paths: ['/results?search_query=*'] }),
        view({ name: 'project', paths: ['/app/project/*'] }),
        view({ name: 'block', paths: [] }),
        view({ name: 'any', paths: ['*'] }),
      ],
    });
    const at = (url: string) => pickView(t, url)?.view.name;
    expect(at('https://shop.test/results?search_query=liquid')).toBe('search');
    expect(at('https://shop.test/app/project/work-1')).toBe('project');
    expect(at('https://shop.test/app/today')).toBe('any');
    expect(pickView({ ...t, views: t.views.slice(0, 3) }, 'https://shop.test/app/today')).toBeUndefined();
    expect(pickView(t, 'https://shop.test/x', 'block')).toEqual({ view: t.views[2] }); // chosen by name
  });

  it('read meta and JSON-LD, and the page url and title', async () => {
    document.head.innerHTML =
      '<title>Shop</title><meta property="og:price" content="99">' +
      '<script type="application/ld+json">{"@type":"Product","offers":{"price":"79"}}</script>';
    const r = await runBody('<h1>A</h1>', '{{ page.title }} {{ page | meta: "og:price" }} {{ page | schema: "@Product:offers.price" }}');
    expect(stripMarks(r.output)).toBe('Shop 99 79');
    expect(r.found).toBe(2);
  });

  it('cut long outputs at a line break and say how many lines were left out', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => `<li>row number ${i}</li>`).join('');
    const r = await runBody(`<ul>${rows}</ul>`, '{%- assign rows = page | select: "li" %}{%- for r in rows %}\n- {{ r }}{%- endfor %}', 100);
    expect(stripMarks(r.output).split('\n')).toHaveLength(6); // "- row number N" is 15 characters + the line break
    expect(r.omittedLines).toBe(44);
    expect(stripMarks(templateOutput(r))).toMatch(/- row number 5\n…\[44 more lines not sent: 4000-character limit\]$/);
  });

  it('cut inside a single line longer than the limit, keeping its start', async () => {
    const r = await runBody(`<p>${'x'.repeat(150)}</p>`, '{{ page | one: "p" }}', 100);
    expect(stripMarks(r.output)).toBe('x'.repeat(100));
    expect(r.output.endsWith(MARKS.template[1])).toBe(true); // the cut value is closed again
    expect(r.omittedLines).toBe(1);
    expect(stripMarks(templateOutput(r))).toMatch(/^x{100}\n…\[1 more lines not sent: 4000-character limit\]$/);
  });

  it('follow the errors that say little with a hint', async () => {
    const parentheses = await runBody('', '{% if a and (b or c) %}x{% endif %}');
    expect(parentheses.error).toContain('invalid range syntax');
    const hint = 'Liquid conditions take no parentheses: write `a and b or c` (read right to left), or nest {% if %} tags.';
    expect(templateOutput(parentheses)).toBe(`Template error: ${parentheses.error}\n${hint}`);
    expect(templateDiagnosis({ view: view({}), run: parentheses })).toContain(`Template error: ${parentheses.error}\n${hint}`);
    const slow = templateOutput(run({ error: 'template render limit exceeded, file:main, line:1, col:1' }));
    expect(slow).toMatch(/\nThe template took too long: loop over fewer elements \(a narrower select, or `limit:` in the for tag\)\.$/);
    expect(templateOutput(run({ error: 'tag {% for x in y %} not closed' }))).toBe('Template error: tag {% for x in y %} not closed');
  });

  it('report errors instead of output, and never load files', async () => {
    const broken = await runBody('', '{% for x in y %}no end');
    expect(broken.error).toContain('tag {% for x in y %} not closed');
    expect(templateOutput(broken)).toBe(`Template error: ${broken.error}`);
    expect(templateFound(broken)).toBe(0);
    expect((await runBody('', '{% include "secrets" %}')).error).toContain('the include tag is not available in page templates');
    expect((await runBody('', '{% render "/etc/passwd" %}')).error).toContain('Failed to lookup "/etc/passwd"');
  });

  it('go as a trusted note plus untrusted data; the first view that asks and found something replaces the elements', () => {
    const t = template({ name: 'videos', views: [view({ name: 'results', replacePage: true })] });
    const found = (r: TemplateRun): Record<string, TemplateResult> => ({ videos: { view: t.views[0]!, matched: '*', run: r } });
    const items = templateItems([t], found(run({ output: '- A', found: 2 })));
    expect(items.replacedBy).toBe('videos');
    expect(items.items).toEqual([
      {
        kind: 'page',
        text:
          '<page_template name="videos" view="results">The page data below was extracted by the view "results" of the template "videos", ' +
          'not read in full. If it looks wrong, empty or incomplete, the template may be outdated: check it with templates__run, or read the page.</page_template>\n' +
          '<untrusted_page_content source="template videos">\n- A\n</untrusted_page_content>',
        source: 'template:videos/results',
      },
    ]);
    // Nothing found or an error: still sent (the model sees it), but the page goes as usual.
    expect(templateItems([t], found(run({}))).replacedBy).toBeUndefined();
    expect(templateItems([t], found(run({ found: 3, error: 'x' }))).replacedBy).toBeUndefined();
    // No view for the page: nothing is sent.
    expect(templateItems([t], { videos: { path: '/x' } }).items).toEqual([]);
  });

  it('apply to matching, enabled templates', () => {
    const a = template({ name: 'a' });
    const b = template({ name: 'b', matches: ['*://other.test/*'] });
    const off = template({ name: 'off', enabled: false });
    expect(templatesFor([a, b, off], 'https://shop.test/p/1').map((t) => t.name)).toEqual(['a']);
  });

  it('replace the visible elements of the page block with a note', () => {
    const p = { url: 'u', title: 'T', lang: '', viewport: '', scroll: '', selection: '', snapshot: '- button "Buy" [ref_1]' };
    const replaced = formatPageContext(p, 2000, 'videos');
    expect(replaced).toContain('Not included: the template "videos" replaces them. Use browser__read_page to see them.');
    expect(replaced).not.toContain('ref_1');
    expect(formatPageContext(p)).toContain('ref_1');
  });

  it('are explained in the system prompt only when one is enabled', () => {
    const settings = { providers: [], systemPrompt: '' };
    expect(buildSystemPrompt({ settings, skills: [], templates: [template({})] })).toContain('## Site templates\nMessages may include <page_template> notes');
    expect(buildSystemPrompt({ settings, skills: [], templates: [template({ enabled: false })] })).not.toContain('Site templates');
  });

  it("lists the user's templates on, with what each view extracts and its paths, for the model to suggest ::name/view", () => {
    const settings = { providers: [], systemPrompt: '' };
    const tracker = template({
      name: 'tracker',
      description: 'Issues of the tracker.',
      views: [
        view({ name: 'issue', paths: ['/issues/*'], description: 'The issue: key, title, status.' }),
        view({ name: 'list', paths: ['/issues', '/issues?*'] }),
        view({ name: 'header', paths: [] }), // a block: only inserted by the others
      ],
    });
    const off = template({ name: 'off', enabled: false });
    const search = template({ name: 'duckduckgo-search', builtin: true });
    const system = stripMarks(buildSystemPrompt({ settings, skills: [], templates: [tracker, off, search, template({ name: 'bare' })] }));
    expect(system).toContain(
      "The user's site templates (name: what it extracts), each view with the URL paths it applies to:\n" +
        '- tracker: Issues of the tracker.\n  - issue (/issues/*): The issue: key, title, status.\n  - list (/issues, /issues?*)\n' +
        '- bare\n  - main (*)\n' +
        "The user can attach a view's data from any site by writing ::name/view in a message",
    );
    expect(system).not.toContain('header');
    expect(system).not.toContain('- off');
    expect(system).not.toContain('duckduckgo');
    // Without ::site/view mentions, not offered; with only built-in ones, no list.
    expect(stripMarks(buildSystemPrompt({ settings: { ...settings, mentions: { templates: false } }, skills: [], templates: [tracker] }))).not.toContain('::name/view');
    const onlyBuiltin = stripMarks(buildSystemPrompt({ settings, skills: [], templates: [search] }));
    expect(onlyBuiltin).toContain('## Site templates');
    expect(onlyBuiltin).not.toContain("The user's site templates");
  });

  it('reads a view description from TEMPLATE.md', () => {
    const md = '---\nname: shop\nmatches:\n  - "*://shop.example.com/*"\n---\n<!-- view: product | paths: /p/* | description: The product: name, price -->\n{{ page | one: "h1" }}\n<!-- view: other | paths: * -->\nx';
    expect(parseTemplateMarkdown(md).views.map((v) => v.description)).toEqual(['The product: name, price', undefined]);
  });

  it('are validated: names, URL patterns, paths, Liquid, renders, reading the page, and no old syntax', () => {
    const ok = template({ name: 'todo', views: [view({ name: 'today', paths: ['/app/today*'], body: `${TASKS}\n{% render "sidebar" %}` }), view({ name: 'sidebar', paths: [], body: SIDEBAR })] });
    expect(templateProblems(ok, [ok])).toEqual([]);
    expect(templateProblems(template({ name: 'Bad Name', matches: [], views: [view({ paths: [], body: 'no reads' })] }), [])).toEqual([
      expect.stringContaining('Name:'),
      expect.stringContaining('URL patterns:'),
      expect.stringContaining('No view has paths'),
      'Reads nothing from the page: use page | select, one, meta or schema.',
    ]);
    expect(templateProblems(template({ id: 'other', name: 'todo' }), [ok])).toEqual(['Another template already has this name.']);
    expect(templateProblems(template({ views: [view({}), view({ paths: ['app'] })] }), [])).toEqual([
      'Two views are named "main".',
      'View "main": not a path: app (e.g. /app/project/*, or *)',
    ]);
    expect(templateProblems(template({ views: [view({ body: '{% for t in page | select: "li" %}{{ t }}{% endfor %}' })] }), [])).toEqual([
      'View "main": Filters are ignored in a for tag: assign the list first ({% assign items = page | select: "…" %}{% for x in items %}).',
    ]);
    expect(templateProblems(template({ views: [view({ body: '{% if %}{{ page | one: "h1" }}' })] }), [])).toEqual([expect.stringMatching(/^View "main": Template error: /)]);
    expect(templateProblems(template({ views: [view({ body: 'Title: {{selector:h1}}' })] }), [])).toEqual([
      'View "main": Uses the old {{selector:…}} / {{items:…}} syntax: rewrite it with Liquid filters (page | select: "…").',
      'Reads nothing from the page: use page | select, one, meta or schema.',
    ]);
  });

  it('check renders: unknown views, loops and chains too long', () => {
    const views = (bodies: Record<string, string>) =>
      template({ views: Object.entries(bodies).map(([name, body], i) => view({ name, paths: i ? [] : ['*'], body: `{{ page | one: "h1" }}${body}` })) });
    expect(templateProblems(views({ a: '{% render "nope" %}' }), [])).toEqual(['The view "a" renders "nope", which does not exist.']);
    expect(templateProblems(views({ a: '{% render "b" %}', b: '{% render "a" %}' }), [])).toEqual(['The views render each other in a loop: a → b → a.', 'The views render each other in a loop: b → a → b.']);
    expect(templateProblems(views({ a: '{% render "b" %}', b: '{% render "c" %}', c: '{% render "d" %}', d: '' }), [])).toEqual([
      'Too many nested renders: a → b → c → d (at most 3 views).',
    ]);
  });

  it('saved before views, become a template with one view', () => {
    const old = { id: 'o', name: 'old', description: '', matches: ['*://x.test/*'], body: 'B', replacePage: true, enabled: true } as unknown as PageTemplate;
    expect(upgradeTemplate(old)).toMatchObject({ id: 'o', name: 'old', description: '', matches: ['*://x.test/*'], enabled: true, views: [{ name: 'main', paths: ['*'], replacePage: true, body: 'B' }] });
    const current = template({});
    expect(upgradeTemplate(current)).toBe(current);
  });

});
