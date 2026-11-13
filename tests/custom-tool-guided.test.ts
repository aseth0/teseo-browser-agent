// @vitest-environment jsdom
// The custom tool editor as a guide: a new tool starts at its first step, a pasted request fills the
// next ones (its keys kept out of the URL), values become inputs or saved values, problems show
// beside their fields only once the step was gone through, what a folded step holds stays, a tool
// that exists opens folded and saves as it was, and the keys of a tried answer cut it.
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeStorage } from './fakes/browser';
import type { CustomTool } from '../src/tools/custom/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const storage = fakeStorage();
vi.mock('../src/storage/secret-db', async () => (await import('./fakes/browser')).fakeSecretDb());
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));
vi.mock('../src/ui/ask-permission', () => ({ askOrigins: async () => true, askSite: async () => true }));

const { CustomToolEditor } = await import('../src/ui/custom-tools/Editor');
const { AnswerPicker, cutAnswer } = await import('../src/ui/custom-tools/AnswerPicker');
const { customToolStore } = await import('../src/tools/custom/store');
const { newCustomTool } = await import('../src/tools/custom/types');

let root: Root | undefined;
let host: HTMLElement | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  host?.remove();
  storage.reset();
});

function render(element: React.ReactElement) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(element));
}
const page = () => host!;
const editor = (custom: CustomTool, customs: CustomTool[] = [], onClose = () => undefined, catalog: never[] = []) =>
  render(createElement(CustomToolEditor, { custom, customs, catalog, onClose }));
// What shows: not inside a folded step's fields.
const shown = (el: Element) => !el.closest('[hidden]');
const buttons = () => [...page().querySelectorAll('button')].filter(shown);
const button = (text: string | RegExp) => {
  const found = buttons().find((b) => (typeof text === 'string' ? b.textContent?.trim() === text : text.test(b.textContent ?? '')));
  if (!found) throw new Error(`No button ${text}: ${buttons().map((b) => b.textContent).join(' | ')}`);
  return found;
};
const click = (el: HTMLElement) => act(() => el.click());
// Typing into a React-controlled box.
function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const byLabel = <T extends HTMLElement>(label: string) => [...page().querySelectorAll<T>(`[aria-label="${label}"]`)].find(shown);
const current = () => page().querySelector('.numbered-step.current h4')?.textContent;
const stepNamed = (title: string) => [...page().querySelectorAll('.numbered-step')].find((s) => s.querySelector('h4')?.textContent?.startsWith(title));
const summary = (title: string) => stepNamed(title)?.querySelector('.guide-summary')?.textContent ?? '';
const openStep = (title: string) => click(stepNamed(title)!.querySelector<HTMLButtonElement>('.guide-change')!);
const next = () => click(button(/^(Next|Done)/));
const fieldProblems = () => [...page().querySelectorAll('.field-problems')].filter(shown).map((p) => p.textContent).join(' ');

