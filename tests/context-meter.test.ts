import { describe, expect, it } from 'vitest';
import { agentReducer, initialAgentState, timelineOf, type AgentState } from '../src/entrypoints/sidepanel/agent-state';
import { contextParts, growth, sentToolGroups } from '../src/entrypoints/sidepanel/context-parts';
import { measureCall } from '../src/context/usage';
import type { BackgroundToPanel, ToolInfo } from '../src/core/protocol';
import type { CallUsage, Compaction, Message, ToolSpec } from '../src/core/types';

const user: Message = { role: 'user', parts: [{ type: 'text', text: 'Hi' }] };
const answer = (input: number, extra: Partial<NonNullable<Message['meta']>> = {}): Message => ({ role: 'assistant', parts: [{ type: 'text', text: 'ok' }], meta: { input, output: 10, reported: true, ms: 1, sinceStartMs: 1, ...extra } });
const compaction = (ranAfter?: number): Compaction => ({ at: 1, turns: 1, trimmed: { pages: true, toolResults: true, screenshots: true }, before: 100, after: 10, ...(ranAfter !== undefined && { ranAfter }) });
const event = (s: AgentState, e: BackgroundToPanel) => agentReducer(s, { type: 'event', event: e });

const tool = (name: string, source: ToolInfo['source'], description = 'd', group?: string): ToolInfo => ({ name, description, inputSchema: { type: 'object' }, source, effect: 'read', ...(group && { group }) });
const spec = (t: ToolInfo): ToolSpec => ({ name: t.name.replace(/\./g, '__'), description: t.description, inputSchema: t.inputSchema });

function call(page: string, tools: ToolSpec[], reported?: CallUsage['reported']): CallUsage {
  const messages: Message[] = [{ role: 'user', parts: [{ type: 'text', text: 'q' }, { type: 'text', text: page, context: 'page' }] }];
  return measureCall({ system: 's'.repeat(400), tools, messages }, [{ type: 'text', text: 'a' }], reported).usage;
}

describe('context meter: the parts of the last request', () => {
  const tools = [tool('browser.read', 'browser', 'x'.repeat(400))].map(spec);

  it('splits it into what every call sends again and what grows, with the change since the call before', () => {
    const before = call('p'.repeat(400), tools);
    const last = call('p'.repeat(800), tools);
    const parts = contextParts(last, before);
    expect(parts.filter((p) => p.fixed).map((p) => p.key)).toEqual(['tools', 'system']);
    expect(parts.find((p) => p.key === 'tools')!.delta).toBe(0);
    expect(parts.find((p) => p.key === 'pageContext')).toMatchObject({ fixed: false, tokens: 200, delta: 100 });
    expect(parts.some((p) => p.key === 'skills')).toBe(false); // none: left out
  });

  it('tells no change against a call it did not measure, and no split for one it did not', () => {
    const saved: CallUsage = { breakdown: { system: 0, tools: 0, conversation: 900, pageContext: 0, skills: 0, toolResults: 0 }, estimatedOutput: 0 };
    expect(contextParts(call('p', tools), saved).every((p) => p.delta === undefined)).toBe(true);
    expect(contextParts(saved)).toEqual([]);
    expect(contextParts(undefined)).toEqual([]);
  });

  it('keeps the names of the tools a request offered', () => {
    expect(call('p', tools).toolNames).toEqual(['browser__read']);
    expect(call('p', []).toolNames).toBeUndefined();
  });
});

describe('context meter: the tool definitions sent, by group', () => {
  const catalog = [
    tool('browser.read', 'browser', 'x'.repeat(40)),
    tool('browser.click', 'browser', 'x'.repeat(800)),
    tool('memory.save', 'memory'),
    tool('mcp.gh.issue', 'mcp', 'x'.repeat(4000), 'mcp:gh'),
    tool('history.search', 'history'), // offered, not sent
  ];
  const sent = ['browser__read', 'browser__click', 'memory__save', 'mcp__gh__issue', 'webmcp__gone'];

  it('groups the sent ones as the tools menu does, the heaviest group and tool first', () => {
    const { groups, others } = sentToolGroups(catalog, sent);
    expect(groups.map((g) => [g.group, g.count])).toEqual([['mcp:gh', 1], ['browser', 2], ['memory', 1]]);
    expect(groups[0]!.label).toBe('MCP · gh');
    expect(groups[1]!.tools!.map((t) => t.name)).toEqual(['browser.click', 'browser.read']);
    expect(groups[1]!.tokens).toBeGreaterThan(groups[2]!.tokens);
    expect(others).toBe(1); // a page's tool no longer in the catalog
  });

  it('adds up to what the request\'s definitions weighed', () => {
    const { groups } = sentToolGroups(catalog, sent, 2000);
    expect(Math.abs(groups.reduce((n, g) => n + g.tokens, 0) - 2000)).toBeLessThanOrEqual(groups.length);
    for (const g of groups) expect(Math.abs(g.tools!.reduce((n, t) => n + t.tokens, 0) - g.tokens)).toBeLessThanOrEqual(g.count);
  });

  it('has nothing for a request without tools', () => {
    expect(sentToolGroups(catalog, undefined)).toEqual({ groups: [], others: 0 });
  });
});

