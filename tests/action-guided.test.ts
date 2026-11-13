// @vitest-environment jsdom
// The page widget action editor as a guide: a new action starts by choosing what it does (or an
// example), each kind shows only its own steps and saves what makes it that kind, problems show beside
// their fields once their step was gone through, folded steps and parts keep what was typed, an action
// that exists opens folded and saves as it was, and "Show beside selected text" is a checkbox line.
import { act, createElement } from 'react';
import { readFileSync } from 'node:fs';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeStorage } from './fakes/browser';
import type { WidgetAction } from '../src/widget/actions';
import type { ToolInfo } from '../src/core/protocol';
import type { Settings } from '../src/storage/settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView = () => undefined; // not in jsdom
const storage = fakeStorage();
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage, { permissions: { contains: async () => true, onAdded: { addListener() {}, removeListener() {} }, onRemoved: { addListener() {}, removeListener() {} } }, tabs: { query: async () => [] }, runtime: { getURL: (p: string) => `chrome-extension://test${p}`, id: 'test' } }) }));
const saved: WidgetAction[] = [];
const runs: { action: WidgetAction }[] = [];
vi.mock('../src/widget/client', () => ({ runAction: async (r: { action: WidgetAction }) => (runs.push(r), { outputs: [{ label: 'Result', lines: [{ text: 'Echidna' }] }] }) }));
vi.mock('../src/widget/store', () => ({ actionStore: { save: async (a: WidgetAction) => void saved.push(a), remove: async () => undefined } }));

const { ActionEditor } = await import('../src/ui/widget-actions/Editor');
const { newAction } = await import('../src/widget/actions');
// No providers yet: its model is the chat's.
const settings = { providers: [], speak: {} } as unknown as Settings;

const CATALOG: ToolInfo[] = [
  { name: 'wiki.search', description: 'Search the wiki', source: 'custom', effect: 'read', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Words' } }, required: ['query'] } },
  { name: 'shop.order', description: 'Order', source: 'custom', effect: 'write', inputSchema: { type: 'object', properties: { item: { type: 'string' } } } },
];

let root: Root | undefined;
let host: HTMLElement | undefined;
beforeEach(() => void (saved.length = 0));
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  host?.remove();
  storage.reset();
});

function editor(action: WidgetAction, actions: WidgetAction[] = [], onClose = () => undefined) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(ActionEditor, { action, actions, catalog: CATALOG, agents: [], settings, onClose })));
}
const page = () => host!;
const shown = (el: Element) => !el.closest('[hidden]');
const buttons = () => [...page().querySelectorAll('button')].filter(shown);
const button = (text: string | RegExp) => {
  const found = buttons().find((b) => (typeof text === 'string' ? b.textContent?.trim() === text : text.test(b.textContent ?? '')));
  if (!found) throw new Error(`No button ${text}: ${buttons().map((b) => b.textContent).join(' | ')}`);
  return found;
};
const click = (el: HTMLElement) => act(() => el.click());
function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const byLabel = <T extends HTMLElement>(label: string) => [...page().querySelectorAll<T>(`[aria-label="${label}"]`)].find(shown);
const current = () => page().querySelector('.numbered-step.current h4')?.textContent;
const titles = () => [...page().querySelectorAll('.numbered-step h4')].map((h) => h.firstChild?.textContent);
const stepNamed = (title: string) => [...page().querySelectorAll('.numbered-step')].find((s) => s.querySelector('h4')?.textContent?.startsWith(title));
const summary = (title: string) => stepNamed(title)?.querySelector('.guide-summary')?.textContent ?? '';
const openStep = (title: string) => click(stepNamed(title)!.querySelector<HTMLButtonElement>('.guide-change')!);
const next = () => click(button(/^(Next|Done)/));
const fieldProblems = () => [...page().querySelectorAll('.field-problems')].filter(shown).map((p) => p.textContent).join(' ');
const kindCard = (title: string) => click([...page().querySelectorAll<HTMLButtonElement>('.kind-card')].find((b) => b.textContent?.startsWith(title))!);
const segment = (group: string, label: string) => click([...page().querySelectorAll<HTMLButtonElement>(`[aria-label="${group}"] button`)].find((b) => b.textContent === label)!);
const save = async () => {
  await act(async () => button('Save').click());
  return saved.at(-1)!;
};