describe('a new custom tool', () => {
  it('shows no Next before a kind is chosen', () => {
    editor(newCustomTool());
    expect(current()).toBe('What it is');
    expect(page().querySelectorAll('.numbered-step').length).toBe(1);
    expect(buttons().some((b) => /^(Next|Done)/.test(b.textContent ?? ''))).toBe(false);
    expect(page().textContent).toContain('Choose what it is to start.');
    expect(page().querySelector('.problems')).toBeNull();
  });

  it('is filled from a pasted curl, its keys kept out of the URL, and guided step by step', () => {
    editor(newCustomTool());
    type(byLabel('Paste a URL or a curl command')!, `curl 'https://api.example.com/search?q=cats&api_key=K123' -H 'Authorization: Bearer T456'`);
    click(button('Fill from it'));
    expect(current()).toBe('The request');
    expect(byLabel<HTMLInputElement>('URL')!.value).toBe('https://api.example.com/search?q=cats&api_key={{secret:api_key}}');
    expect(page().textContent).toContain('Kept 1 header');
    expect(summary('What it is')).toContain('An HTTP request');

    next();
    expect(current()).toBe('What the model fills');
    click(page().querySelector<HTMLButtonElement>('[aria-label="Who sets q"] button:nth-child(2)')!);
    expect(byLabel<HTMLInputElement>('Parameter name')!.value).toBe('q');
    expect(page().textContent).toContain('Fixed: cats');
    // Its problem shows only once Next is clicked, beside it; then Next goes on.
    expect(fieldProblems()).toBe('');
    next();
    expect(fieldProblems()).toContain('"q" needs a description');
    expect(current()).toBe('What the model fills');
    type(byLabel('Description of q for the model')!, 'The words to search for');
    expect(fieldProblems()).toBe('');
    next();
    expect(current()).toBe('Try it');
    // Folded and opened again, the step still knows the value it replaced.
    openStep('What the model fills');
    click(button('Fixed: cats'));
    expect(summary('The request')).toContain('q=cats');
  });

  it('makes a value a saved value, and back', () => {
    editor(newCustomTool());
    click(button('Search an API'));
    next();
    click(page().querySelector<HTMLButtonElement>('[aria-label="Who sets limit"] button:nth-child(3)')!);
    expect(summary('The request')).toContain('limit={{secret:limit}}');
    click(page().querySelector<HTMLButtonElement>('[aria-label="Who sets limit"] button:nth-child(1)')!);
    expect(summary('The request')).toContain('limit=10');
  });

  it('forgets the values a replaced request had', () => {
    editor(newCustomTool());
    type(byLabel('Paste a URL or a curl command')!, 'https://api.example.com/search?q=cats');
    click(button('Fill from it'));
    next();
    click(page().querySelector<HTMLButtonElement>('[aria-label="Who sets q"] button:nth-child(2)')!);
    expect(page().textContent).toContain('Fixed: cats');
    openStep('What it is');
    type(byLabel('Paste a URL or a curl command')!, 'https://api.example.com/items?q=dogs');
    click(button('Fill from it'));
    click(button('Replace'));
    openStep('What the model fills');
    // An input of the old name, added by hand, is no value of the new request's.
    click(button('＋ Add a parameter'));
    type(byLabel<HTMLInputElement>('Parameter name')!, 'q');
    expect(page().textContent).not.toContain('Fixed: cats');
  });

  it('suggests a name, last', () => {
    editor(newCustomTool());
    click(button('Search an API'));
    openStep('Its name');
    click(button('example.search'));
    expect(page().querySelector<HTMLInputElement>('input.mono[placeholder^="e.g."]')!.value).toBe('example.search');
  });

  it('starts from an example, its inputs to insert by a click', () => {
    editor(newCustomTool());
    click(button('Read one item by id'));
    expect(byLabel<HTMLInputElement>('URL')!.value).toBe('https://api.example.com/items/{id}');
    expect(button('{id}')).toBeTruthy();
  });

  it('a first Next with problems stays and shows them; the next one goes on', () => {
    editor(newCustomTool());
    click(button(/^A script/));
    next();
    expect(current()).toBe('What it reaches');
    next();
    expect(current()).toBe('What it reaches');
    expect(fieldProblems()).toContain('Say its site');
    next();
    expect(current()).toBe('What the model fills');
  });

  it('counts what is left in the side card, with the problems of the steps been through', () => {
    editor(newCustomTool());
    click(button(/^A script/));
    expect(page().querySelector('.guide-left')?.textContent).toContain('The script');
    expect(page().querySelector('.guide-left .problems')).toBeNull();
    click(button('Its name and description, for the model'));
    expect(current()).toBe('Its name and description, for the model');
    expect(fieldProblems()).toContain('The name is words');
    expect(page().querySelector('.guide-left .problems')?.textContent).toContain('The name is words');
  });

  it("does not merge two inputs' places when one is renamed to the other", () => {
    editor(newCustomTool());
    click(button('Search an API'));
    next();
    click(button('＋ Add a parameter'));
    const names = () => [...page().querySelectorAll<HTMLInputElement>('[aria-label="Parameter name"]')];
    const rename = (i: number, to: string) => {
      act(() => names()[i]!.focus());
      type(names()[i]!, to);
      act(() => names()[i]!.blur());
    };
    rename(1, 'query'); // the other's name: its place is not taken
    expect(summary('The request')).toContain('q={query}');
    rename(1, 'term');
    expect(summary('The request')).toContain('q={query}');
    rename(0, 'words'); // a real rename follows in the request
    expect(summary('The request')).toContain('q={words}');
  });
});

