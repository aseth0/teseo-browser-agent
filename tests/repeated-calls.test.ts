import { describe, expect, it, vi } from 'vitest';
import { runAgentLoop, type LoopEvent } from '../src/core/agent-loop';
import { callKey, failuresInTurn } from '../src/core/repeated-calls';
import { ToolRegistry } from '../src/core/tool-registry';
import type { ChatEvent, Message } from '../src/core/types';
import { collect, loop, scripted } from './helpers';

const user: Message[] = [{ role: 'user', parts: [{ type: 'text', text: 'click login' }] }];
const call = (id: string, args: unknown): ChatEvent[] => [{ type: 'tool-call', id, name: 'click', args }, { type: 'done', stopReason: 'tool_calls' }];
const resultsOf = (events: LoopEvent[]) => events.flatMap((e) => (e.type === 'message' && e.message.role === 'tool' ? e.message.parts : []));

describe('callKey', () => {
  it('is the same whatever the order of the keys', () => {
    expect(callKey('click', { a: 1, b: { c: 2, d: [1] } })).toBe(callKey('click', { b: { d: [1], c: 2 }, a: 1 }));
    expect(callKey('click', { a: 1 })).not.toBe(callKey('click', { a: 2 }));
  });
});

describe('failuresInTurn', () => {
  it('counts the failed calls after your last message only', () => {
    const failing = (id: string): Message[] => [
      { role: 'assistant', parts: [{ type: 'tool_call', id, name: 'click', args: { ref: 'e1' } }] },
      { role: 'tool', parts: [{ type: 'tool_result', toolCallId: id, content: 'not found', isError: true }] },
    ];
    const history = [...user, ...failing('a'), ...user, ...failing('b'), ...failing('c')];
    expect(failuresInTurn(history).get(callKey('click', { ref: 'e1' }))).toBe(2);
  });
});

describe('runAgentLoop repeated failures', () => {
  it('says so on the second failure of the same call and does not run a third', async () => {
    const run = vi.fn(async () => ({ type: 'text' as const, text: 'Element not found', isError: true }));
    const log = vi.fn();
    const tools = new ToolRegistry();
    tools.register({ name: 'click', description: '', inputSchema: {}, source: 'browser', effect: 'read', run });
    const provider = scripted([call('c1', { ref: 'e1' }), call('c2', { ref: 'e1' }), call('c3', { ref: 'e1' }), call('c4', { ref: 'e2' }), [{ type: 'done', stopReason: 'stop' }]]);
    const results = resultsOf(await collect(runAgentLoop(user, loop(provider, tools, { hooks: { log } }), new AbortController().signal)));
    expect(results.map((r) => r.type === 'tool_result' && r.content)).toEqual([
      'Element not found',
      expect.stringMatching(/^Element not found\n\nThis exact call .* already failed earlier in this turn/),
      expect.stringMatching(/^Not run: this exact call .* already failed twice/),
      'Element not found', // other arguments: a call of its own
    ]);
    expect(run).toHaveBeenCalledTimes(3);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ tool: 'click', refused: 'repeated failing call' }));
  });

  it('lets the model call no tool once it sends again a call that was not run', async () => {
    const tools = new ToolRegistry();
    tools.register({ name: 'click', description: '', inputSchema: {}, source: 'browser', effect: 'read', run: async () => ({ type: 'text' as const, text: 'Element not found', isError: true }) });
    const provider = scripted([call('c1', {}), call('c2', {}), call('c3', {}), call('c4', {}), [{ type: 'text-delta', text: 'It cannot be clicked.' }, { type: 'done', stopReason: 'stop' }]]);
    await collect(runAgentLoop(user, loop(provider, tools), new AbortController().signal));
    expect(provider.requests.map((r) => [r.toolChoice, r.tools?.length])).toEqual([[undefined, 1], [undefined, 1], [undefined, 1], [undefined, 1], ['none', 1]]);
  });

  it('sends no tools after a request that let the model call none still got calls', async () => {
    const tools = new ToolRegistry();
    tools.register({ name: 'click', description: '', inputSchema: {}, source: 'browser', effect: 'read', run: async () => ({ type: 'text' as const, text: 'Element not found', isError: true }) });
    const provider = scripted([call('c1', {}), call('c2', {}), call('c3', {}), call('c4', {}), call('c5', {}), [{ type: 'done', stopReason: 'stop' }]]);
    await collect(runAgentLoop(user, loop(provider, tools), new AbortController().signal));
    expect(provider.requests.slice(4).map((r) => [r.toolChoice, r.tools?.length])).toEqual([['none', 1], [undefined, undefined]]);
  });

  it('does not count a call that worked', async () => {
    const run = vi.fn(async () => ({ type: 'text' as const, text: 'clicked' }));
    const tools = new ToolRegistry();
    tools.register({ name: 'click', description: '', inputSchema: {}, source: 'browser', effect: 'read', run });
    const provider = scripted([call('c1', {}), call('c2', {}), call('c3', {}), [{ type: 'done', stopReason: 'stop' }]]);
    const results = resultsOf(await collect(runAgentLoop(user, loop(provider, tools), new AbortController().signal)));
    expect(results.map((r) => r.type === 'tool_result' && r.content)).toEqual(['clicked', 'clicked', 'clicked']);
  });
});

describe('runAgentLoop invalid arguments', () => {
  it('says every problem with what to fix, without running or authorizing the call', async () => {
    const run = vi.fn(async () => ({ type: 'text' as const, text: 'scrolled' }));
    const authorize = vi.fn(async () => ({}));
    const tools = new ToolRegistry();
    const inputSchema = { type: 'object', properties: { direction: { type: 'string', enum: ['up', 'down'] }, amount: { type: 'number' } }, required: ['direction', 'ref'] };
    tools.register({ name: 'scroll', description: '', inputSchema, source: 'browser', effect: 'write', run });
    const provider = scripted([[{ type: 'tool-call', id: 'c', name: 'scroll', args: { direction: 'sideways', amount: '3' } }, { type: 'done', stopReason: 't' }], [{ type: 'done', stopReason: 'stop' }]]);
    const results = resultsOf(await collect(runAgentLoop(user, loop(provider, tools, { tools: { authorize } }), new AbortController().signal)));
    expect(results[0]).toMatchObject({
      isError: true,
      content: 'Invalid argument(s), so nothing was run:\n- ref: required, left out\n- direction: "sideways" is not one of up, down\nCall it again with them fixed.',
    });
    expect(run).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
  });

  it('runs a call whose arguments only needed reading', async () => {
    const run = vi.fn(async () => ({ type: 'text' as const, text: 'scrolled' }));
    const tools = new ToolRegistry();
    const inputSchema = { type: 'object', properties: { direction: { type: 'string', enum: ['up', 'down'] }, amount: { type: 'number' } } };
    tools.register({ name: 'scroll', description: '', inputSchema, source: 'browser', effect: 'read', run });
    const provider = scripted([[{ type: 'tool-call', id: 'c', name: 'scroll', args: { direction: 'Down', amount: '3' } }, { type: 'done', stopReason: 't' }], [{ type: 'done', stopReason: 'stop' }]]);
    await collect(runAgentLoop(user, loop(provider, tools), new AbortController().signal));
    expect(run).toHaveBeenCalledWith({ direction: 'down', amount: 3 }, expect.anything());
  });
});
