// When the site templates of the page go with a message on their own (context/turn): the panel's tab,
// "Page" on, a view for its URL; and what goes when the view finds nothing.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../src/core/types';
import type { PageRequest } from '../src/page/protocol';
import type { Settings } from '../src/storage/settings';
import type { TemplateRun } from '../src/templates/liquid';
import type { PageTemplate } from '../src/templates/types';

vi.mock('wxt/browser', async () => (await import('./fakes/browser')).inertBrowser());
const runs = new Map<string, TemplateRun>(); // by view
const calls: PageRequest[] = [];
vi.mock('../src/page/bridge', async (original) => ({
  ...(await original<object>()),
  callPage: vi.fn(async (_tabId: number, req: PageRequest) => {
    calls.push(req);
    if (req.op === 'template') return runs.get(req.view) ?? { output: '', omittedLines: 0, calls: [], found: 0 };
    if (req.op === 'context') return { meta: { url: 'https://app.example.test/', title: 'App' }, selection: '', snapshot: { text: '', count: 0 } };
    throw new Error(`unexpected ${req.op}`);
  }),
}));

const { turnContext } = await import('../src/context/turn');
const { newAgentProfile, seenBy, templatesSeenBy } = await import('../src/agents/profiles');
const { templatesFor } = await import('../src/templates/render');
const { TEMPLATE_SOURCE, PAGE_SOURCE } = await import('../src/context/sources');

const TASKS: PageTemplate = {
  id: 'tasks', name: 'tasks', description: '', matches: ['*://app.example.test/*'], enabled: true,
  views: [
    { name: 'today', paths: ['/today*'], replacePage: false, body: '{{ page | one: "h1" }}' },
    { name: 'project', paths: ['/project/*'], replacePage: false, body: '{{ page | one: "h1" }}' },
  ],
};
const settings = { providers: [], systemPrompt: '' } as unknown as Settings;
const history: Message[] = [{ role: 'user', parts: [{ type: 'text', text: 'what is due today?' }] }];

const context = (over: { url?: string; tabId?: number; includePage?: boolean; templates?: PageTemplate[]; settings?: Settings; skip?: never[] } = {}) =>
  turnContext(
    { history, tabId: 'tabId' in over ? over.tabId : 7, url: 'url' in over ? over.url : 'https://app.example.test/today', includePage: over.includePage ?? true },
    { settings: over.settings ?? settings, skills: [], templates: over.templates ?? [TASKS], toolNames: [], requestAccess: async () => false, send: () => {} },
  );
const sources = async (over: Parameters<typeof context>[0] = {}) => (await context(over)).items.map((i) => i.source);

beforeEach(() => {
  runs.clear();
  calls.length = 0;
  runs.set('today', { output: '- Pay rent', omittedLines: 0, calls: [], found: 1 });
});

describe('the site templates of the page', () => {
  it('go with the message, before the page block, when its view matches the tab and "Page" is on', async () => {
    const { items } = await context();
    expect(items.map((i) => i.source)).toEqual([`${TEMPLATE_SOURCE}tasks/today`, PAGE_SOURCE]);
    expect(items[0]!.text).toContain('- Pay rent');
  });

  it('match the path with its query, and not a path the view does not list', async () => {
    expect(await sources({ url: 'https://app.example.test/today?filter=work' })).toContain(`${TEMPLATE_SOURCE}tasks/today`);
    expect(await sources({ url: 'https://app.example.test/project/42' })).toContain(`${TEMPLATE_SOURCE}tasks/project`);
    // A page of the site with no view for it: nothing, not even a note.
    expect(await sources({ url: 'https://app.example.test/settings' })).toEqual([PAGE_SOURCE]);
    expect(await sources({ url: 'https://other.example.test/today' })).toEqual([PAGE_SOURCE]);
  });

  it('do not go without "Page", without the tab, or when off', async () => {
    expect(await sources({ includePage: false })).toEqual([]);
    expect(await sources({ tabId: undefined })).toEqual([]);
    expect(await sources({ templates: [{ ...TASKS, enabled: false }] })).toEqual([PAGE_SOURCE]);
    expect(await sources({ settings: { ...settings, autoInject: { templates: false } } as Settings })).toEqual([PAGE_SOURCE]);
    expect(calls.filter((c) => c.op === 'template')).toHaveLength(0);
  });

  it('go even when the view finds nothing: an empty block with its note', async () => {
    runs.set('today', { output: '', omittedLines: 0, calls: [], found: 0 });
    const { items } = await context();
    expect(items.map((i) => i.source)).toEqual([`${TEMPLATE_SOURCE}tasks/today`, PAGE_SOURCE]);
    expect(items[0]!.text).toContain('<untrusted_page_content source="template tasks">\n\n</untrusted_page_content>');
  });
});

describe('the site templates of an agent', () => {
  // The page bar's chips showed every template of the page, while an agent gets only those it was
  // given: a chip said it went, and the model never got it.
  it('are the same for the run and for the page bar: only those it was given', async () => {
    const url = 'https://app.example.test/today';
    const without = { ...newAgentProfile(), name: 'mail' };
    const given = { ...without, templates: ['tasks'] };
    for (const [agent, names] of [[undefined, ['tasks']], [without, []], [given, ['tasks']]] as const) {
      const run = seenBy(agent, settings, [], [TASKS]).templates;
      expect(templatesFor(templatesSeenBy(agent, [TASKS]), url).map((t) => t.name)).toEqual(names);
      expect(templatesFor(run, url).map((t) => t.name)).toEqual(names);
      expect((await sources({ templates: run })).includes(`${TEMPLATE_SOURCE}tasks/today`)).toBe(names.length > 0);
    }
  });
});

describe('the tab the user is on', () => {
  it('is told when it is not the chat\'s, after the page', async () => {
    const { USER_ELSEWHERE_SOURCE } = await import('../src/context/sources');
    const { stripMarks } = await import('../src/core/model-texts');
    const { items } = await turnContext(
      { history, tabId: 7, url: 'https://app.example.test/today', includePage: true, userTab: { tabId: 9, title: 'Other', url: 'https://other.example.test/' } },
      { settings, skills: [], templates: [], toolNames: [], requestAccess: async () => false, send: () => {} },
    );
    expect(items.map((i) => i.source)).toEqual([PAGE_SOURCE, USER_ELSEWHERE_SOURCE]);
    expect(stripMarks(items[1]!.text)).toBe('The user is looking at another tab, not the one you work on: tab 9, "Other" (https://other.example.test/). Your tools still act on your tab unless you pass another tabId.');
  });

  it('is not told without one', async () => {
    const { USER_ELSEWHERE_SOURCE } = await import('../src/context/sources');
    expect(await sources({ templates: [] })).not.toContain(USER_ELSEWHERE_SOURCE);
  });
});
