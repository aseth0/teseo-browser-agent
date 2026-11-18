import { describe, expect, it } from 'vitest';
import { currentPhase, keepPhases, MAX_KEPT_PHASES, phaseRecorder, phaseSummary, phaseTime, phaseTree, withPhase, type TurnPhase } from '../src/core/phases';
import { runAgentLoop } from '../src/core/agent-loop';
import { ToolRegistry } from '../src/core/tool-registry';
import type { Message } from '../src/core/types';
import { agentReducer, initialAgentState } from '../src/entrypoints/sidepanel/agent-state';
import { collect, loop, scripted } from './helpers';

// A recorder on a clock moved by hand, and what it sent, merged as the panel merges it.
function recorded() {
  let t = 1000;
  const sent: TurnPhase[] = [];
  let list: TurnPhase[] = [];
  const rec = phaseRecorder((p) => {
    sent.push(p);
    list = withPhase(list, p);
  }, () => t);
  return { rec, sent, list: () => list, tick: (ms: number) => (t += ms) };
}

describe('phaseRecorder', () => {
  it('sends a phase as it starts and as it ends, with its duration and the detail noted meanwhile', () => {
    const { rec, sent, list, tick } = recorded();
    const p = rec.start({ kind: 'setup', label: 'Setting up' });
    tick(40);
    p.note('Provider · m');
    tick(10);
    p.end();
    p.end('again'); // once only
    expect(sent).toHaveLength(3);
    expect(list()).toEqual([{ id: p.id, kind: 'setup', label: 'Setting up', detail: 'Provider · m', at: 1000, ms: 50 }]);
  });

  it('puts the phases of a recorder under its parent, and a known id stays as given', () => {
    const { rec, list } = recorded();
    const call = rec.start({ kind: 'tool', label: 'agents.ask', id: 'tool:c1' });
    rec.under(call.id).add({ kind: 'call', label: 'Model call 1', ms: 5 });
    call.end();
    expect(list().map((p) => [p.id.startsWith('tool:') ? p.id : 'made', p.parent])).toEqual([['tool:c1', undefined], ['made', 'tool:c1']]);
  });

  it('times a step, leaving it out when it found nothing, and records it as failed when it throws', async () => {
    const { rec, list, tick } = recorded();
    await rec.time({ kind: 'context', label: 'Bookmarks matched' }, () => [], (r) => (r.length ? `${r.length} attached` : undefined));
    await rec.time({ kind: 'context', label: 'Reading the page' }, async () => { tick(30); return 'page'; }, () => 'about 1 tokens');
    await expect(rec.time({ kind: 'context', label: 'Sites mentioned' }, async () => { throw new Error('gone'); }, () => 'x')).rejects.toThrow('gone');
    expect(list().map((p) => [p.label, p.detail, p.ms])).toEqual([['Reading the page', 'about 1 tokens', 30], ['Sites mentioned', 'failed', 0]]);
  });
});

