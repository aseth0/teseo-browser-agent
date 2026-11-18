// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ASK_WIRE } from '../src/agents/ask';
import { DISPLAY_DEFAULTS, type DisplayValues } from '../src/core/display-defs';
import { PLAN_REMINDER_SOURCE } from '../src/core/sources';
import type { ChatView } from '../src/storage/settings-types';
import type { ToolResultPart } from '../src/ui/chat/turns';

// A tool call's row: the switches args and result (or error) show each part on its own, on top of
// the fold (the caret opens on the arguments, the result a fold under them).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// The memory items, for a memory call's title.
vi.mock('../src/ui/useCollection', () => ({ useCollection: () => [{ id: 'm1', title: 'Shopping list', text: 'Milk', updatedAt: 1 }] }));
const { ChatViewContext, DisplayContext } = await import('../src/ui/chat/contexts');
const { ToolCall } = await import('../src/ui/chat/ToolCallView');

const done: ToolResultPart = { type: 'tool_result', toolCallId: 'c1', content: 'PAGE TEXT' };
let root: Root | undefined;
afterEach(() => act(() => root?.unmount()));

interface Shown {
  view?: ChatView;
  display?: Partial<DisplayValues>;
  running?: boolean;
  name?: string;
  args?: unknown;
}
function show(result: ToolResultPart | undefined, view: ChatView = {}, running = false, more: Shown = {}) {
  const host = document.createElement('div');
  root = createRoot(host);
  const render = (o: Shown) => {
    const call = createElement(ToolCall, { id: 'c1', name: o.name ?? 'browser.get_page_text', args: o.args ?? { tabId: 1 }, result, running: o.running ?? running });
    const shown = createElement(DisplayContext.Provider, { value: { ...DISPLAY_DEFAULTS, ...o.display } }, call);
    act(() => root!.render(createElement(ChatViewContext.Provider, { value: o.view ?? view }, shown)));
  };
  render(more);
  const $ = <T extends Element>(sel: string) => host.querySelector<T>(sel);
  const call$ = () => $<HTMLDetailsElement>('details.tool')!;
  const pressed = (part: 'args' | 'result') => $(`.tool-switch[data-part="${part}"]`)?.getAttribute('aria-pressed');
  const click = (sel: string) => act(() => $<HTMLElement>(sel)!.click());
  // Shown again with other options, as a change in Settings does.
  const again = (o: Shown) => render({ ...more, ...o });
  return { $, call: call$, pressed, click, again, host };
}

