import { describe, expect, it } from 'vitest';
import { setLimitOverrides } from '../src/core/limits';
import { stripMarks } from '../src/core/model-texts';
import type { TemplateRun } from '../src/templates/liquid';
import { fixedUrl, mentionFailed, mentionMessage, parseMentions, pickTab, sentMentions } from '../src/templates/mentions';
import type { PageTemplate, TemplateView } from '../src/templates/types';

const view = (name: string, paths: string[]): TemplateView => ({ name, paths, replacePage: false, body: '{{ page | one: "h1" }}' });
const TODOIST: PageTemplate = {
  id: 'td', name: 'todoist', description: '', matches: ['*://app.todoist.com/*'], enabled: true,
  views: [view('project', ['/app/project/*']), view('today', ['/app/today*']), view('sidebar', [])],
};
const OFF: PageTemplate = { ...TODOIST, id: 'off', name: 'old-site', enabled: false };
const run = (over: Partial<TemplateRun>): TemplateRun => ({ output: '- A', omittedLines: 0, calls: [], found: 1, ...over });

describe('site mentions', () => {
  it('are ::site or ::site/view at the start of a word, each once, with what is wrong with them', () => {
    const text = '::todoist/today what about std::vector and ::todoist/today, ::todoist ::nope ::old-site ::todoist/none';
    expect(parseMentions(text, [TODOIST, OFF]).map((m) => [m.name, m.problem, text.slice(m.start, m.end)])).toEqual([
      ['todoist/today', undefined, '::todoist/today'],
      ['todoist', undefined, '::todoist'],
      ['nope', 'unknown', '::nope'],
      ['old-site', 'off', '::old-site'],
      ['todoist/none', 'no-view', '::todoist/none'],
    ]);
    // Unknown and switched-off sites are plain text: the model is not told about them.
    expect(sentMentions(parseMentions(text, [TODOIST, OFF])).map((m) => m.name)).toEqual(['todoist/today', 'todoist', 'todoist/none']);
  });

  it('read at most 3 per message', () => {
    const mentions = parseMentions('::todoist/project ::todoist/today ::todoist/sidebar ::todoist', [TODOIST]);
    expect(mentions.map((m) => m.problem)).toEqual([undefined, undefined, undefined, 'too-many']);
  });

  it('read as many as Settings → Limits says', () => {
    setLimitOverrides({ mentions: 1 });
    try {
      expect(parseMentions('::todoist/project ::todoist/today', [TODOIST]).map((m) => m.problem)).toEqual([undefined, 'too-many']);
    } finally {
      setLimitOverrides(undefined);
    }
  });

  it('open a view at its fixed URL: a concrete host and a path without wildcards, or with a trailing one', () => {
    expect(fixedUrl(TODOIST, view('today', ['/app/today*']))).toBe('https://app.todoist.com/app/today');
    expect(fixedUrl(TODOIST, view('home', ['*']))).toBe('https://app.todoist.com/');
    expect(fixedUrl(TODOIST, view('project', ['/app/project/*/tasks', '/app/upcoming']))).toBe('https://app.todoist.com/app/upcoming');
    expect(fixedUrl(TODOIST, view('project', ['/app/project/*/tasks']))).toBeUndefined();
    expect(fixedUrl(TODOIST, view('block', []))).toBeUndefined();
    expect(fixedUrl({ ...TODOIST, matches: ['*://*.todoist.com/*', 'http://todoist.test/*'] }, view('today', ['/today']))).toBe('http://todoist.test/today');
  });

  it('are read from the active tab when it fits, else from the most recent open tab that fits the view', () => {
    const tabs = [
      { id: 1, url: 'https://app.todoist.com/app/project/work-1', lastAccessed: 5 },
      { id: 2, url: 'https://app.todoist.com/app/today', lastAccessed: 3 },
      { id: 3, url: 'https://app.todoist.com/app/today?x', lastAccessed: 9 },
      { id: 4, url: 'https://example.com/', lastAccessed: 10 },
    ];
    const today = TODOIST.views[1]!;
    expect(pickTab(TODOIST, tabs, 2, today)?.id).toBe(2); // active
    expect(pickTab(TODOIST, tabs, 4, today)?.id).toBe(3); // most recent of the view's pages
    expect(pickTab(TODOIST, tabs, 1, today)?.id).toBe(3); // the active tab is of the site, not of the view
    expect(pickTab(TODOIST, tabs, 1)?.id).toBe(1); // no view named: any page of the site
    expect(pickTab(TODOIST, tabs, 4, TODOIST.views[2])?.id).toBe(3); // a block: any page of the site
    expect(pickTab(TODOIST, [tabs[3]!], 4, today)).toBeUndefined();
  });

  it('go to the model as a note saying where they were read, plus the data as page content', () => {
    expect(mentionMessage('todoist', 'today', run({}), { kind: 'active', tabId: 7 })).toBe(
      '<page_template name="todoist" view="today">The user mentioned ::todoist/today: the page data below was extracted by that view from the active tab, ' +
        'not read in full. If it looks wrong, empty or incomplete, the template may be outdated: check it with templates__run (tabId 7), or read the page.</page_template>\n' +
        '<untrusted_page_content source="template todoist">\n- A\n</untrusted_page_content>',
    );
    expect(mentionMessage('todoist', 'today', run({}), { kind: 'open', tabId: 8 })).toContain('from the open tab 8, not read in full');
    const closed = mentionMessage('todoist', 'today', run({ found: 0, output: '', hidden: true }), { kind: 'background', url: 'https://app.todoist.com/app/today' });
    expect(stripMarks(closed).split('\n').slice(0, 2)).toEqual([
      '<page_template name="todoist" view="today">The user mentioned ::todoist/today: the page data below was extracted by that view from ' +
        'https://app.todoist.com/app/today, opened in a background tab and closed, not read in full. If it looks wrong, empty or incomplete, ' +
        'the template may be outdated: open https://app.todoist.com/app/today to check it.</page_template>',
      'It was read in a hidden tab: some websites only show their content in a visible tab.',
    ]);
    expect(mentionFailed('todoist/x', 'the template "todoist" has no view "x"')).toBe(
      '<page_template mention="::todoist/x">The user mentioned ::todoist/x, but it could not be read: the template "todoist" has no view "x".</page_template>',
    );
  });
});