describe('context meter: how the context grew', () => {
  it('follows the calls of the conversation, not its sub-agents, with the change of the last', () => {
    let s = agentReducer(initialAgentState('c1'), { type: 'run', history: [user] });
    s = event(s, { type: 'usage', usage: call('p', [], { input: 1000, output: 5 }) });
    const sub: BackgroundToPanel = { type: 'sub', callId: 'k', agent: 'Helper', event: { type: 'usage', usage: call('p', [], { input: 9000, output: 5 }) } };
    s = event(s, sub);
    s = event(s, { type: 'usage', usage: call('p', [], { input: 1300, output: 5, cached: 900 }) });
    expect(s.usage.timeline).toEqual({ inputs: [1000, 1300], compactedAt: [] });
    expect(s.usage).toMatchObject({ calls: 3, input: 11300, cached: 900 });
    expect(s.usage.previous?.reported?.input).toBe(1000);
    expect(growth(s.usage.timeline)).toEqual({ first: 1000, delta: 300 });
  });

  it('marks a compaction after the calls before it, and tells no change across it', () => {
    let s = agentReducer(initialAgentState('c1'), { type: 'load', conversationId: 'c1', history: [user, answer(1000)] });
    const c = compaction(2);
    s = agentReducer(s, { type: 'history', conversationId: 'c1', history: [user, { ...answer(1000), compaction: c }], compaction: c });
    s = event(s, { type: 'usage', usage: call('p', [], { input: 400, output: 5 }) });
    expect(s.usage.timeline).toEqual({ inputs: [1000, 400], compactedAt: [1] });
    expect(growth(s.usage.timeline)).toEqual({ first: 1000 });
  });

  it('marks compactions with no call between them once', () => {
    let s = agentReducer(initialAgentState('c1'), { type: 'load', conversationId: 'c1', history: [user, answer(1000)] });
    for (const c of [compaction(2), compaction(2)]) s = agentReducer(s, { type: 'history', conversationId: 'c1', history: [user, { ...answer(1000), compaction: c }], compaction: c });
    expect(s.usage.timeline!.compactedAt).toEqual([1]);
    expect(timelineOf([user, { ...answer(1000), compaction: compaction(2) }, { ...user, compaction: compaction(2) }]).compactedAt).toEqual([1]);
  });

  it('tells no change of the last call once compacted after it (Compact now)', () => {
    expect(growth({ inputs: [1000, 1300], compactedAt: [2] })).toEqual({ first: 1000 });
    expect(growth({ inputs: [1000, 1300, 1500], compactedAt: [1] })).toEqual({ first: 1000, delta: 200 });
  });

  it('draws a regenerated answer\'s chart as a reload would, keeping the totals', () => {
    let s = agentReducer(initialAgentState('c1'), { type: 'load', conversationId: 'c1', history: [user, answer(1000), user, answer(1500)] });
    s = agentReducer(s, { type: 'run', history: [user, answer(1000), user] });
    expect(s.usage.timeline).toEqual({ inputs: [1000], compactedAt: [] });
    expect(s.usage).toMatchObject({ calls: 2, input: 2500 });
  });

  it('rebuilds them from a saved conversation, with its cached and reasoning tokens', () => {
    const history: Message[] = [user, answer(1000, { cached: 600, reasoning: 4 }), user, { ...user, compaction: compaction(4) }, answer(500), user, answer(800)];
    expect(timelineOf(history)).toEqual({ inputs: [1000, 500, 800], compactedAt: [1] });
    const s = agentReducer(initialAgentState('c1'), { type: 'load', conversationId: 'c1', history });
    expect(s.usage).toMatchObject({ cached: 600, reasoning: 4, timeline: { inputs: [1000, 500, 800] } });
  });
});
