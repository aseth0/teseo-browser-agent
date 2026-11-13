import { describe, expect, it } from 'vitest';
import { agentReducer, initialAgentState, LOST_CONNECTION, type AgentState } from '../src/entrypoints/sidepanel/agent-state';
import type { BackgroundToPanel } from '../src/core/protocol';
import type { Compaction, Message } from '../src/core/types';
import { contextUsed } from '../src/context/usage';

const user: Message = { role: 'user', parts: [{ type: 'text', text: 'Hi' }] };
const event = (s: AgentState, e: BackgroundToPanel) => agentReducer(s, { type: 'event', event: e });

// A turn under way: streaming, a sub-agent, a card waiting, a status line, a notice.
function midTurn(): AgentState {
  let s = agentReducer(initialAgentState('c1'), { type: 'run', history: [user] });
  s = event(s, { type: 'status', text: 'Reading the page…' });
  s = event(s, { type: 'reasoning-delta', text: 'Think' });
  s = event(s, { type: 'reasoning-delta', text: 'ing' });
  s = event(s, { type: 'text-delta', text: 'Ans' });
  s = event(s, { type: 'notice', text: 'Cut' });
  s = event(s, { type: 'user-request', id: 'u1', request: { kind: 'ask', question: 'Which?' } as never });
  return event(s, { type: 'sub', callId: 'k1', agent: 'Helper', event: { type: 'text-delta', text: 'x' } } as BackgroundToPanel);
}