describe('a tool call row', () => {
  it('is closed by default, both switches off', () => {
    const v = show(done);
    expect(v.call().open).toBe(false);
    expect(v.pressed('args')).toBe('false');
    expect(v.pressed('result')).toBe('false');
    expect(v.$('.tool-switch[data-part="args"]')!.getAttribute('title')).toBe('Show the arguments');
    expect(v.$('.tool-switch[data-part="result"]')!.getAttribute('title')).toBe('Show the result');
  });

  it('opens on the arguments from the row, the result a closed fold', () => {
    const v = show(done);
    v.click('details.tool > summary');
    expect(v.call().open).toBe(true);
    expect(v.$('pre.tool-args')).not.toBeNull();
    expect(v.$<HTMLDetailsElement>('details.tool-result')!.open).toBe(false);
    expect(v.pressed('args')).toBe('true');
    expect(v.pressed('result')).toBe('false');
    v.click('details.tool > summary');
    expect(v.call().open).toBe(false);
  });

  it('shows the result alone from its switch', () => {
    const v = show(done);
    v.click('.tool-switch[data-part="result"]');
    expect(v.call().open).toBe(true);
    expect(v.$('pre.tool-args')).toBeNull();
    expect(v.$<HTMLDetailsElement>('details.tool-result')!.open).toBe(true);
    expect(v.$('details.tool-result')!.textContent).toContain('PAGE TEXT');
    expect(v.pressed('args')).toBe('false');
    expect(v.pressed('result')).toBe('true');
    v.click('.tool-switch[data-part="args"]');
    expect(v.$('pre.tool-args')).not.toBeNull();
    expect(v.pressed('result')).toBe('true');
  });

  it('closes when both are turned off', () => {
    const v = show(done);
    v.click('.tool-switch[data-part="result"]');
    v.click('.tool-switch[data-part="result"]');
    expect(v.call().open).toBe(false);
  });

  it('lights result when its fold is opened', () => {
    const v = show(done);
    v.click('details.tool > summary');
    v.click('details.tool-result > summary');
    expect(v.pressed('result')).toBe('true');
    expect(v.pressed('args')).toBe('true');
  });

  it('names an error as such', () => {
    const v = show({ ...done, isError: true });
    const sw = v.$('.tool-switch[data-part="result"]')!;
    expect(sw.textContent).toBe('error');
    expect(sw.getAttribute('title')).toBe('Show the error');
  });

  it('has no result switch while it runs', () => {
    const v = show(undefined, {}, true);
    expect(v.$('.tool-switch[data-part="result"]')).toBeNull();
    expect(v.$('.tool-thumb')).toBeNull();
    expect(v.$('.tool-switch[data-part="args"]')).not.toBeNull();
  });

  it('shows a screenshot as a thumbnail that opens the result', () => {
    const v = show({ ...done, images: [{ mediaType: 'image/png', data: 'AAAA' }] });
    expect(v.$('.tool-thumb img')).not.toBeNull();
    v.click('.tool-thumb');
    expect(v.pressed('result')).toBe('true');
    expect(v.$('pre.tool-args')).toBeNull();
  });

  it('opens both parts in the expanded view, and they can be closed', () => {
    const v = show(done, { toolCalls: 'expanded' });
    expect(v.call().open).toBe(true);
    expect(v.pressed('args')).toBe('true');
    expect(v.pressed('result')).toBe('true');
    v.click('details.tool > summary');
    expect(v.call().open).toBe(false);
  });

  it('opens both parts from the row in the compact view', () => {
    const v = show(done, { toolCalls: 'compact' });
    v.click('details.tool > summary');
    expect(v.pressed('args')).toBe('true');
    expect(v.pressed('result')).toBe('true');
    expect(v.$('.tool-result pre')!.textContent).toContain('PAGE TEXT');
  });
});