describe('a custom tool that exists', () => {
  const request: CustomTool = {
    id: 'one',
    name: 'example.search',
    description: 'Searches example.',
    base: 'http',
    params: {},
    inputs: [{ name: 'query', type: 'string', description: 'What to search', required: true }],
    http: { method: 'GET', url: 'https://api.example.com/search?q={query}&key={{secret:k}}', extract: 'items[].title', headers: [{ name: 'X-Key', value: 'k' }], secrets: { k: 'v' } },
    labels: ['work'],
    enabled: true,
  };
  const preset: CustomTool = {
    id: 'two', name: 'forum.search', description: 'Searches the forum.', base: 'web.search', enabled: true, group: 'Team',
    params: { query: { mode: 'model', template: '{value} site:forum.example.com' }, limit: { mode: 'fixed', value: 3 } },
    source: { id: 's1', does: 'x' },
  };
  const script: CustomTool = {
    id: 'three', name: 'chat.send', description: 'Sends a message.', base: 'script', enabled: false, params: {},
    inputs: [{ name: 'message', type: 'string', description: 'The message', required: true }],
    http: { method: 'GET', url: '' }, script: "await tool('browser.type', { text: input.message });\nreturn 'ok';", uses: ['browser.type'],
  };
  const catalog = [
    { name: 'web.search', description: 'Searches.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] } },
    { name: 'browser.type', description: 'Types.', inputSchema: { type: 'object', properties: {} } },
  ] as never[];

  for (const tool of [request, preset, script]) {
    it(`opens with its steps folded, and saves as it was: ${tool.name}`, async () => {
      await customToolStore.save(tool);
      const closed = vi.fn();
      editor(tool, [tool], closed, catalog);
      expect(page().querySelector('.numbered-step.current')).toBeNull();
      expect(page().querySelectorAll('.numbered-step.pending').length).toBe(0);
      expect(page().textContent).toContain('✓ Ready to save');
      await act(async () => button('Save').click());
      expect(closed).toHaveBeenCalled();
      expect((await customToolStore.load()).find((c) => c.id === tool.id)).toEqual(tool);
    });
  }

  it('shows its answer cut, untried, and edits it', () => {
    editor(request, [request]);
    expect(summary('Try it')).toContain('answer cut to items[].title');
    openStep('Try it');
    expect(byLabel<HTMLInputElement>('Answer cut to')!.value).toBe('items[].title');
  });

  it('asks before another kind replaces what it has; Cancel keeps it as saved', async () => {
    await customToolStore.save(request);
    const closed = vi.fn();
    editor(request, [request], closed);
    openStep('What it is');
    // No paste box over the request there is.
    expect(byLabel('Paste a URL or a curl command')).toBeUndefined();
    click(button(/^A script/));
    expect(page().querySelector('.inline-confirm')?.textContent).toContain('is cleared');
    click(button('Keep it'));
    expect(stepNamed('The request')).toBeTruthy();
    click(button(/^A script/));
    click(button('Change it'));
    expect(stepNamed('The request')).toBeUndefined();
    click(button('Cancel'));
    expect(closed).toHaveBeenCalled();
    expect((await customToolStore.load())[0]).toEqual(request);
  });

  it('asks before an example replaces a request being written', () => {
    editor(newCustomTool());
    click(button('Search an API'));
    openStep('What it is');
    expect(byLabel('Paste a URL or a curl command')).toBeTruthy();
    click(button('Post a message'));
    expect(page().querySelector('.inline-confirm')?.textContent).toContain('replaces its request');
    click(button('Keep it'));
    expect(summary('The request')).toContain('GET https://api.example.com/search');
  });
});

describe('cutting a tried answer by its keys', () => {
  function Holder({ json }: { json: unknown }) {
    const [extract, setExtract] = useState<string | undefined>();
    const raw = JSON.stringify(json);
    return createElement('div', null,
      createElement('output', { className: 'extract' }, extract ?? ''),
      createElement(AnswerPicker, { json, rawLength: raw.length, cutLength: cutAnswer(json, raw, extract)?.length, extract: extract ?? '', onExtract: setExtract }));
  }
  const key = (k: string) => [...page().querySelectorAll<HTMLButtonElement>('.json-key')].find((b) => b.textContent === k)!;
  const extract = () => page().querySelector('.extract')?.textContent;

  it('builds the path from the keys clicked, and says how much smaller it gets', () => {
    render(createElement(Holder, { json: { items: [{ title: 'a', url: 'https://example.com/a', body: 'x'.repeat(500) }], total: 1 } }));
    click(key('title'));
    click(key('url'));
    expect(extract()).toBe('items[].{title,url}');
    expect(key('title').getAttribute('aria-pressed')).toBe('true');
    expect(page().querySelector('[role="status"]')?.textContent).toMatch(/characters → .*% smaller/);
    click(key('url'));
    expect(extract()).toBe('items[].title');
  });

  it('picks from a list at the top; keys it cannot say, and those inside a picked one, are not clickable', () => {
    render(createElement(Holder, { json: [{ name: 'a', '42': 1, 'a.b': 2, meta: { id: 1 } }] }));
    click(key('name'));
    expect(extract()).toBe('[].name');
    expect(key('42').disabled).toBe(true);
    expect(key('a.b').disabled).toBe(true);
    click(key('meta'));
    expect(extract()).toBe('[].{name,meta}');
    expect(key('id').disabled).toBe(true);
  });
});