describe('agentReducer', () => {
  it('leaves the state as it is on an event this build does not know (a newer build)', () => {
    const s = midTurn();
    expect(event(s, { type: 'from-a-newer-build' } as unknown as BackgroundToPanel)).toBe(s);
  });

  it('keeps the streamed segments in arrival order, merging the same kind', () => {
    expect(midTurn().live).toEqual([{ kind: 'reasoning', text: 'Thinking' }, { kind: 'text', text: 'Ans' }]);
  });

  it('clears everything of the turn on a new conversation', () => {
    const s = agentReducer({ ...midTurn(), busy: false, error: 'Boom', stepLimit: 5 }, { type: 'load', conversationId: 'c2', history: [] });
    expect(s).toEqual(initialAgentState('c2'));
  });

  // Stop drops whatever the background sends after it: the results it sent before, as each call ended,
  // stay with their calls instead of "stopped".
  it('keeps the results of the calls that ended when the turn is stopped', () => {
    const calling: Message = { role: 'assistant', parts: [{ type: 'tool_call', id: 'a', name: 'browser__click', args: {} }, { type: 'tool_call', id: 'b', name: 'browser__click', args: {} }] };
    let s = agentReducer(initialAgentState('c1'), { type: 'run', history: [user] });
    s = event(s, { type: 'message', message: calling });
    s = event(s, { type: 'tool-result', result: { type: 'tool_result', toolCallId: 'a', content: 'clicked' } });
    s = agentReducer(s, { type: 'stop' });
    expect(s.history.at(-1)?.parts).toEqual([
      { type: 'tool_result', toolCallId: 'a', content: 'clicked' },
      expect.objectContaining({ toolCallId: 'b', isError: true }),
    ]);
    expect(s.results).toEqual([]);
  });

  it('forgets them once the step\'s results message comes', () => {
    let s = agentReducer(initialAgentState('c1'), { type: 'run', history: [user] });
    s = event(s, { type: 'tool-result', result: { type: 'tool_result', toolCallId: 'a', content: 'clicked' } });
    s = event(s, { type: 'message', message: { role: 'tool', parts: [{ type: 'tool_result', toolCallId: 'a', content: 'clicked' }] } });
    expect(s.results).toEqual([]);
  });

  it('starts a resumed run from scratch', () => {
    const s = event({ ...midTurn(), error: 'Boom' }, { type: 'resume', history: [user] } as BackgroundToPanel);
    expect(s).toMatchObject({ busy: true, live: [], subs: {}, confirmations: [], status: '', error: '', notices: [], stepLimit: null, history: [user] });
  });

  it('keeps what was streamed, marked as stopped, when stopped', () => {
    const s = agentReducer(midTurn(), { type: 'stop' });
    expect(s).toMatchObject({ busy: false, live: [], subs: {}, confirmations: [], status: '' });
    expect(s.history.length).toBeGreaterThan(1);
  });

  it('marks it interrupted when stopped to send a message at once', () => {
    expect(agentReducer(midTurn(), { type: 'stop', interrupted: true }).history.at(-1)).toMatchObject({ stopped: true, interrupted: true });
    expect(agentReducer(midTurn(), { type: 'stop' }).history.at(-1)).not.toHaveProperty('interrupted');
  });

  it('says the connection was lost only while a turn runs', () => {
    expect(agentReducer(midTurn(), { type: 'lost' })).toMatchObject({ busy: false, error: LOST_CONNECTION });
    const idle = initialAgentState('c1');
    expect(agentReducer(idle, { type: 'lost' })).toBe(idle);
  });

  it('ends the turn with the error, keeping the notices', () => {
    const s = event(midTurn(), { type: 'error', error: 'Boom' });
    expect(s).toMatchObject({ busy: false, error: 'Boom', notices: ['Cut'], live: [], confirmations: [] });
  });

  // A tool call without its result is rejected by the servers on every later request.
  const midTool = () => event(agentReducer(initialAgentState('c1'), { type: 'run', history: [user] }), { type: 'message', message: { role: 'assistant', parts: [{ type: 'text', text: 'Clicking' }, { type: 'tool_call', id: 't1', name: 'browser.click', args: {} }] } });
  it.each([
    ['the connection is lost', (s: AgentState) => agentReducer(s, { type: 'lost' })],
    ['an error ends the turn', (s: AgentState) => event(s, { type: 'error', error: 'Boom' })],
  ])('answers the tool calls left running when %s, marked as stopped', (_when, end) => {
    const s = end(midTool());
    expect(s.busy).toBe(false);
    expect(s.history.at(-1)).toMatchObject({ role: 'tool', stopped: true, parts: [{ type: 'tool_result', toolCallId: 't1', isError: true }] });
  });
  it('keeps what was streamed, marked as stopped, when the connection is lost', () => {
    const s = agentReducer(midTurn(), { type: 'lost' });
    expect(s.history.at(-1)).toMatchObject({ role: 'assistant', stopped: true, parts: [{ type: 'reasoning', text: 'Thinking' }, { type: 'text', text: 'Ans' }] });
  });
  it('leaves the history as it is on an error with nothing half done', () => {
    const s = agentReducer(initialAgentState('c1'), { type: 'run', history: [user] });
    expect(event(s, { type: 'error', error: 'Boom' }).history).toEqual([user]);
  });

  it('removes an answered card', () => {
    expect(agentReducer(midTurn(), { type: 'answered', id: 'u1' }).confirmations).toEqual([]);
  });

  it("shows a sub-agent's question to go on past its step limit as a card, until answered", () => {
    const s = event(midTurn(), { type: 'more-steps', id: 'm1', agent: 'Helper', steps: 30 });
    expect(s.confirmations.at(-1)).toEqual({ kind: 'more-steps', id: 'm1', agent: 'Helper', steps: 30 });
    expect(agentReducer(s, { type: 'answered', id: 'm1' }).confirmations.map((c) => c.id)).toEqual(['u1']);
  });

  it('takes a compacted history only for the conversation it was compacted from', () => {
    const compacted: Message[] = [{ role: 'user', parts: [{ type: 'text', text: 'Summary' }] }];
    const c1 = agentReducer(initialAgentState('c1'), { type: 'load', conversationId: 'c1', history: [user] });
    expect(agentReducer(c1, { type: 'history', conversationId: 'c1', history: compacted }).history).toBe(compacted);
    // Another conversation opened while the summary was being written.
    const c2 = agentReducer(c1, { type: 'load', conversationId: 'c2', history: [] });
    expect(agentReducer(c2, { type: 'history', conversationId: 'c1', history: compacted })).toBe(c2);
  });

  // The latest call says how full the context was before the compaction: the next message would
  // compact again, the meter still show it full.
  it('counts the context as the compaction left it, until the next call', () => {
    const answer: Message = { role: 'assistant', parts: [{ type: 'text', text: 'a'.repeat(40) }], meta: { input: 2000, output: 10, reported: true, ms: 1, sinceStartMs: 1 } };
    const c1 = agentReducer(initialAgentState('c1'), { type: 'load', conversationId: 'c1', history: [user, answer] });
    const compaction: Compaction = { at: 1, turns: 1, trimmed: { pages: true, toolResults: true, screenshots: true }, before: 1500, after: 300, ranAfter: 2 };
    const compacted = agentReducer(c1, { type: 'history', conversationId: 'c1', history: [user, { ...answer, compaction }], compaction });
    expect(contextUsed(compacted.usage.last!)).toBe(2010 - 1500 + 300);
    expect(compacted.usage).toMatchObject({ calls: 1, input: 2000, output: 10 }); // the totals are the calls'
    // Reopened: the same, as the compaction ran after the last call.
    const reopened = agentReducer(initialAgentState('c2'), { type: 'load', conversationId: 'c1', history: [user, { ...answer, compaction }] });
    expect(contextUsed(reopened.usage.last!)).toBe(2010 - 1500 + 300);
    // A call after it: that one says.
    const later: Message = { ...answer, meta: { ...answer.meta!, input: 900 } };
    const after = agentReducer(initialAgentState('c3'), { type: 'load', conversationId: 'c1', history: [user, { ...answer, compaction }, user, later] });
    expect(contextUsed(after.usage.last!)).toBe(910);
  });

  it('keeps compacting while a turn starts, until it is turned off', () => {
    const on = agentReducer(initialAgentState('c1'), { type: 'compacting', on: true });
    expect(agentReducer(on, { type: 'run', history: [user] }).compacting).toBe(true);
    expect(agentReducer(on, { type: 'compacting', on: false }).compacting).toBe(false);
  });

  it('reopens a conversation as full as its last call left it, without its reasoning', () => {
    const answer = (meta: Message['meta']): Message => ({ role: 'assistant', parts: [{ type: 'reasoning', text: 'r'.repeat(4000) }, { type: 'text', text: 'a'.repeat(40) }], meta });
    const used = (meta: Message['meta']) => contextUsed(agentReducer(initialAgentState('c1'), { type: 'load', conversationId: 'c1', history: [user, answer(meta)] }).usage.last!);
    const meta = { input: 2000, output: 1010, reported: true, ms: 1, sinceStartMs: 1 };
    expect(used({ ...meta, reasoning: 1000 })).toBe(2010); // as the server split it
    expect(used(meta)).toBe(2010); // the answer estimated from its parts (a saved call of an older build)
    expect(used({ ...meta, input: 2000, output: 1010, reported: false })).toBe(2010);
  });
});

describe('taking a plan away', () => {
  const planned: Message[] = [user, { role: 'assistant', parts: [{ type: 'tool_call', id: 'p1', name: 'user__plan', args: { steps: [{ title: 'A', status: 'pending' }] } }] }];
  const isClosed = (s: AgentState) => s.history[1]!.parts[0]!.type === 'tool_call' && s.history[1]!.parts[0]!.dismissed === true;

  it('marks it in the history, by hand and when a run taken over says so', () => {
    const open = agentReducer(initialAgentState('c1'), { type: 'load', conversationId: 'c1', history: planned });
    expect(isClosed(open)).toBe(false);
    expect(isClosed(agentReducer(open, { type: 'plan-dismissed', id: 'p1' }))).toBe(true);
    expect(isClosed(event(open, { type: 'plan-dismissed', id: 'p1' }))).toBe(true);
  });
});