// Settings → Display: what the row and its parts show, also on calls already in the chat.
describe('a tool call as Settings → Display says', () => {
  const json: ToolResultPart = { ...done, content: '{"items":[1,2]}' };

  it('shows the arguments as fields', () => {
    const v = show(done, {}, false, { display: { toolArgs: 'fields' }, args: { query: 'shoes', filters: { size: 42 }, note: 'a\nb' } });
    v.click('.tool-switch[data-part="args"]');
    expect(v.$('pre.tool-args')).toBeNull();
    const fields = [...v.host.querySelectorAll('dl.tool-args-fields > div')];
    expect(fields.map((f) => f.querySelector('dt')!.textContent)).toEqual(['query', 'filters', 'note']);
    expect(fields[0]!.querySelector('dd')!.textContent).toBe('shoes');
    expect(fields[1]!.querySelector('dd pre')!.textContent).toContain('"size": 42');
    expect(fields[2]!.querySelector('dd pre')!.textContent).toBe('a\nb');
  });

  it("shows an agents.ask brief's fields in the schema's order; a call saved before, with agent and task alone, as it was", () => {
    const fieldsOf = (args: unknown) => {
      const v = show(done, {}, false, { display: { toolArgs: 'fields' }, name: ASK_WIRE, args });
      v.click('.tool-switch[data-part="args"]');
      const shown = [...v.host.querySelectorAll('dl.tool-args-fields > div')].map((f) => [f.querySelector('dt')!.textContent, f.querySelector('dd')!.textContent]);
      act(() => root?.unmount());
      return shown;
    };
    expect(fieldsOf({ report: 'the link', task: 'find it', agent: 'mm', context: 'not #general' })).toEqual([['agent', 'mm'], ['task', 'find it'], ['context', 'not #general'], ['report', 'the link']]);
    expect(fieldsOf({ agent: 'mm', task: 'find it' })).toEqual([['agent', 'mm'], ['task', 'find it']]);
  });

  it('opens a JSON result as JSON first, and its switch still goes back to text', () => {
    const v = show(json, {}, false, { display: { toolResultView: 'json' } });
    v.click('.tool-switch[data-part="result"]');
    expect(v.$('pre.tool-json')).not.toBeNull();
    v.click('.tool-view-switch button:first-child');
    expect(v.$('pre.tool-json')).toBeNull();
  });

  it('shows a result already in the chat as the new first view', () => {
    const v = show(json);
    v.click('.tool-switch[data-part="result"]');
    expect(v.$('pre.tool-json')).toBeNull();
    v.again({ display: { toolResultView: 'json' } });
    expect(v.$('pre.tool-json')).not.toBeNull();
  });

  it('hides the screenshot thumbnail, the tab chip and the memory title', () => {
    const result = { ...done, images: [{ mediaType: 'image/png', data: 'AAAA' }], tab: { id: 3, title: 'Shop', url: 'https://example.com' } };
    const v = show(result, {}, false, { name: 'memory.read', args: { id: 'm1' } });
    expect(v.$('.tool-thumb')).not.toBeNull();
    expect(v.host.textContent).toContain('Shop');
    expect(v.host.textContent).toContain('Shopping list');
    v.again({ display: { toolScreenshot: 'hidden', toolTab: 'hidden', toolMemoryTitle: 'hidden' } });
    expect(v.$('.tool-thumb')).toBeNull();
    expect(v.host.textContent).not.toContain('Shop');
    expect(v.$('.tool-switch[data-part="result"]')).not.toBeNull(); // the screenshot is still in the result
  });

  it('hides the pills of what was attached after it', () => {
    const result: ToolResultPart = { ...done, attached: [{ kind: 'tool', text: '1. Find the shoes', source: PLAN_REMINDER_SOURCE }] };
    const v = show(result);
    expect(v.$('.tool-attached')).not.toBeNull();
    v.again({ display: { toolAttached: 'hidden' } });
    expect(v.$('.tool-attached')).toBeNull();
  });

  it('always shows an error, the cut mark and the DevTools badge', () => {
    const hidden = Object.fromEntries(Object.keys(DISPLAY_DEFAULTS).map((k) => [k, 'hidden'])) as unknown as DisplayValues;
    const v = show({ ...done, isError: true, devtools: true }, {}, false, { display: hidden });
    expect(v.$('.tool-switch[data-part="result"]')!.textContent).toBe('error');
    expect(v.$('.badge.devtools')).not.toBeNull();
  });

  it('leaves the steps of a sub-agent open once it ends', () => {
    const trace = { agent: 'Helper', messages: [{ role: 'user' as const, parts: [{ type: 'text' as const, text: 'task' }] }] };
    const v = show({ ...done, trace }, {}, false, { name: ASK_WIRE });
    expect(v.$<HTMLDetailsElement>('details.sub-agent')!.open).toBe(false);
    v.again({ display: { subAgentTrace: 'open' } });
    expect(v.$<HTMLDetailsElement>('details.sub-agent')!.open).toBe(true);
  });
});

describe('a tool call when the tool calls view changes', () => {
  it('shows a call already in the chat as the new view', () => {
    const v = show(done);
    expect(v.call().open).toBe(false);
    v.again({ view: { toolCalls: 'expanded' } });
    expect(v.call().open).toBe(true);
    expect(v.pressed('args')).toBe('true');
    expect(v.pressed('result')).toBe('true');
    v.again({ view: { toolCalls: 'collapsed' } });
    expect(v.call().open).toBe(false);
  });
});