describe('a new action', () => {
  it('asks what it does first, with nothing else and no Save yet', () => {
    editor(newAction());
    expect(titles()).toEqual(['What it does']);
    expect(page().textContent).toContain('Choose what it does to start.');
    expect(buttons().some((b) => /^Next/.test(b.textContent ?? ''))).toBe(false);
    expect(button('Save').disabled).toBe(true);
  });

  it('answers about the selection: guided step by step, the optional step passed over', async () => {
    editor(newAction());
    kindCard('Answer about the selection');
    expect(titles()).toEqual(['What it does', 'Where it shows', 'What it takes', 'Values from the page (optional)', 'What it runs', 'How the answer shows', 'Try it', 'Name and icon']);
    expect(current()).toBe('Where it shows');
    expect(summary('What it does')).toBe('Answer about the selection');
    next();
    expect(current()).toBe('What it takes');
    expect(page().querySelector('[aria-label="What it takes"] [aria-pressed="true"]')?.textContent).toBe('The selected text');
    expect(page().querySelector<HTMLInputElement>('.guide-check label.check input')!.checked).toBe(true);
    next();
    // Values from the page is optional: Next passes over it, its line still there.
    expect(current()).toBe('What it runs');
    expect(summary('Values from the page')).toContain('None');
    // No tool on show, the model and the tool folded.
    expect(byLabel('The tool it runs')).toBeUndefined();
    expect(page().querySelector('.guide-fold-summary')?.textContent).toContain('None: only the model answers');
    next();
    expect(fieldProblems()).toContain('Choose the tool it runs, or write a prompt for the model.');
    type(byLabel('Prompt')!, 'Explain in plain words: ');
    click(button('{input}'));
    expect(byLabel<HTMLTextAreaElement>('Prompt')!.value).toBe('Explain in plain words: {input}');
    expect(fieldProblems()).toBe('');
    next();
    expect(current()).toBe('How the answer shows');
    expect(byLabel<HTMLInputElement>('Label of box 1')!.value).toBe('Answer');
    next();
    expect(current()).toBe('Try it');
    next();
    expect(current()).toBe('Name and icon');
    click(button('Explain in plain words'));
    next();
    const a = await save();
    expect(a).toMatchObject({ name: 'Explain in plain words', input: 'selection', besideSelection: true, tool: '', prompt: 'Explain in plain words: {input}', outputs: [{ label: 'Answer' }] });
    expect(a.when).toBeUndefined();
    expect(a.openChat).toBeUndefined();
  });

  it('looks something up with a tool, its parameters taking {input} by a click', async () => {
    editor(newAction());
    kindCard('Look it up with a tool');
    expect(current()).toBe('Where it shows');
    next();
    expect(page().querySelector('[aria-label="What it takes"] [aria-pressed="true"]')?.textContent).toBe('A text (pre-filled with the selection)');
    expect(byLabel('Hint in the field')).toBeUndefined(); // a label: found by its text
    next();
    expect(current()).toBe('What it runs');
    const select = byLabel<HTMLSelectElement>('The tool it runs')!;
    act(() => {
      select.value = 'wiki.search';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    click([...page().querySelectorAll<HTMLButtonElement>('[aria-label="Insert into Value of query"] button')].find(shown)!);
    expect(byLabel<HTMLInputElement>('Value of query')!.value).toBe('{input}');
    next();
    type(byLabel('Path of box 1')!, '[].title');
    openStep('Name and icon');
    expect(button('Wiki search')).toBeTruthy();
    click(button('Wiki search'));
    const a = await save();
    expect(a).toMatchObject({ name: 'Wiki search', tool: 'wiki.search', args: { query: '{input}' }, input: 'text', outputs: [{ label: 'Result', from: '[].title' }] });
    expect(a.prompt).toBeUndefined();
  });

  it('opens the chat: no tool, boxes or try', async () => {
    editor(newAction());
    kindCard('Open the chat with a message');
    expect(titles()).toEqual(['What it does', 'Where it shows', 'What it takes', 'Values from the page (optional)', 'What it runs', 'Name and icon']);
    openStep('What it runs');
    expect(byLabel('The tool it runs')).toBeUndefined();
    type(byLabel('The message')!, 'Summarize this page');
    openStep('Name and icon');
    type(page().querySelector<HTMLInputElement>('.icon-field ~ label input')!, 'Summary');
    const a = await save();
    expect(a).toMatchObject({ openChat: true, tool: '', args: {}, prompt: 'Summarize this page', input: 'none', name: 'Summary' });
  });

  it('checks each page as it loads: only tools that read, and a badge by making it steps', async () => {
    editor(newAction());
    kindCard('Check each page as it loads');
    expect(titles()).not.toContain('What it takes');
    openStep('What it runs');
    expect([...byLabel<HTMLSelectElement>('The tool it runs')!.options].map((o) => o.value)).toEqual(['', 'wiki.search']);
    const select = byLabel<HTMLSelectElement>('The tool it runs')!;
    act(() => {
      select.value = 'wiki.search';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    type(byLabel('Value of query')!, 'cats');
    openStep('How the answer shows');
    type(byLabel('Path of box 1')!, 'total');
    click(button(/A badge on the bubble/));
    click(button('Make it steps'));
    expect(summary('What it does')).toBe('Several steps');
    openStep('Name and icon');
    type(page().querySelector<HTMLInputElement>('.icon-field ~ label input')!, 'Count');
    const a = await save();
    expect(a).toMatchObject({ when: 'load', input: 'none', tool: '', args: {}, steps: [{ name: 'result', tool: 'wiki.search', args: { query: 'cats' } }], outputs: [{ label: 'Result', from: 'result.total' }], badge: 'result' });
  });

  it('runs several steps, on a click or on page load', () => {
    editor(newAction());
    kindCard('Several steps');
    openStep('What it takes');
    segment('When it runs', 'On page load');
    expect(byLabel('What it takes')).toBeUndefined();
    openStep('What it runs');
    expect(page().textContent).toContain('Its steps, in order');
    expect(summary('What it takes')).toBe('On page load');
  });

  it('starts from an example, and asks before another replaces it', () => {
    editor(newAction());
    click(button('Explain the selection'));
    expect(current()).toBe('Where it shows');
    expect(summary('What it does')).toBe('Answer about the selection');
    expect(summary('What it runs')).toBe('');
    openStep('What it does');
    click(button('Ask the chat about this page'));
    expect(page().querySelector('.inline-confirm')?.textContent).toContain('It replaces its name, its icon, its prompt, its boxes and Show beside selected text.');
    // The safe answer has the focus: Enter keeps what is there.
    expect(document.activeElement?.textContent).toBe('Keep it');
    click(button('Keep it'));
    openStep('What it runs');
    expect(byLabel<HTMLTextAreaElement>('Prompt')!.value).toContain('Explain this in plain words');
  });

  it('asks before another kind clears what it has', () => {
    editor(newAction());
    kindCard('Answer about the selection');
    openStep('What it runs');
    type(byLabel('Prompt')!, 'Translate: {input}');
    openStep('What it does');
    kindCard('Look it up with a tool');
    expect(page().querySelector('.inline-confirm')?.textContent).toContain('It clears its prompt.');
    click(button('Change it'));
    expect(summary('What it does')).toBe('Look it up with a tool');
    // Where it shows was gone through and still applies: done; on to what it takes.
    expect(summary('Where it shows')).toContain('Browser');
    expect(current()).toBe('What it takes');
    expect(summary('What it runs')).toBe('');
    openStep('What it runs');
    expect(byLabel('Prompt')).toBeUndefined();
  });

  it('changes kind without asking when nothing would be lost', () => {
    editor(newAction());
    kindCard('Answer about the selection');
    openStep('What it does');
    kindCard('Open the chat with a message');
    expect(page().querySelector('.inline-confirm')).toBeNull();
    expect(summary('What it does')).toBe('Open the chat with a message');
  });

  it('forgets a question once the user is elsewhere, and applies a kind to the action as it is then', () => {
    editor(newAction());
    kindCard('Look it up with a tool');
    openStep('What it runs');
    const select = byLabel<HTMLSelectElement>('The tool it runs')!;
    act(() => {
      select.value = 'wiki.search';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    openStep('What it does');
    kindCard('Open the chat with a message');
    expect(page().querySelector('.inline-confirm')).not.toBeNull();
    openStep('What it takes');
    expect(page().querySelector('.inline-confirm')).toBeNull();
    // Asked again after a change elsewhere, Change it keeps that change.
    segment('What it takes', 'The selected text');
    openStep('What it does');
    kindCard('Open the chat with a message');
    click(button('Change it'));
    expect(summary('What it takes')).toBe('The selected text');
  });

  it('keeps the hint in its field and its reading aloud, as before', async () => {
    const action: WidgetAction = { id: 'h', enabled: true, name: 'Ask', where: [], input: 'text', placeholder: 'words', tool: '', args: {}, prompt: 'Say {input}', outputs: [{ label: 'Answer' }], speak: { when: 'shown' } };
    editor(action, [action]);
    openStep('What it takes');
    segment('What it takes', 'Nothing');
    openStep('What it runs');
    type(byLabel('Prompt')!, 'Say hello');
    const a = await save();
    expect(a).toMatchObject({ input: 'none', placeholder: 'words', speak: { when: 'shown' } });
  });

  it('on page load with steps, offers only tools that read, to each step too', () => {
    editor(newAction());
    kindCard('Several steps');
    openStep('What it runs');
    click(button(/＋ tool/));
    const toolOptions = () => [...page().querySelectorAll<HTMLSelectElement>('.step-tool select')].filter(shown)[0]!.options;
    expect([...toolOptions()].map((o) => o.value)).toEqual(['', 'shop.order', 'wiki.search']);
    openStep('What it takes');
    segment('When it runs', 'On page load');
    openStep('What it runs');
    expect([...toolOptions()].map((o) => o.value)).toEqual(['', 'wiki.search']);
  });

  it('with every step removed, says to add one, not to choose a tool', () => {
    editor(newAction());
    kindCard('Several steps');
    openStep('What it runs');
    click(byLabel<HTMLButtonElement>('Remove step page')!);
    expect(page().textContent).toContain('No steps yet: add one');
    expect(fieldProblems()).toContain('Choose the tool it runs, or write a prompt for the model.');
    expect([...page().querySelectorAll('.numbered-step.current .field-problems')].length).toBe(1);
  });

  it('tries up to a step under the steps, What it runs left open', () => {
    editor(newAction());
    kindCard('Several steps');
    openStep('What it runs');
    click(button('▶ Try up to here'));
    expect(current()).toBe('What it runs');
    expect([...page().querySelectorAll('legend')].filter(shown).map((l) => l.textContent)).toContain('Try up to a step');
  });
});

describe('what was typed stays', () => {
  it('in a folded step, and in a folded part', () => {
    editor(newAction());
    kindCard('Answer about the selection');
    openStep('Values from the page');
    click(button('＋ Add a value'));
    type(byLabel('Name of value 1')!, 'article');
    type(byLabel('How value 1 is read')!, '{{page}}');
    openStep('What it runs');
    expect(summary('Values from the page')).toContain('{article}');
    // The new value is a chip for the prompt.
    expect(button('{article}')).toBeTruthy();
    click(button(/Model and thinking/));
    click(button(/Model and thinking/));
    openStep('Values from the page');
    expect(byLabel<HTMLInputElement>('Name of value 1')!.value).toBe('article');
  });
});

describe('problems', () => {
  it('show beside their field only once the step was gone through, and the side card counts them', () => {
    editor(newAction());
    kindCard('Answer about the selection');
    expect(page().querySelector('.guide-left')?.textContent).toContain('Name and icon · 1');
    expect(fieldProblems()).toBe('');
    expect(page().querySelector('.guide-left .problems')).toBeNull();
    // Opened by a click, it counts as gone through: its problem beside the name, and in the side card.
    openStep('Name and icon');
    expect(fieldProblems()).toContain('The action needs a name');
    expect(page().querySelector('.guide-left .problems')?.textContent).toContain('The action needs a name');
    type(page().querySelector<HTMLInputElement>('.icon-field ~ label input')!, 'Ask');
    expect(fieldProblems()).toBe('');
  });
});

// Existing actions of each kind, as saved (one made by the model among them).
const EXISTING: [string, WidgetAction][] = [
  ['a tool on a click', { id: 't', enabled: true, name: 'Search', where: ['https://wiki.example.com/*'], input: 'selection', tool: 'wiki.search', args: { query: '{input}' }, outputs: [{ label: 'Pages', from: '[].title', link: 'https://wiki.example.com/{title}' }], besideSelection: true }],
  ['a prompt only', { id: 'p', enabled: false, name: 'Translate', icon: '🌐', where: [], input: 'text', placeholder: 'words', tool: '', args: {}, prompt: 'Translate: {input}', providerId: 'x', model: 'm', thinking: 'low', outputs: [{ label: 'Spanish' }], speak: { when: 'shown' } }],
  ['a tool and a prompt', { id: 'tp', enabled: true, name: 'Brief', where: [], input: 'none', tool: 'wiki.search', args: { query: '{title}' }, reads: { title: '{{meta:og:title}}' }, prompt: 'Brief me on {title}', outputs: [{ label: 'Summary', from: 'summary' }, { label: 'Risks', from: 'risks' }] }],
  ['one that opens the chat', { id: 'c', enabled: true, name: 'Explain', where: [], input: 'selection', tool: '', args: {}, prompt: 'Explain {input}', openChat: true, outputs: [] }],
  ['one on page load', { id: 'l', enabled: true, name: 'Issues', where: ['https://code.example.com/*/*'], input: 'none', tool: 'wiki.search', args: { query: '{repo}' }, when: 'load', reads: { repo: '{{url}}' }, outputs: [{ label: 'Open', from: 'count' }] }],
  ['one with steps', { id: 's', enabled: true, name: 'Triage', where: [], input: 'none', tool: '', args: {}, when: 'load', steps: [{ name: 'page', read: '{{url}}' }, { name: 'triage', prompt: 'Triage {page}', fields: { urgent: 'boolean' } }], outputs: [{ label: 'Urgent', from: 'triage.urgent' }], badge: 'triage.urgent', chatButtons: true }],
  ['one of an agent', { id: 'g', enabled: true, name: 'Shop search', where: [], input: 'text', tool: 'wiki.search', args: { query: '{input}' }, outputs: [{ label: 'Items', from: '[]' }], agent: 'shop' }],
  ['one made by the model', { id: 'm', enabled: true, name: 'Lookup', where: [], input: 'text', tool: 'wiki.search', args: { query: '{input}' }, outputs: [{ label: 'Result', from: '[]' }], createdBy: 'model' }],
];

describe('an action that exists', () => {
  it.each(EXISTING)('%s opens with its steps done and saves as it was', async (_, action) => {
    editor(action, [action]);
    expect(page().querySelector('.numbered-step.current')).toBeNull();
    expect(page().querySelectorAll('.numbered-step.pending').length).toBe(0);
    const a = await save();
    expect(JSON.stringify(a)).toBe(JSON.stringify(action));
  });

  it('is the kind its fields say', () => {
    const kinds = EXISTING.map(([, action]) => {
      editor(action, [action]);
      const k = summary('What it does');
      act(() => root!.unmount());
      root = undefined;
      return k;
    });
    expect(kinds).toEqual(['Look it up with a tool', 'Answer about the selection', 'Answer about the selection', 'Open the chat with a message', 'Check each page as it loads', 'Several steps', 'Look it up with a tool', 'Look it up with a tool']);
  });

  it('keeps what no step shows when one field is changed', async () => {
    const action = EXISTING[1]![1]; // its model, thinking, hint and reading aloud
    editor(action, [action]);
    openStep('Name and icon');
    type(page().querySelector<HTMLInputElement>('.icon-field ~ label input')!, 'Translate it');
    const a = await save();
    expect(a).toEqual({ ...action, name: 'Translate it' });
  });

  it('changed to another kind, keeps the steps that still apply done', async () => {
    const action = EXISTING[0]![1]; // a tool on a click, beside the selection
    editor(action, [action]);
    openStep('What it does');
    kindCard('Answer about the selection');
    expect(page().querySelector('.inline-confirm')).toBeNull(); // the tool stays, as a tool first
    expect(current()).toBe('What it runs');
    expect(summary('Name and icon')).toContain('Search');
    expect(summary('Where it shows')).toContain('wiki.example.com');
    type(byLabel('Prompt')!, 'Sum up {input}');
    const a = await save();
    expect(a).toMatchObject({ tool: 'wiki.search', prompt: 'Sum up {input}', besideSelection: true, where: action.where });
  });

  it('says it was tried only while the action is as it was tried', async () => {
    const action = EXISTING[0]![1];
    editor(action, [action]);
    const sideLine = () => page().querySelector('.custom-side-card p.muted.small')?.textContent;
    openStep('Try it');
    type(byLabel('Input to try')!, 'platypus');
    await act(async () => button('Try').click());
    expect(runs.at(-1)!.action.name).toBe('Search');
    expect(sideLine()).toBe('Tried: it answered');
    openStep('Name and icon');
    expect(summary('Try it')).toBe('Tried: it answered');
    type(page().querySelector<HTMLInputElement>('.icon-field ~ label input')!, 'Search it');
    expect(sideLine()).toBe('Not tried yet');
  });

  it('says at its first step a problem its kind has no field for', () => {
    const action: WidgetAction = { id: 'cb', enabled: true, name: 'Chat', where: [], input: 'none', tool: '', args: {}, prompt: 'Hi', openChat: true, outputs: [{ label: '' }] };
    editor(action, [action]);
    openStep('What it does');
    expect(fieldProblems()).toContain('Box 1 needs a label.');
  });
});

describe('Show beside selected text', () => {
  it('is a checkbox line, out of the grid laid on the step\'s other labels', () => {
    editor(EXISTING[0]![1], [EXISTING[0]![1]]);
    const label = [...page().querySelectorAll('label.check')].find((l) => l.textContent?.includes('Show beside selected text'))!;
    expect(label.parentElement?.className).toBe('guide-check');
    expect(label.querySelector('input')?.nextElementSibling?.textContent).toBe('Show beside selected text');
    // The rules that make a step's labels a grid leave a checkbox's label alone.
    const css = readFileSync('src/ui/style.css', 'utf8');
    const gridded = css.split('\n').filter((l) => /numbered-step-body > label|guide-step-fields > label|guide-fold-body > label/.test(l) && l.includes('display: grid'));
    expect(gridded.length).toBeGreaterThan(0);
    for (const rule of gridded) for (const sel of rule.split('{')[0]!.split(',')) expect(sel).toContain(':not(.check)');
  });
});