describe('the panel side', () => {
  const p = (id: string, at: number, ms?: number, parent?: string): TurnPhase => ({ id, kind: 'other', label: id, at, ...(ms !== undefined && { ms }), ...(parent && { parent }) });

  it('names the latest phase begun that has not ended', () => {
    expect(currentPhase([p('a', 1), p('b', 2), p('c', 3, 1)])?.id).toBe('b');
    expect(currentPhase([p('a', 1, 4)])).toBeUndefined();
  });

  it('nests the phases under their parents, in the order they began', () => {
    const tree = phaseTree([p('call', 1, 9), p('answer', 5, 2, 'call'), p('wait', 1, 4, 'call'), p('tool', 12, 3)]);
    expect(tree.map((n) => [n.phase.id, n.children.map((c) => c.phase.id)])).toEqual([['call', ['wait', 'answer']], ['tool', []]]);
  });

  it('sums a turn up: its span, and the slowest phase with none of its own', () => {
    const s = phaseSummary([p('call', 0, 9), p('wait', 0, 7, 'call'), p('tool', 10, 5)]);
    expect(s).toMatchObject({ count: 3, ms: 15, slowest: { id: 'wait' } });
  });

  it('keeps a turn\'s phases in your latest message, after those of its runs before, to a limit', () => {
    const history: Message[] = [{ role: 'user', parts: [], phases: [p('old', 0, 1)] }, { role: 'assistant', parts: [] }];
    const kept = keepPhases(history, [p('new', 5, 1)]);
    expect(kept[0]!.phases!.map((x) => x.id)).toEqual(['old', 'new']);
    expect(keepPhases(history, [])).toBe(history);
    const many = Array.from({ length: MAX_KEPT_PHASES + 5 }, (_, i) => p(`n${i}`, i, 1));
    expect(keepPhases(history, many)[0]!.phases).toHaveLength(MAX_KEPT_PHASES);
  });

  it('shows the phases as they come and keeps them in your message when the turn ends', () => {
    const user: Message = { role: 'user', parts: [{ type: 'text', text: 'Hi' }] };
    let s = agentReducer(initialAgentState('c1'), { type: 'run', history: [user] });
    s = agentReducer(s, { type: 'event', event: { type: 'phase', phase: p('setup', 1) } });
    s = agentReducer(s, { type: 'event', event: { type: 'phase', phase: p('setup', 1, 20) } });
    expect(s.phases).toEqual([p('setup', 1, 20)]);
    s = agentReducer(s, { type: 'event', event: { type: 'message', message: { role: 'assistant', parts: [{ type: 'text', text: 'Hello' }] } } });
    s = agentReducer(s, { type: 'event', event: { type: 'done' } });
    expect(s.phases).toEqual([]);
    expect(s.history[0]!.phases).toEqual([p('setup', 1, 20)]);
    // After the turn, a late one changes nothing.
    expect(agentReducer(s, { type: 'event', event: { type: 'phase', phase: p('late', 9) } })).toBe(s);
  });

  it('says a duration in ms, seconds or minutes', () => {
    expect([phaseTime(340), phaseTime(1250), phaseTime(125_000)]).toEqual(['340 ms', '1.3 s', '2 min 5 s']);
  });
});

describe('the agent loop\'s phases', () => {
  it('records each model call with its wait, reasoning and answer, and each tool call with the wait for your confirmation', async () => {
    const tools = new ToolRegistry();
    tools.register({ name: 'browser.click', description: 'click', inputSchema: {}, source: 'browser', effect: 'write', run: async () => ({ type: 'text', text: 'clicked' }) });
    const provider = scripted([
      [{ type: 'reasoning-delta', text: 'Hmm' }, { type: 'reasoning-end' }, { type: 'tool-call', id: 'c1', name: 'browser__click', args: {} }, { type: 'done', stopReason: 'tool_calls' }],
      [{ type: 'text-delta', text: 'Done' }, { type: 'done', stopReason: 'stop' }],
    ]);
    let list: TurnPhase[] = [];
    const phases = phaseRecorder((ph) => (list = withPhase(list, ph)));
    const authorize = async () => ({ seen: { asked: 'allow' as const } });
    await collect(runAgentLoop([{ role: 'user', parts: [{ type: 'text', text: 'click' }] }], loop(provider, tools, { tools: { authorize }, hooks: { phases } }), new AbortController().signal));
    const tree = phaseTree(list).map((n) => [n.phase.label, n.phase.detail, n.children.map((c) => c.phase.label)]);
    expect(tree).toEqual([
      ['Model call 1', 'm', ['Waiting for the first token', 'Reasoning']],
      ['browser.click', undefined, ['Waiting for your confirmation']],
      ['Model call 2', 'm', ['Waiting for the first token', 'Answer']],
    ]);
    expect(list.every((ph) => ph.ms !== undefined)).toBe(true);
  });
});
