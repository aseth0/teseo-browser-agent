import { describe, expect, it, vi } from 'vitest';
import { runAgentLoop } from '../src/core/agent-loop';
import { AccessRequiredError, ToolsUnsupportedError, type ChatEvent, type ChatRequest, type LLMProvider, type Message, type Tool, type ToolContext } from '../src/core/types';
import { ToolRegistry, toWireName } from '../src/core/tool-registry';
import { coerceArgs } from '../src/core/tool-args';
import { parseArgs } from '../src/providers/tool-calls';
import { collect, loop, scripted } from './helpers';


const user: Message[] = [{ role: 'user', parts: [{ type: 'text', text: 'click login' }] }];

describe('toWireName', () => {
  it('sanitizes namespaced names for provider APIs', () => {
    expect(toWireName('browser.click')).toBe('browser__click');
    expect(toWireName('mcp.my server.do/it')).toBe('mcp__my_server__do_it');
  });
});

describe('runAgentLoop', () => {
  it('forces the mentioned tool only on the first call', async () => {
    const tools = new ToolRegistry();
    tools.register({ name: 'browser.find', description: 'find', inputSchema: {}, source: 'browser', effect: 'read', run: async () => ({ type: 'text', text: 'found' }) });
    const provider = scripted([
      [{ type: 'tool-call', id: 'c1', name: 'browser__find', args: {} }, { type: 'done', stopReason: 'tool_calls' }],
      [{ type: 'text-delta', text: 'Done' }, { type: 'done', stopReason: 'stop' }],
    ]);
    await collect(runAgentLoop(user, loop(provider, tools, { model: { toolChoice: 'browser__find' } }), new AbortController().signal));
    expect(provider.requests.map((r) => r.toolChoice)).toEqual(['browser__find', undefined]);
  });

  it('adds what the step reply matches after its last tool result, also in its content', async () => {
    const tools = new ToolRegistry();
    tools.register({ name: 'browser.find', description: 'find', inputSchema: {}, source: 'browser', effect: 'read', run: async () => ({ type: 'text', text: 'found' }) });
    const provider = scripted([
      [{ type: 'text-delta', text: 'Opening grafana' }, { type: 'tool-call', id: 'c1', name: 'browser__find', args: {} }, { type: 'done', stopReason: 'tool_calls' }],
      [{ type: 'tool-call', id: 'c2', name: 'browser__find', args: {} }, { type: 'done', stopReason: 'tool_calls' }],
      [{ type: 'text-delta', text: 'Done' }, { type: 'done', stopReason: 'stop' }],
    ]);
    const replies: string[] = [];
    const attachAfter = async (reply: string) => {
      replies.push(reply);
      return reply ? [{ kind: 'memory' as const, text: 'NOTE', source: 'memory-step:1' }] : [];
    };
    const events = await collect(runAgentLoop(user, loop(provider, tools, { context: { attachAfter } }), new AbortController().signal));
    expect(replies).toEqual(['Opening grafana', '']); // asked after every step, with or without text
    const results = events.flatMap((e) => (e.type === 'message' && e.message.role === 'tool' ? e.message.parts : []));
    expect(results[0]).toMatchObject({ content: 'found\n\nNOTE', attached: [{ kind: 'memory', text: 'NOTE', source: 'memory-step:1' }] });
    expect(results[1]).toMatchObject({ content: 'found' });
    expect(results[1]).not.toHaveProperty('attached');
  });

  it('goes on, and logs it, when what the step reply matches or the new tools cannot be read', async () => {
    const tools = new ToolRegistry();
    tools.register({ name: 'browser.find', description: 'find', inputSchema: {}, source: 'browser', effect: 'read', run: async () => ({ type: 'text', text: 'found' }) });
    const provider = scripted([
      [{ type: 'text-delta', text: 'Looking' }, { type: 'tool-call', id: 'c1', name: 'browser__find', args: {} }, { type: 'done', stopReason: 'tool_calls' }],
      [{ type: 'text-delta', text: 'Done' }, { type: 'done', stopReason: 'stop' }],
    ]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const attachAfter = () => Promise.reject(new Error('memory unreadable'));
    const refreshTools = () => Promise.reject(new Error('page gone wrong'));
    const events = await collect(runAgentLoop(user, loop(provider, tools, { context: { attachAfter }, tools: { refresh: refreshTools } }), new AbortController().signal));
    const results = events.flatMap((e) => (e.type === 'message' && e.message.role === 'tool' ? e.message.parts : []));
    expect(results[0]).toMatchObject({ content: 'found' });
    expect(provider.requests[1]!.tools?.map((t) => t.name)).toEqual(['browser__find']); // the ones offered stay
    expect(warn.mock.calls.map((c) => c[0])).toEqual(['[attach-after]', '[refresh-tools]']);
    warn.mockRestore();
  });

  it('records the tokens and the time of each model call in its message', async () => {
    const provider = scripted([[{ type: 'text-delta', text: 'Hi' }, { type: 'usage', inputTokens: 120, outputTokens: 7 }, { type: 'done', stopReason: 'stop' }]]);
    const startedAt = Date.now() - 500; // the page was read before the loop
    const events = await collect(runAgentLoop(user, loop(provider, new ToolRegistry(), { startedAt }), new AbortController().signal));
    const meta = events.find((e) => e.type === 'message')?.message.meta;
    expect(meta).toMatchObject({ input: 120, output: 7, reported: true });
    expect(meta).not.toHaveProperty('reasoning');
    expect(meta!.firstTokenMs).toBeLessThanOrEqual(meta!.ms);
    expect(meta!.sinceStartMs).toBeGreaterThanOrEqual(500);
  });

  it('keeps the reasoning tokens on the message when the server reports them apart', async () => {
    const provider = scripted([[{ type: 'reasoning-delta', text: 'Hmm' }, { type: 'text-delta', text: 'Hi' }, { type: 'usage', inputTokens: 120, outputTokens: 907, reasoningTokens: 900 }, { type: 'done', stopReason: 'stop' }]]);
    const events = await collect(runAgentLoop(user, loop(provider, new ToolRegistry()), new AbortController().signal));
    expect(events.find((e) => e.type === 'message')?.message.meta).toMatchObject({ input: 120, output: 907, reasoning: 900 });
  });

  it('keeps the cached input tokens on the message when the server reports them', async () => {
    const provider = scripted([[{ type: 'text-delta', text: 'Hi' }, { type: 'usage', inputTokens: 3000, outputTokens: 7, cachedTokens: 2500 }, { type: 'done', stopReason: 'stop' }]]);
    const events = await collect(runAgentLoop(user, loop(provider, new ToolRegistry()), new AbortController().signal));
    expect(events.find((e) => e.type === 'message')?.message.meta).toMatchObject({ input: 3000, output: 7, cached: 2500 });
  });

  it('runs tool calls and feeds results back until the model stops', async () => {
    const tools = new ToolRegistry();
    tools.register({
      name: 'browser.click', description: 'click', inputSchema: {}, source: 'browser', effect: 'write',
      run: async (args) => ({ type: 'text', text: `clicked ${(args as { ref: string }).ref}` }),
    });
    const provider = scripted([
      [{ type: 'tool-call', id: 'c1', name: 'browser__click', args: { ref: 'ref_8' } }, { type: 'done', stopReason: 'tool_calls' }],
      [{ type: 'text-delta', text: 'Done' }, { type: 'done', stopReason: 'stop' }],
    ]);

    const events = await collect(
      runAgentLoop(user, loop(provider, tools), new AbortController().signal),
    );

    const messages = events.filter((e) => e.type === 'message').map((e) => e.message);
    expect(messages.map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant']);
    expect(messages[1]!.parts[0]).toEqual({ type: 'tool_result', toolCallId: 'c1', content: 'clicked ref_8' });
    expect(provider.requests[1]!.messages).toHaveLength(3);
    expect(provider.requests[0]!.tools?.[0]!.name).toBe('browser__click');
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('offers and runs the tools a page has after a navigation in the same turn', async () => {
    let navigated = false;
    const tools = new ToolRegistry();
    tools.register({ name: 'browser.navigate', description: 'go', inputSchema: {}, source: 'browser', effect: 'write', run: async () => ((navigated = true), { type: 'text', text: 'Now on the shop' }) });
    const pageTool: Tool = { name: 'webmcp.add_to_cart', description: 'add', inputSchema: {}, source: 'webmcp', effect: 'write', run: async () => ({ type: 'text', text: 'added' }) };
    const refreshTools = vi.fn(async (current: ToolRegistry) => (navigated ? current.with([pageTool]) : undefined));
    const provider = scripted([
      [{ type: 'tool-call', id: 'c1', name: 'browser__navigate', args: {} }, { type: 'done', stopReason: 'tool_calls' }],
      [{ type: 'tool-call', id: 'c2', name: 'webmcp__add_to_cart', args: {} }, { type: 'done', stopReason: 'tool_calls' }],
      [{ type: 'text-delta', text: 'Done' }, { type: 'done', stopReason: 'stop' }],
    ]);
    const events = await collect(runAgentLoop(user, loop(provider, tools, { tools: { refresh: refreshTools } }), new AbortController().signal));
    const results = events.flatMap((e) => (e.type === 'message' && e.message.role === 'tool' ? e.message.parts : []));
    expect(results[1]).toMatchObject({ toolCallId: 'c2', content: 'added' });
    expect(provider.requests[0]!.tools?.map((t) => t.name)).toEqual(['browser__navigate']);
    expect(provider.requests[1]!.tools?.map((t) => t.name)).toEqual(['browser__navigate', 'webmcp__add_to_cart']);
    expect(refreshTools).toHaveBeenCalledTimes(2); // before each request after the first
  });

  it('builds the tool specs once while the registry stays the same', async () => {
    const tools = new ToolRegistry();
    tools.register({ name: 'browser.find', description: 'find', inputSchema: {}, source: 'browser', effect: 'read', run: async () => ({ type: 'text', text: 'found' }) });
    const specs = vi.spyOn(tools, 'specs');
    const provider = scripted([
      [{ type: 'tool-call', id: 'c1', name: 'browser__find', args: {} }, { type: 'done', stopReason: 'tool_calls' }],
      [{ type: 'tool-call', id: 'c2', name: 'browser__find', args: {} }, { type: 'done', stopReason: 'tool_calls' }],
      [{ type: 'text-delta', text: 'Done' }, { type: 'done', stopReason: 'stop' }],
    ]);
    await collect(runAgentLoop(user, loop(provider, tools, { tools: { refresh: async () => undefined } }), new AbortController().signal));
    expect(provider.requests.map((r) => r.tools?.map((t) => t.name))).toEqual([['browser__find'], ['browser__find'], ['browser__find']]);
    expect(specs).toHaveBeenCalledTimes(1);
  });

  it('reports unknown tools and thrown errors as tool errors instead of crashing', async () => {
    const tools = new ToolRegistry();
    tools.register({
      name: 'boom', description: '', inputSchema: {}, source: 'browser', effect: 'read',
      run: async () => { throw new Error('kaput'); },
    });
    const provider = scripted([
      [{ type: 'tool-call', id: 'a', name: 'nope', args: {} }, { type: 'tool-call', id: 'b', name: 'boom', args: {} }, { type: 'done', stopReason: 'x' }],
    ]);
    const events = await collect(runAgentLoop(user, loop(provider, tools), new AbortController().signal));
    const toolMsg = events.find((e) => e.type === 'message' && e.message.role === 'tool');
    expect(toolMsg && toolMsg.type === 'message' && toolMsg.message.parts).toEqual([
      { type: 'tool_result', toolCallId: 'a', content: 'Unknown tool: nope\nTools offered include: boom.', isError: true },
      { type: 'tool_result', toolCallId: 'b', content: 'kaput', isError: true },
    ]);
  });

  it('names the offered tools most like an unknown one, as the model calls them', async () => {
    const tools = new ToolRegistry();
    const tool = (name: string) => ({ name, description: '', inputSchema: {}, source: 'browser' as const, effect: 'read' as const, run: async () => ({ type: 'text' as const, text: 'ok' }) });
    for (const n of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) tools.register(tool(`mcp.docs.docs-${n}`));
    tools.register(tool('memory.search'));
    const provider = scripted([
      [{ type: 'tool-call', id: 'a', name: 'mcp__docs', args: {} }, { type: 'tool-call', id: 'b', name: 'Memory_search', args: {} }, { type: 'done', stopReason: 'x' }],
    ]);
    const events = await collect(runAgentLoop(user, loop(provider, tools), new AbortController().signal));
    const toolMsg = events.find((e) => e.type === 'message' && e.message.role === 'tool');
    expect(toolMsg && toolMsg.type === 'message' && toolMsg.message.parts.map((p) => p.type === 'tool_result' && p.content)).toEqual([
      'Unknown tool: mcp__docs\nDid you mean: mcp__docs__docs-a, mcp__docs__docs-b, mcp__docs__docs-c, mcp__docs__docs-d, mcp__docs__docs-e, and 2 more like it?',
      'Unknown tool: Memory_search\nDid you mean: memory__search?',
    ]);
  });

  it('stops after maxSteps', async () => {
    const tools = new ToolRegistry();
    tools.register({ name: 't', description: '', inputSchema: {}, source: 'browser', effect: 'read', run: async () => ({ type: 'text', text: 'ok' }) });
    const loopForever: LLMProvider = {
      listModels: async () => [],
      async *chat() { yield { type: 'tool-call', id: 'x', name: 't', args: {} }; yield { type: 'done', stopReason: 'tool' }; },
    };
    const events = await collect(runAgentLoop(user, loop(loopForever, tools, { maxSteps: 3 }), new AbortController().signal));
    expect(events.filter((e) => e.type === 'message' && e.message.role === 'assistant')).toHaveLength(3);
    expect(events.slice(-2)).toEqual([{ type: 'step-limit', steps: 3 }, { type: 'done' }]); // says so, to continue
  });

  it('does not report the step limit when the model answers in time', async () => {
    const events = await collect(runAgentLoop(user, loop(scripted([[{ type: 'text-delta', text: 'hi' }, { type: 'done', stopReason: 'end' }]]), new ToolRegistry(), { maxSteps: 1 }), new AbortController().signal));
    expect(events.some((e) => e.type === 'step-limit')).toBe(false);
  });
});

describe('runAgentLoop resilience', () => {
  it('runs none of the step\'s remaining tool calls once stopped', async () => {
    const stop = new AbortController();
    const ran: string[] = [];
    const tools = new ToolRegistry();
    for (const name of ['first', 'second'])
      tools.register({ name, description: '', inputSchema: {}, source: 'browser', effect: 'write', run: async () => {
        ran.push(name);
        if (name === 'first') stop.abort(); // the user presses Stop while it runs
        return { type: 'text', text: 'ok' };
      } });
    const provider = scripted([[{ type: 'tool-call', id: 'a', name: 'first', args: {} }, { type: 'tool-call', id: 'b', name: 'second', args: {} }, { type: 'done', stopReason: 'tool_calls' }]]);
    const events = await collect(runAgentLoop(user, loop(provider, tools), stop.signal));
    expect(ran).toEqual(['first']);
    expect(provider.requests).toHaveLength(1);
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  // Stop drops what the background sends after it: each result goes to the chat as its call ends, so
  // that the calls already done keep their results (core/messages markStopped).
  it('tells each result as its call ends, before the step\'s results message', async () => {
    const stop = new AbortController();
    const told: unknown[] = [];
    const tools = new ToolRegistry();
    for (const name of ['first', 'second', 'third'])
      tools.register({ name, description: '', inputSchema: {}, source: 'browser', effect: 'write', run: async () => {
        if (name === 'second') stop.abort();
        return { type: 'text', text: `${name} done` };
      } });
    const provider = scripted([[{ type: 'tool-call', id: 'a', name: 'first', args: {} }, { type: 'tool-call', id: 'b', name: 'second', args: {} }, { type: 'tool-call', id: 'c', name: 'third', args: {} }, { type: 'done', stopReason: 'tool_calls' }]]);
    const opts = loop(provider, tools);
    await collect(runAgentLoop(user, { ...opts, hooks: { ...opts.hooks, onResult: (r) => told.push(r) } }, stop.signal));
    expect(told).toEqual([
      expect.objectContaining({ type: 'tool_result', toolCallId: 'a', content: 'first done' }),
      expect.objectContaining({ type: 'tool_result', toolCallId: 'b', content: 'second done' }),
    ]);
  });

  it('retries without tools when the model rejects them', async () => {
    const tools = new ToolRegistry();
    tools.register({ name: 't', description: '', inputSchema: {}, source: 'browser', effect: 'read', run: async () => ({ type: 'text', text: 'ok' }) });
    const requests: ChatRequest[] = [];
    const provider: LLMProvider = {
      listModels: async () => [],
      async *chat(req) {
        requests.push(req);
        if (req.tools) throw new ToolsUnsupportedError('chat 400: {"error":"registry.ollama.ai/library/gemma does not support tools"}');
        yield { type: 'text-delta', text: 'no tools' };
        yield { type: 'done', stopReason: 'stop' };
      },
    };
    const events = await collect(runAgentLoop(user, loop(provider, tools), new AbortController().signal));
    expect(requests.map((r) => !!r.tools)).toEqual([true, false]);
    expect(events.some((e) => e.type === 'text-delta' && e.text === 'no tools')).toBe(true);
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('says it goes on without tools when the model cannot use them', async () => {
    const tools = new ToolRegistry();
    tools.register({ name: 't', description: '', inputSchema: {}, source: 'browser', effect: 'read', run: async () => ({ type: 'text', text: 'ok' }) });
    const provider: LLMProvider = {
      listModels: async () => [],
      async *chat(req) {
        if (req.tools) throw new ToolsUnsupportedError('chat 400: no tools');
        yield { type: 'done', stopReason: 'stop' };
      },
    };
    const events = await collect(runAgentLoop(user, loop(provider, tools), new AbortController().signal));
    expect(events).toContainEqual({ type: 'notice', text: 'm does not support tools: this turn goes on without them.' });
  });

  it.each([
    "chat 400: Invalid schema for function 'browser__find': 'query' is not valid",
    'chat 400: tool_call_id c1 does not match any tool call',
  ])('keeps the tools on other errors: %s', async (error) => {
    const tools = new ToolRegistry();
    tools.register({ name: 't', description: '', inputSchema: {}, source: 'browser', effect: 'read', run: async () => ({ type: 'text', text: 'ok' }) });
    const requests: ChatRequest[] = [];
    const provider: LLMProvider = {
      listModels: async () => [],
      async *chat(req) {
        requests.push(req);
        throw new Error(error);
      },
    };
    const events = await collect(runAgentLoop(user, loop(provider, tools), new AbortController().signal));
    expect(requests).toHaveLength(1);
    expect(events.at(-1)).toEqual({ type: 'error', error });
  });

  it('turns image tool results into images on the tool_result part', async () => {
    const tools = new ToolRegistry();
    tools.register({ name: 'shot', description: '', inputSchema: {}, source: 'browser', effect: 'read', run: async () => ({ type: 'image', mediaType: 'image/jpeg', data: 'AAAA' }) });
    const provider = scripted([[{ type: 'tool-call', id: 'i', name: 'shot', args: {} }, { type: 'done', stopReason: 't' }]]);
    const events = await collect(runAgentLoop(user, loop(provider, tools), new AbortController().signal));
    const toolMsg = events.find((e) => e.type === 'message' && e.message.role === 'tool');
    expect(toolMsg?.type === 'message' && toolMsg.message.parts[0]).toEqual({
      type: 'tool_result', toolCallId: 'i', content: '[screenshot attached]', images: [{ mediaType: 'image/jpeg', data: 'AAAA' }],
    });
  });
});

describe('runAgentLoop reasoning', () => {
  it('streams reasoning and stores it in order within the assistant message', async () => {
    const tools = new ToolRegistry();
    tools.register({ name: 'find', description: '', inputSchema: {}, source: 'browser', effect: 'read', run: async () => ({ type: 'text', text: 'ref_1' }) });
    const provider = scripted([
      [
        { type: 'reasoning-delta', text: 'I need ' },
        { type: 'reasoning-delta', text: 'the button' },
        { type: 'reasoning-end' },
        { type: 'tool-call', id: 'f', name: 'find', args: {} },
        { type: 'done', stopReason: 'tool_calls' },
      ],
      [
        { type: 'reasoning-delta', text: 'found it' },
        { type: 'reasoning-end' },
        { type: 'text-delta', text: 'It is ref_1' },
        { type: 'done', stopReason: 'stop' },
      ],
    ]);
    const events = await collect(runAgentLoop(user, loop(provider, tools), new AbortController().signal));
    expect(events.filter((e) => e.type === 'reasoning-delta').map((e) => e.type === 'reasoning-delta' && e.text)).toEqual(['I need ', 'the button', 'found it']);
    const assistants = events.flatMap((e) => (e.type === 'message' && e.message.role === 'assistant' ? [e.message.parts] : []));
    expect(assistants).toEqual([
      [{ type: 'reasoning', text: 'I need the button' }, { type: 'tool_call', id: 'f', name: 'find', args: {} }],
      [{ type: 'reasoning', text: 'found it' }, { type: 'text', text: 'It is ref_1' }],
    ]);
  });
});

describe('runAgentLoop authorization', () => {
  it('passes every call to the policy and never runs a refused one', async () => {
    const run = vi.fn(async () => ({ type: 'text' as const, text: 'clicked' }));
    const tools = new ToolRegistry();
    tools.register({ name: 'click', description: '', inputSchema: {}, source: 'browser', effect: 'write', run });
    tools.register({ name: 'read', description: '', inputSchema: {}, source: 'browser', effect: 'read', run: async () => ({ type: 'text', text: 'page' }) });
    // The policy itself lets reads on the panel's tab through (policy/engine): here it only refuses the click.
    const authorize = vi.fn(async (tool: { effect: string }) => (tool.effect === 'write' ? { refused: 'the user denied this action' } : {}));
    const provider = scripted([
      [{ type: 'tool-call', id: 'r', name: 'read', args: {} }, { type: 'tool-call', id: 'c', name: 'click', args: { ref: 'ref_1' } }, { type: 'done', stopReason: 't' }],
    ]);
    const events = await collect(runAgentLoop(user, loop(provider, tools, { tools: { authorize, context: { tabId: 7 } } }), new AbortController().signal));
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ name: 'click' }), { ref: 'ref_1' }, expect.objectContaining({ tabId: 7 }));
    expect(run).not.toHaveBeenCalled();
    const toolMsg = events.find((e) => e.type === 'message' && e.message.role === 'tool');
    expect(toolMsg?.type === 'message' && toolMsg.message.parts).toEqual([
      { type: 'tool_result', toolCallId: 'r', content: 'page' },
      { type: 'tool_result', toolCallId: 'c', content: 'Not executed: the user denied this action.', isError: true },
    ]);
  });

  it("puts the user's comment before the result of an allowed call, and keeps it for the chat", async () => {
    const tools = new ToolRegistry();
    tools.register({ name: 'click', description: '', inputSchema: {}, source: 'browser', effect: 'write', run: async () => ({ type: 'text', text: 'clicked' }) });
    const provider = scripted([[{ type: 'tool-call', id: 'c', name: 'click', args: {} }, { type: 'done', stopReason: 't' }]]);
    const authorize = async () => ({ comment: 'then open the first task' });
    const events = await collect(runAgentLoop(user, loop(provider, tools, { tools: { authorize }, maxSteps: 1 }), new AbortController().signal));
    const toolMsg = events.find((e) => e.type === 'message' && e.message.role === 'tool');
    expect(toolMsg?.type === 'message' && toolMsg.message.parts).toEqual([
      { type: 'tool_result', toolCallId: 'c', content: 'The user allowed this action and commented: "then open the first task"\n\nclicked', userComment: 'then open the first task' },
    ]);
  });

  it('runs a call with the arguments the user edited, telling the model what they changed before its comment', async () => {
    const run = vi.fn(async () => ({ type: 'text' as const, text: 'Saved.' }));
    const tools = new ToolRegistry();
    tools.register({ name: 'save', description: '', inputSchema: {}, source: 'skill', effect: 'write', run });
    const provider = scripted([[{ type: 'tool-call', id: 's', name: 'save', args: { description: 'Old' } }, { type: 'done', stopReason: 't' }]]);
    const authorize = async () => ({ args: { description: 'New' }, edited: [{ label: 'Description', diff: '− Old\n+ New' }], comment: 'thanks' });
    const events = await collect(runAgentLoop(user, loop(provider, tools, { tools: { authorize }, maxSteps: 1 }), new AbortController().signal));
    expect(run).toHaveBeenCalledWith({ description: 'New' }, expect.anything());
    const toolMsg = events.find((e) => e.type === 'message' && e.message.role === 'tool');
    expect(toolMsg?.type === 'message' && toolMsg.message.parts).toEqual([{
      type: 'tool_result', toolCallId: 's', userComment: 'thanks',
      content: 'The user allowed this action and commented: "thanks"\n\nThe user edited your proposal before allowing it, so what was saved is not what you sent. ' +
        'Each field they changed, as a line diff from yours (−) to theirs (+):\nDescription:\n− Old\n+ New\n\nSaved.',
    }]);
  });
});

describe('runAgentLoop approved sites', () => {
  it('runs a call with the site it was allowed on, to be checked again right before it acts', async () => {
    const run = vi.fn(async () => ({ type: 'text' as const, text: 'clicked' }));
    const tools = new ToolRegistry();
    tools.register({ name: 'click', description: '', inputSchema: {}, source: 'browser', effect: 'write', run });
    const provider = scripted([[{ type: 'tool-call', id: 'c', name: 'click', args: {} }, { type: 'done', stopReason: 't' }]]);
    const authorize = async () => ({ approvedHost: 'shop.test' });
    await collect(runAgentLoop(user, loop(provider, tools, { tools: { authorize }, maxSteps: 1 }), new AbortController().signal));
    expect(run).toHaveBeenCalledWith({}, expect.objectContaining({ approvedHost: 'shop.test' }));
  });
});

describe('runAgentLoop tool call ids', () => {
  it('makes ids unique across steps and turns so results match their call', async () => {
    const tools = new ToolRegistry();
    tools.register({ name: 't', description: '', inputSchema: {}, source: 'browser', effect: 'read', run: async () => ({ type: 'text', text: 'ok' }) });
    // Earlier turn already used "call_0"; the server keeps numbering from 0 on every response.
    const history: Message[] = [
      ...user,
      { role: 'assistant', parts: [{ type: 'tool_call', id: 'call_0', name: 't', args: {} }] },
      { role: 'tool', parts: [{ type: 'tool_result', toolCallId: 'call_0', content: 'ok' }] },
      { role: 'user', parts: [{ type: 'text', text: 'again' }] },
    ];
    const step = (): ChatEvent[] => [{ type: 'tool-call', id: 'call_0', name: 't', args: {} }, { type: 'done', stopReason: 't' }];
    const provider = scripted([step(), step(), [{ type: 'done', stopReason: 'stop' }]]);
    const events = await collect(runAgentLoop(history, loop(provider, tools), new AbortController().signal));
    const ids = events.flatMap((e) => (e.type === 'message' ? e.message.parts : [])).flatMap((p) =>
      p.type === 'tool_call' ? [`call:${p.id}`] : p.type === 'tool_result' ? [`result:${p.toolCallId}`] : [],
    );
    expect(ids).toEqual(['call:call_0_2', 'result:call_0_2', 'call:call_0_3', 'result:call_0_3']);
  });
});

describe('runAgentLoop authorization', () => {
  it('lets the policy judge read tools too (a read on another tab may need the user)', async () => {
    const run = vi.fn(async () => ({ type: 'text' as const, text: 'read' }));
    const authorize = vi.fn(async () => ({ refused: 'the user denied this action' }));
    const tools = new ToolRegistry();
    tools.register({ name: 'read_page', description: '', inputSchema: { type: 'object' }, source: 'browser', effect: 'read', run });
    const provider = scripted([[{ type: 'tool-call', id: 'c', name: 'read_page', args: { tabId: 2 } }, { type: 'done', stopReason: 't' }]]);
    await collect(runAgentLoop(user, loop(provider, tools, { tools: { authorize, context: { tabId: 1 } } }), new AbortController().signal));
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ name: 'read_page' }), { tabId: 2 }, expect.objectContaining({ tabId: 1 }));
    expect(run).not.toHaveBeenCalled();
  });
});

describe('runAgentLoop argument validation', () => {
  it('rejects calls missing required arguments without running or authorizing them', async () => {
    const run = vi.fn(async () => ({ type: 'text' as const, text: 'clicked' }));
    const authorize = vi.fn(async () => ({}));
    const tools = new ToolRegistry();
    tools.register({ name: 'click', description: '', inputSchema: { type: 'object', required: ['ref'] }, source: 'browser', effect: 'write', run });
    const provider = scripted([[{ type: 'tool-call', id: 'c', name: 'click', args: { tabId: 3 } }, { type: 'done', stopReason: 't' }]]);
    const events = await collect(runAgentLoop(user, loop(provider, tools, { tools: { authorize } }), new AbortController().signal));
    const toolMsg = events.find((e) => e.type === 'message' && e.message.role === 'tool');
    expect(toolMsg?.type === 'message' && toolMsg.message.parts[0]).toEqual({
      type: 'tool_result', toolCallId: 'c', content: 'Missing required argument(s): ref', isError: true,
    });
    expect(run).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
  });
  it('says a call arrived with no arguments at all, apart from one that leaves some out', async () => {
    const run = vi.fn(async () => ({ type: 'text' as const, text: 'clicked' }));
    const tools = new ToolRegistry();
    tools.register({ name: 'click', description: '', inputSchema: { type: 'object', required: ['ref'] }, source: 'browser', effect: 'write', run });
    const provider = scripted([[{ type: 'tool-call', id: 'c', name: 'click', args: {} }, { type: 'done', stopReason: 't' }]]);
    const events = await collect(runAgentLoop(user, loop(provider, tools), new AbortController().signal));
    const toolMsg = events.find((e) => e.type === 'message' && e.message.role === 'tool');
    const result = toolMsg?.type === 'message' ? toolMsg.message.parts[0] : undefined;
    expect(result).toMatchObject({ type: 'tool_result', toolCallId: 'c', isError: true });
    const content = result?.type === 'tool_result' ? result.content : '';
    expect(content).toContain('arrived with no arguments at all');
    expect(content).toContain('requires ref');
    expect(content).toContain('smaller calls');
    expect(run).not.toHaveBeenCalled();
  });
  it('never runs a call whose arguments are not JSON, and says where they fail to parse', async () => {
    const run = vi.fn(async () => ({ type: 'text' as const, text: 'typed' }));
    const authorize = vi.fn(async () => ({}));
    const tools = new ToolRegistry();
    tools.register({ name: 'type', description: '', inputSchema: { type: 'object', properties: { text: { type: 'string' } } }, source: 'browser', effect: 'write', run });
    const args = parseArgs(`{"text": "${'a'.repeat(300)}" "x": 1}`);
    const provider = scripted([[{ type: 'tool-call', id: 'c', name: 'type', args }, { type: 'done', stopReason: 't' }]]);
    const events = await collect(runAgentLoop(user, loop(provider, tools, { tools: { authorize } }), new AbortController().signal));
    const toolMsg = events.find((e) => e.type === 'message' && e.message.role === 'tool');
    const result = toolMsg?.type === 'message' ? toolMsg.message.parts[0] : undefined;
    const content = result?.type === 'tool_result' ? result.content : '';
    expect(content).toContain('not valid JSON');
    expect(content).toContain(`«{"text": "${'a'.repeat(190)}…»`); // its first 200 characters
    expect(content).toMatch(/Around where parsing failed: «…a+" "x": 1}…»/);
    expect(content).toContain('Send the call again');
    expect(run).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
  });
  it("says what to do for a missing argument the tool has a hint for (browser.type's ref)", async () => {
    const { writeTools } = await import('../src/tools/browser/write-tools');
    const tools = new ToolRegistry();
    tools.register(writeTools().find((t) => t.name === 'browser.type')!);
    const provider = scripted([[{ type: 'tool-call', id: 'c', name: 'browser__type', args: { text: 'hi' } }, { type: 'done', stopReason: 't' }]]);
    const events = await collect(runAgentLoop(user, loop(provider, tools, { tools: { authorize: async () => ({}) } }), new AbortController().signal));
    const toolMsg = events.find((e) => e.type === 'message' && e.message.role === 'tool');
    expect(toolMsg?.type === 'message' && toolMsg.message.parts[0]).toMatchObject({
      content: 'Missing required argument(s): ref\n- ref: the element\'s ref ("ref_k3x_12") comes from the page as it is now: read it (browser__read_page) or find the field (browser__find) first; after a navigation, the refs from before are gone.',
      isError: true,
    });
  });
  it('gives the hints of the required arguments with a call that arrived with none', async () => {
    const { writeTools } = await import('../src/tools/browser/write-tools');
    const tools = new ToolRegistry();
    tools.register(writeTools().find((t) => t.name === 'browser.type')!);
    const provider = scripted([[{ type: 'tool-call', id: 'c', name: 'browser__type', args: {} }, { type: 'done', stopReason: 't' }]]);
    const events = await collect(runAgentLoop(user, loop(provider, tools, { tools: { authorize: async () => ({}) } }), new AbortController().signal));
    const toolMsg = events.find((e) => e.type === 'message' && e.message.role === 'tool');
    const content = toolMsg?.type === 'message' && toolMsg.message.parts[0]?.type === 'tool_result' ? toolMsg.message.parts[0].content : '';
    expect(content).toContain('arrived with no arguments at all');
    expect(content).toContain('\n- ref: the element\'s ref ("ref_k3x_12") comes from the page as it is now');
  });
  it('reads an object or a list sent as its JSON text, for the policy and the run alike', async () => {
    const run = vi.fn(async () => ({ type: 'text' as const, text: 'saved' }));
    const authorize = vi.fn(async () => ({}));
    const tools = new ToolRegistry();
    const inputSchema = { type: 'object', properties: { views: { type: 'array' }, sites: { type: 'object' } }, required: ['views'] };
    tools.register({ name: 'save', description: '', inputSchema, source: 'template', effect: 'write', run });
    const provider = scripted([[{ type: 'tool-call', id: 'c', name: 'save', args: { views: '[{"name": "main"}]', sites: '{"shop.test": "ask"}' } }, { type: 'done', stopReason: 't' }]]);
    await collect(runAgentLoop(user, loop(provider, tools, { tools: { authorize } }), new AbortController().signal));
    const read = { views: [{ name: 'main' }], sites: { 'shop.test': 'ask' } };
    expect(authorize).toHaveBeenCalledWith(expect.anything(), read, expect.anything());
    expect(run).toHaveBeenCalledWith(read, expect.anything());
  });
});

describe('coerceArgs', () => {
  const schema = {
    type: 'object',
    properties: { list: { type: 'array' }, obj: { type: ['object', 'null'] }, text: { type: 'string' }, either: { type: ['string', 'array'] }, any: { anyOf: [{ type: 'array' }] } },
  };
  it('reads a JSON text into the kind its schema declares', () => {
    expect(coerceArgs(schema, { list: '["a", "b"]', obj: '{"a": 1}' })).toEqual({ list: ['a', 'b'], obj: { a: 1 } });
  });
  it('leaves text that is not JSON, or not that kind, as it came', () => {
    expect(coerceArgs(schema, { list: 'a, b', obj: '[1]' })).toEqual({ list: 'a, b', obj: '[1]' });
    expect(coerceArgs(schema, { list: '{"a": 1}' })).toEqual({ list: '{"a": 1}' });
  });
  it('never touches a property that may be text, an anyOf, or one the schema does not name', () => {
    const args = { text: '["a"]', either: '["a"]', any: '["a"]', other: '["a"]' };
    expect(coerceArgs(schema, args)).toBe(args);
  });
  it('gives back the same arguments when nothing is read, and a copy otherwise', () => {
    const args = { list: ['a'] };
    expect(coerceArgs(schema, args)).toBe(args);
    const given = { list: '["a"]' };
    coerceArgs(schema, given);
    expect(given).toEqual({ list: '["a"]' });
    expect(coerceArgs({ type: 'object' }, 'raw')).toBe('raw');
  });
});

describe('ToolRegistry.without', () => {
  it('offers every tool except the disabled ones, by dotted name', () => {
    const tools = new ToolRegistry();
    for (const name of ['browser.find', 'browser.click', 'browser.read_page']) {
      tools.register({ name, description: '', inputSchema: {}, source: 'browser', effect: 'read', run: async () => ({ type: 'text', text: '' }) });
    }
    const offered = tools.without(['browser.find']);
    expect(offered.specs().map((s) => s.name)).toEqual(['browser__click', 'browser__read_page']);
    expect(offered.get('browser__find')).toBeUndefined();
    expect(tools.list()).toHaveLength(3); // the full catalog is untouched
  });
});

describe('runAgentLoop site access', () => {
  const access = { origin: 'https://mail.example/*', site: 'mail.example', title: 'Inbox' };
  const tools = () => {
    const t = new ToolRegistry();
    let calls = 0;
    t.register({
      name: 'read', description: '', inputSchema: {}, source: 'browser', effect: 'read',
      run: async () => {
        if (calls++ === 0) throw new AccessRequiredError(access, 'No permission to read the tab "Inbox" (mail.example)');
        return { type: 'text', text: 'page' };
      },
    });
    return t;
  };
  const script = () => scripted([[{ type: 'tool-call', id: 'r', name: 'read', args: {} }, { type: 'done', stopReason: 't' }]]);
  const resultOf = (events: unknown[]) =>
    (events as { type: string; message?: Message }[]).find((e) => e.type === 'message' && e.message!.role === 'tool')!.message!.parts[0];

  it('asks for the permission a tool needs and runs it again when granted', async () => {
    const requestAccess = vi.fn(async () => true);
    const events = await collect(runAgentLoop(user, loop(script(), tools(), { tools: { requestAccess } }), new AbortController().signal));
    expect(requestAccess).toHaveBeenCalledWith(access);
    expect(resultOf(events)).toMatchObject({ content: 'page' });
  });

  it('asks too when describing the call needs the site (a tool that tries it first)', async () => {
    const t = new ToolRegistry();
    let tries = 0;
    t.register({
      name: 'save', description: '', inputSchema: {}, source: 'custom', effect: 'write', alwaysAsk: true,
      describe: async () => {
        if (tries++ === 0) throw new AccessRequiredError(access, 'No permission');
        return { summary: 'Save it' };
      },
      run: async () => ({ type: 'text', text: 'saved' }),
    });
    const requestAccess = vi.fn(async () => true);
    const authorize = async (tool: Tool, args: unknown, ctx: ToolContext) => (await tool.describe!(args, ctx), {});
    const provider = scripted([[{ type: 'tool-call', id: 's', name: 'save', args: {} }, { type: 'done', stopReason: 't' }]]);
    const events = await collect(runAgentLoop(user, loop(provider, t, { tools: { requestAccess, authorize } }), new AbortController().signal));
    expect(requestAccess).toHaveBeenCalledWith(access);
    expect(resultOf(events)).toMatchObject({ content: 'saved' });
  });

  it('reports which tab could not be read when the user denies it', async () => {
    const events = await collect(runAgentLoop(user, loop(script(), tools(), { tools: { requestAccess: async () => false } }), new AbortController().signal));
    expect(resultOf(events)).toMatchObject({ isError: true, content: 'No permission to read the tab "Inbox" (mail.example)' });
  });
});

describe('runAgentLoop with a tool that runs others', () => {
  it('runs them from stepTools, each as its own call under the caller, shows its steps, and says the tab named', async () => {
    const helper: Tool = { name: 'helper.read', description: 'h', inputSchema: {}, source: 'browser', effect: 'read', run: vi.fn(async (args: unknown) => ({ type: 'text' as const, text: `read ${JSON.stringify(args)}` })) };
    const ids: (string | undefined)[] = [];
    const logged = { ...helper, run: async (args: unknown, ctx: ToolContext) => (ids.push(ctx.callId), helper.run(args, ctx)) };
    const runner: Tool = {
      name: 'script.run', description: 's', inputSchema: {}, source: 'custom', effect: 'read',
      run: async (_args, ctx) => {
        const a = await ctx.callTool!('helper.read', { n: 1 });
        const b = await ctx.callTool!('helper.read', { n: 2 });
        ctx.emit!('step', { role: 'assistant', parts: [{ type: 'text', text: 'between' }] });
        return { type: 'text', text: `${a.content} / ${b.content}` };
      },
    };
    const offered = new ToolRegistry();
    offered.register(runner); // helper.read is not offered to the model
    const all = new ToolRegistry();
    all.register(runner);
    all.register(logged);
    const subs: [string, string][] = [];
    const provider = scripted([[{ type: 'tool-call', id: 'r', name: 'script__run', args: { tabId: 4 } }, { type: 'done', stopReason: 'tool_calls' }]]);
    const events = await collect(runAgentLoop(user, loop(provider, offered, { tools: { stepTools: all }, hooks: { onSub: (callId, label) => subs.push([callId, label]), tabOf: async (id) => ({ id, title: 'Shop', url: 'https://shop.test/' }) } }), new AbortController().signal));
    expect(ids).toEqual(['r.1', 'r.2']);
    expect(subs).toEqual([['r', 'step']]);
    const result = events.flatMap((e) => (e.type === 'message' && e.message.role === 'tool' ? e.message.parts : []))[0];
    expect(result).toMatchObject({ type: 'tool_result', toolCallId: 'r', content: 'read {"n":1} / read {"n":2}', tab: { id: 4, title: 'Shop' } });
  });
});

describe('runAgentLoop and the tab a call names', () => {
  it('says that tab also when the model wrote its id as text', async () => {
    const t = new ToolRegistry();
    t.register({ name: 'page.read', description: 'r', inputSchema: {}, source: 'browser', effect: 'read', run: async () => ({ type: 'text', text: 'ok' }) });
    const provider = scripted([[{ type: 'tool-call', id: 'r', name: 'page__read', args: { tabId: '4' } }, { type: 'done', stopReason: 'tool_calls' }]]);
    const tabOf = vi.fn(async (id: number) => ({ id, title: 'Shop', url: 'https://shop.test/' }));
    const events = await collect(runAgentLoop(user, loop(provider, t, { hooks: { tabOf } }), new AbortController().signal));
    expect(tabOf).toHaveBeenCalledWith(4);
    const result = events.flatMap((e) => (e.type === 'message' && e.message.role === 'tool' ? e.message.parts : []))[0];
    expect(result).toMatchObject({ content: 'ok', tab: { id: 4 } });
  });
});
