// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { ContextMeter } from '../src/entrypoints/sidepanel/ContextMeter';
import { agentReducer, initialAgentState, type SessionUsage } from '../src/entrypoints/sidepanel/agent-state';
import type { ContextWindow } from '../src/context/window';
import { measureCall } from '../src/context/usage';
import type { ToolInfo } from '../src/core/protocol';
import type { Compaction, Message } from '../src/core/types';

vi.mock('wxt/browser', () => ({ browser: { runtime: {}, tabs: {} } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tool: ToolInfo = { name: 'browser.read', description: 'x'.repeat(400), inputSchema: { type: 'object' }, source: 'browser', effect: 'read' };
const call = (page: string, input: number) => {
  const messages: Message[] = [{ role: 'user', parts: [{ type: 'text', text: 'q' }, { type: 'text', text: page, context: 'page' }] }];
  return measureCall({ system: 'system', tools: [{ name: 'browser__read', description: tool.description, inputSchema: tool.inputSchema }], messages }, [{ type: 'text', text: 'a' }], { input, output: 10, cached: 500 }).usage;
};

// The meter, opened: its text, and a row's two cells by its label.
function open(usage: SessionUsage, window: ContextWindow = { tokens: 10_000, source: 'server' }) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(h(ContextMeter, { usage, window, model: 'm', cuts: [], catalog: [tool], compaction: { busy: false, note: '', onCompact: () => {}, wouldFree: () => 2000 } })));
  act(() => host.querySelector<HTMLButtonElement>('.popover > button')!.click());
  const row = (label: string) => {
    const r = [...host.querySelectorAll('.context-row')].find((e) => e.firstElementChild?.textContent?.startsWith(label));
    const delta = r?.querySelector('.context-delta')?.textContent;
    return r && { tokens: r.lastElementChild!.textContent!.replace(delta ?? '', '').trim(), delta };
  };
  const sections = () => [...host.querySelectorAll('.context-section')].map((e) => e.textContent);
  const done = () => {
    act(() => root.unmount());
    host.remove();
  };
  return { host, text: host.textContent!, row, sections, done };
}

describe('the context meter', () => {
  it('shows the fixed and growing parts, the tools by group, the chart and the session', () => {
    const m = open({ calls: 2, input: 3000, output: 20, cached: 500, reasoning: 0, last: call('p'.repeat(800), 1700), previous: call('p'.repeat(400), 1300), timeline: { inputs: [1300, 1700], compactedAt: [] } });
    expect(m.text).toContain('+400 since the call before');
    expect(m.sections()).toEqual([expect.stringMatching(/^Sent again with every call · ~\S+ \(\d+%\)$/), expect.stringMatching(/^Grows with the conversation/), 'Session']);
    expect(m.row('Page blocks')).toEqual({ tokens: '~200', delta: '+100' });
    expect(m.row('Tool definitions · 1')).toBeDefined();
    expect(m.host.querySelector('.context-group summary')!.textContent).toContain('Browser');
    expect(m.text).toContain('first request 1,300');
    expect(m.text).toContain('500 of it from its prompt cache');
    expect(m.text).toContain('trimming takes out ~2.0k');
    expect(m.text).toContain('Fewer tools offered');
    m.done();
  });

  it('counts tokens alone with the window unknown', () => {
    const m = open({ calls: 1, input: 1700, output: 10, last: call('p', 1700), timeline: { inputs: [1700], compactedAt: [] } }, { source: 'unknown' });
    expect(m.host.querySelector('.meter')).toBeNull();
    expect(m.text).toContain('1,710 tokens');
    expect(m.text).toContain('Context window: unknown');
    m.done();
  });

  it('shows a reopened, compacted conversation with its chart and no split until the next call', () => {
    const answer = (input: number): Message => ({ role: 'assistant', parts: [{ type: 'text', text: 'ok' }], meta: { input, output: 10, reported: true, ms: 1, sinceStartMs: 1 } });
    const user: Message = { role: 'user', parts: [{ type: 'text', text: 'Hi' }] };
    const compaction: Compaction = { at: 1, turns: 1, trimmed: { pages: true, toolResults: true, screenshots: true }, before: 1500, after: 300, ranAfter: 4 };
    const { usage } = agentReducer(initialAgentState('c1'), { type: 'load', conversationId: 'c1', history: [user, answer(1000), { ...user, compaction }, answer(2000)] });
    const m = open(usage);
    expect(m.text).toContain('How the request splits shows after the next call.');
    expect(m.sections()).toEqual(['Session']);
    expect(m.host.querySelectorAll('.context-timeline line.compacted')).toHaveLength(0); // after the last call: not between two
    expect(m.text).not.toContain('since the call before');
    expect(m.host.querySelector('.context-timeline svg')!.getAttribute('aria-label')).toContain('2 calls');
    m.done();
  });
});
