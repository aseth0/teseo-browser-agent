import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolsUnsupportedError, type ChatEvent, type Message } from '../src/core/types';
import { originPattern } from '../src/page/permissions';
import { humanizeError, testConnection } from '../src/providers/connection-test';
import { buildHeaders, headerValues } from '../src/providers/headers';
import { OpenAICompatProvider } from '../src/providers/openai-compat';
import { toOpenAIMessages } from '../src/providers/wire';
import { reasoningFromFields, ThinkTagSplitter } from '../src/providers/reasoning';
import { resolveThinkingParam, thinkingBody, thinkingLevels } from '../src/providers/thinking';
import { parseSSE } from '../src/providers/sse';
import { collect, sseResponse } from './helpers';
import { mockFetch } from './fakes/browser';

const signal = new AbortController().signal;
afterEach(() => vi.unstubAllGlobals());

const d = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
const delta = (x: Record<string, unknown>, finish?: string) => d({ choices: [{ delta: x, ...(finish && { finish_reason: finish }) }] });

const history: Message[] = [
  { role: 'user', parts: [{ type: 'text', text: 'hi' }] },
  {
    role: 'assistant',
    parts: [
      { type: 'reasoning', text: 'let me look' },
      { type: 'text', text: 'looking' },
      { type: 'tool_call', id: 't1', name: 'browser__read_page', args: {} },
    ],
  },
  { role: 'tool', parts: [{ type: 'tool_result', toolCallId: 't1', content: 'tree' }] },
  { role: 'user', parts: [{ type: 'text', text: 'go on' }, { type: 'text', text: '<untrusted_page_content/>', context: 'page' }] },
];

function provider(body: string[] | Response, cfg: Partial<ConstructorParameters<typeof OpenAICompatProvider>[0]> = {}) {
  const fetchMock = mockFetch(Array.isArray(body) ? sseResponse(body) : body);
  return { p: new OpenAICompatProvider({ baseURL: 'https://gw.test/v1', apiKey: 'k', ...cfg }), fetchMock };
}

// A turn in progress: your message, then an answer that thought and called a tool, and its result.
const inLoop: Message[] = [
  ...history,
  { role: 'assistant', parts: [{ type: 'reasoning', text: 'the tree has a ' }, { type: 'reasoning', text: 'search box' }, { type: 'tool_call', id: 't2', name: 'browser__type', args: { ref: 'e3' } }] },
  { role: 'tool', parts: [{ type: 'tool_result', toolCallId: 't2', content: 'typed' }] },
];

describe('parseSSE', () => {
  it('reassembles events split across chunks, ignores comments, joins multi-line data', async () => {
    const res = sseResponse([': ping\n\n', 'event: a\ndata: 1\n\n', 'data: x\ndata: y\r\n\r\n'], 3);
    expect(await collect(parseSSE(res.body!))).toEqual([{ event: 'a', data: '1' }, { event: undefined, data: 'x\ny' }]);
  });
});

describe('toOpenAIMessages', () => {
  it("sends back the reasoning of the answers since your last message, not of older ones", () => {
    const out = toOpenAIMessages(undefined, inLoop);
    expect(out.filter((m) => m.role === 'assistant').map((m) => m.reasoning)).toEqual([undefined, 'the tree has a search box']);
    expect(toOpenAIMessages(undefined, inLoop, { reasoning: false }).some((m) => m.reasoning)).toBe(false);
  });

  it('translates tool calls/results, keeps hidden context and drops reasoning', () => {
    expect(toOpenAIMessages('sys', history)).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: 'looking',
        tool_calls: [{ id: 't1', type: 'function', function: { name: 'browser__read_page', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 't1', content: 'tree' },
      { role: 'user', content: 'go on\n<untrusted_page_content/>' },
    ]);
  });

  it('sends tool-result images in a follow-up user message', () => {
    const out = toOpenAIMessages(undefined, [
      { role: 'assistant', parts: [{ type: 'tool_call', id: 's', name: 'browser__screenshot', args: {} }] },
      { role: 'tool', parts: [{ type: 'tool_result', toolCallId: 's', content: '[screenshot attached]', images: [{ mediaType: 'image/jpeg', data: 'QQ==' }] }] },
    ]) as { role: string; content: unknown }[];
    expect(out.map((m) => m.role)).toEqual(['assistant', 'tool', 'user']);
    expect(JSON.stringify(out[2]!.content)).toContain('data:image/jpeg;base64,QQ==');
  });
});

describe('OpenAICompatProvider.chat', () => {
  it('skips data lines that are not JSON (a proxy keep-alive) instead of failing the turn', async () => {
    const { p } = provider([delta({ content: 'He' }), 'data: keep-alive\n\n', delta({ content: 'llo' }, 'stop'), 'data: [DONE]\n\n']);
    const events = await collect(p.chat({ model: 'm', messages: history }, signal));
    expect(events.filter((e) => e.type === 'text-delta').map((e) => e.type === 'text-delta' && e.text)).toEqual(['He', 'llo']);
  });

  it('streams text and accumulates fragmented tool calls', async () => {
    const { p, fetchMock } = provider([
      delta({ content: 'He' }),
      delta({ content: 'llo' }),
      delta({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'browser__click', arguments: '{"re' } }] }),
      delta({ tool_calls: [{ index: 0, function: { arguments: 'f":"ref_3"}' } }] }, 'tool_calls'),
      'data: [DONE]\n\n',
    ]);
    const events = await collect(p.chat({ model: 'm', messages: history, tools: [{ name: 'browser__click', description: 'd', inputSchema: {} }] }, signal));
    expect(events).toEqual([
      { type: 'text-delta', text: 'He' },
      { type: 'text-delta', text: 'llo' },
      { type: 'tool-call', id: 'c1', name: 'browser__click', args: { ref: 'ref_3' } },
      { type: 'done', stopReason: 'tool_calls' },
    ]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://gw.test/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer k');
    expect(JSON.parse(init.body).tools[0].function.name).toBe('browser__click');
  });

  it('merges the extra request body into every request', async () => {
    const { p, fetchMock } = provider([delta({ content: 'ok' }, 'stop')], { extraBody: { reasoning_effort: 'high', include_reasoning: true } });
    await collect(p.chat({ model: 'm', messages: history }, signal));
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body).toMatchObject({ model: 'm', stream: true, reasoning_effort: 'high', include_reasoning: true });
  });

  it('surfaces HTTP errors and in-stream errors', async () => {
    const { p } = provider(new Response('bad key', { status: 401 }));
    await expect(collect(p.chat({ model: 'm', messages: history }, signal))).rejects.toThrow('chat 401: bad key');
    const { p: p2 } = provider([d({ error: { message: 'quota exceeded' } })]);
    await expect(collect(p2.chat({ model: 'm', messages: history }, signal))).rejects.toThrow('chat: quota exceeded');
  });

  it.each([
    [400, '{"error":"registry.ollama.ai/library/gemma does not support tools"}'],
    [400, '{"message":"\\"auto\\" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set"}'],
    [404, '{"error":{"message":"No endpoints found that support tool use"}}'],
  ])('says when the model cannot use tools (%i %s)', async (status, body) => {
    const tools = [{ name: 't', description: '', inputSchema: {} }];
    const { p } = provider(new Response(body, { status }));
    await expect(collect(p.chat({ model: 'm', messages: history, tools }, signal))).rejects.toBeInstanceOf(ToolsUnsupportedError);
  });

  it.each([
    [400, "Invalid schema for function 'browser__find': 'query' is not valid"],
    [400, 'tool_call_id c1 does not match any tool call'],
  ])('keeps other errors that mention tools as they are (%i %s)', async (status, body) => {
    const tools = [{ name: 't', description: '', inputSchema: {} }];
    const { p } = provider(new Response(body, { status }));
    const error = await collect(p.chat({ model: 'm', messages: history, tools }, signal)).catch((e) => e);
    expect(error).not.toBeInstanceOf(ToolsUnsupportedError);
    expect(error.message).toBe(`chat ${status}: ${body}`);
  });

  it('handles servers that ignore stream:true and return plain JSON', async () => {
    const { p } = provider(
      new Response(
        JSON.stringify({
          choices: [{ message: { reasoning_content: 'hmm', content: 'hello', tool_calls: [{ id: 't', function: { name: 'f', arguments: '{"a":1}' } }] }, finish_reason: 'tool_calls' }],
        }),
        { headers: { 'Content-Type': 'application/json' } },
      ),
    );
    expect(await collect(p.chat({ model: 'm', messages: history }, signal))).toEqual([
      { type: 'reasoning-delta', text: 'hmm' },
      { type: 'reasoning-end' },
      { type: 'text-delta', text: 'hello' },
      { type: 'tool-call', id: 't', name: 'f', args: { a: 1 } },
      { type: 'done', stopReason: 'tool_calls' },
    ]);
  });

  it('flattens array content parts', async () => {
    const { p } = provider([delta({ content: [{ type: 'text', text: 'he' }, { type: 'text', text: 'llo' }] }), 'data: [DONE]\n\n']);
    expect((await collect(p.chat({ model: 'm', messages: history }, signal)))[0]).toEqual({ type: 'text-delta', text: 'hello' });
  });
});

describe('reasoning', () => {
  const kinds = (events: ChatEvent[]) =>
    events.map((e) => (e.type === 'text-delta' || e.type === 'reasoning-delta' ? `${e.type}:${e.text}` : e.type));

  it.each([
    ['reasoning_content', { reasoning_content: 'step 1' }],
    ['reasoning', { reasoning: 'step 1' }],
    ['thinking', { thinking: 'step 1' }],
    ['reasoning_details', { reasoning_details: [{ type: 'reasoning.text', text: 'step 1' }] }],
  ])('streams reasoning from the %s field, then closes it before the answer', async (_name, field) => {
    const { p } = provider([delta(field), delta({ content: 'answer' }, 'stop'), 'data: [DONE]\n\n']);
    expect(kinds(await collect(p.chat({ model: 'm', messages: history }, signal)))).toEqual([
      'reasoning-delta:step 1',
      'reasoning-end',
      'text-delta:answer',
      'done',
    ]);
  });

  it('prefers `reasoning` over `reasoning_details` (OpenRouter sends both)', () => {
    expect(reasoningFromFields({ reasoning: 'a', reasoning_details: [{ text: 'a' }] })).toBe('a');
  });

  it('splits inline <think> tags even when they are cut across chunks', async () => {
    const { p } = provider([delta({ content: '<thi' }), delta({ content: 'nk>plan' }), delta({ content: ' more</th' }), delta({ content: 'ink>Final' }, 'stop'), 'data: [DONE]\n\n']);
    expect(kinds(await collect(p.chat({ model: 'm', messages: history }, signal)))).toEqual([
      'reasoning-delta:plan',
      'reasoning-delta: more',
      'reasoning-end',
      'text-delta:Final',
      'done',
    ]);
  });

  it('closes reasoning before tool calls when the model never answers in text', async () => {
    const { p } = provider([
      delta({ reasoning_content: 'need the page' }),
      delta({ tool_calls: [{ index: 0, id: 'c', function: { name: 'browser__find', arguments: '{}' } }] }, 'tool_calls'),
      'data: [DONE]\n\n',
    ]);
    expect(kinds(await collect(p.chat({ model: 'm', messages: history }, signal)))).toEqual([
      'reasoning-delta:need the page',
      'reasoning-end',
      'tool-call',
      'done',
    ]);
  });

  it('ThinkTagSplitter handles <thought> after whitespace, cut across chunks', () => {
    const s = new ThinkTagSplitter();
    expect([...s.feed('\n <tho'), ...s.feed('ught>x</thou'), ...s.feed('ght>y <'), ...s.flush()]).toEqual([
      { kind: 'reasoning', text: 'x' },
      { kind: 'text', text: 'y <' },
    ]);
  });

  it('ThinkTagSplitter takes a tag only at the start: one quoted in the answer is text', () => {
    const s = new ThinkTagSplitter();
    expect([...s.feed('Models write <th'), ...s.feed('ink> before they answer.'), ...s.flush()]).toEqual([
      { kind: 'text', text: 'Models write <th' },
      { kind: 'text', text: 'ink> before they answer.' },
    ]);
    const after = new ThinkTagSplitter();
    expect([...after.feed('<think>a</think>Use <think>…</think> tags.'), ...after.flush()]).toEqual([
      { kind: 'reasoning', text: 'a' },
      { kind: 'text', text: 'Use <think>…</think> tags.' },
    ]);
    const lookalike = new ThinkTagSplitter();
    expect([...lookalike.feed('<b>bold</b>'), ...lookalike.flush()]).toEqual([{ kind: 'text', text: '<b>bold</b>' }]);
  });
});

describe('connection helpers', () => {
  it('builds host permission patterns without port', () => {
    expect(originPattern('http://my-gw.local:8000/v1')).toBe('http://my-gw.local/*');
    expect(originPattern('https://llm.corp.com/openai/v1')).toBe('https://llm.corp.com/*');
  });

  it('substitutes {{apiKey}} in extra headers and drops Bearer auth when used', () => {
    const json = { 'Content-Type': 'application/json' };
    expect(buildHeaders('k1', undefined)).toEqual({ ...json, Authorization: 'Bearer k1' });
    expect(buildHeaders('k1', { 'api-key': '{{apiKey}}' })).toEqual({ ...json, 'api-key': 'k1' });
    expect(buildHeaders(undefined, { 'X-Team': 'a' })).toEqual({ ...json, 'X-Team': 'a' });
  });

  it('coerces non-string header values instead of crashing every request', () => {
    expect(buildHeaders('k1', { 'X-Retries': 3, 'X-Debug': true })).toMatchObject({ 'X-Retries': '3', 'X-Debug': 'true' });
  });

  it('keeps the extra headers typed in Settings as texts: an object, a list or null is no header', () => {
    expect(headerValues({ 'X-Team': 'a', 'X-Retries': 3, 'X-Debug': false, nested: { a: 1 }, list: [1], none: null })).toEqual({ 'X-Team': 'a', 'X-Retries': '3', 'X-Debug': 'false' });
  });

  it('falls back to a chat ping when /models is missing', async () => {
    mockFetch(async (url: string) =>
      url.endsWith('/models') ? new Response('not found', { status: 404 }) : sseResponse([delta({ content: 'pong' }, 'stop'), 'data: [DONE]\n\n']),
    );
    const p = new OpenAICompatProvider({ baseURL: 'https://gw.corp/v1', apiKey: 'k' });
    expect(await testConnection(p, 'my-model')).toBe('OK · chat with my-model (no /models)');
    await expect(testConnection(p, '')).rejects.toThrow('listModels 404');
  });

  it('explains network failures', () => {
    expect(humanizeError(new TypeError('Failed to fetch'), 'https://gw')).toContain('Could not connect to https://gw');
  });
});

describe('usage and context window', () => {
  it('asks for usage in the stream and emits it before done', async () => {
    const { p, fetchMock } = provider([delta({ content: 'hi' }, 'stop'), d({ choices: [], usage: { prompt_tokens: 120, completion_tokens: 7 } }), 'data: [DONE]\n\n'], { baseURL: 'https://usage.test/v1' });
    const events = await collect(p.chat({ model: 'm', messages: history }, signal));
    expect(events.slice(-2)).toEqual([{ type: 'usage', inputTokens: 120, outputTokens: 7 }, { type: 'done', stopReason: 'stop' }]);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).stream_options).toEqual({ include_usage: true });
  });

  it('retries without stream_options when the server rejects it, and remembers', async () => {
    const fetchMock = mockFetch([
      new Response('{"error":"Unrecognized request argument: stream_options"}', { status: 400 }),
      sseResponse([delta({ content: 'ok' }, 'stop'), 'data: [DONE]\n\n']),
    ]);
    const p = new OpenAICompatProvider({ baseURL: 'https://strict.test/v1' });
    await collect(p.chat({ model: 'm', messages: history }, signal));
    await collect(p.chat({ model: 'm', messages: history }, signal));
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body));
    expect(bodies.map((b) => 'stream_options' in b)).toEqual([true, false, false]);
  });

  it('forces a tool with tool_choice, and asks again without it when the model rejects it', async () => {
    const tools = [{ name: 'browser__find', description: '', inputSchema: {} }];
    const fetchMock = mockFetch([
      sseResponse([delta({ content: 'ok' }, 'stop'), 'data: [DONE]\n\n']),
      new Response('{"error":"tool_choice is not supported"}', { status: 400 }),
      sseResponse([delta({ content: 'ok' }, 'stop'), 'data: [DONE]\n\n']),
    ]);
    await collect(new OpenAICompatProvider({ baseURL: 'https://choice.test/v1' }).chat({ model: 'm', messages: history, tools, toolChoice: 'browser__find' }, signal));
    const strict = new OpenAICompatProvider({ baseURL: 'https://nochoice.test/v1' });
    const events = await collect(strict.chat({ model: 'm', messages: history, tools, toolChoice: 'required' }, signal));
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).tool_choice);
    expect(bodies).toEqual([{ type: 'function', function: { name: 'browser__find' } }, 'required', undefined]);
    expect(events).toContainEqual({ type: 'notice', text: 'm does not accept forcing a tool: the mentioned tool was only asked for.' });
  });

  it('lets the model call no tool with tool_choice none, and sends no tools where the server rejects it', async () => {
    const tools = [{ name: 'browser__find', description: '', inputSchema: {} }];
    const fetchMock = mockFetch([
      new Response('{"error":"tool_choice is not supported"}', { status: 400 }),
      sseResponse([delta({ content: 'ok' }, 'stop'), 'data: [DONE]\n\n']),
      sseResponse([delta({ content: 'ok' }, 'stop'), 'data: [DONE]\n\n']),
    ]);
    const strict = new OpenAICompatProvider({ baseURL: 'https://nonechoice.test/v1' });
    const events = await collect(strict.chat({ model: 'm', messages: history, tools, toolChoice: 'none' }, signal));
    await collect(strict.chat({ model: 'm', messages: history, tools }, signal));
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body));
    expect(bodies.map((b) => [b.tool_choice, b.tools?.length])).toEqual([['none', 1], [undefined, undefined], [undefined, 1]]);
    expect(events.filter((e) => e.type === 'notice')).toEqual([]);
  });

  it('reads the reasoning tokens apart when the server splits them', async () => {
    const usage = { prompt_tokens: 120, completion_tokens: 907, completion_tokens_details: { reasoning_tokens: 900 } };
    const { p } = provider([delta({ content: 'hi' }, 'stop'), d({ choices: [], usage }), 'data: [DONE]\n\n']);
    expect(await collect(p.chat({ model: 'm', messages: history }, signal))).toContainEqual({ type: 'usage', inputTokens: 120, outputTokens: 907, reasoningTokens: 900 });
    const none = { prompt_tokens: 120, completion_tokens: 7, completion_tokens_details: { reasoning_tokens: 0 } }; // as some send for every model
    const { p: q } = provider([delta({ content: 'hi' }, 'stop'), d({ choices: [], usage: none }), 'data: [DONE]\n\n']);
    expect(await collect(q.chat({ model: 'm', messages: history }, signal))).toContainEqual({ type: 'usage', inputTokens: 120, outputTokens: 7 });
  });

  it('reads the cached input tokens when the server says', async () => {
    const usage = { prompt_tokens: 3000, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 2500 } };
    const { p } = provider([delta({ content: 'hi' }, 'stop'), d({ choices: [], usage }), 'data: [DONE]\n\n']);
    expect(await collect(p.chat({ model: 'm', messages: history }, signal))).toContainEqual({ type: 'usage', inputTokens: 3000, outputTokens: 7, cachedTokens: 2500 });
    for (const details of [{ cached_tokens: 0 }, null]) { // none cached; a server that sends the field empty
      const { p: q } = provider([delta({ content: 'hi' }, 'stop'), d({ choices: [], usage: { prompt_tokens: 3000, completion_tokens: 7, prompt_tokens_details: details } }), 'data: [DONE]\n\n']);
      expect(await collect(q.chat({ model: 'm', messages: history }, signal))).toContainEqual({ type: 'usage', inputTokens: 3000, outputTokens: 7 });
    }
  });

  it('reads usage from non-streamed JSON responses', async () => {
    const { p } = provider(new Response(JSON.stringify({ choices: [{ message: { content: 'x' } }], usage: { prompt_tokens: 5, completion_tokens: 1 } }), { headers: { 'Content-Type': 'application/json' } }));
    expect(await collect(p.chat({ model: 'm', messages: history }, signal))).toContainEqual({ type: 'usage', inputTokens: 5, outputTokens: 1 });
  });

  it('reads the context window under each server family name', async () => {
    const { p } = provider(
      new Response(
        JSON.stringify({
          data: [
            { id: 'a', context_length: 1000 },
            { id: 'b', max_model_len: 2000 },
            { id: 'c', context_window: 3000 },
            { id: 'd', top_provider: { context_length: 4000 } },
            { id: 'e' },
          ],
        }),
      ),
    );
    expect((await p.listModels()).map((m) => [m.id, m.contextWindow])).toEqual([['a', 1000], ['b', 2000], ['c', 3000], ['d', 4000], ['e', undefined]]);
  });
});

describe('thinking', () => {
  it('turns a level into the fields each kind of server understands', () => {
    expect(resolveThinkingParam('auto', 'https://openrouter.ai/api/v1')).toBe('openrouter');
    expect(resolveThinkingParam(undefined, 'https://litellm.corp/v1')).toBe('reasoning_effort');
    expect(thinkingBody('reasoning_effort', 'high')).toEqual({ reasoning_effort: 'high' });
    expect(thinkingBody('reasoning_effort', 'off')).toEqual({ reasoning_effort: 'none' });
    expect(thinkingBody('openrouter', 'off')).toEqual({ reasoning: { enabled: false } });
    expect(thinkingBody('enable_thinking', 'medium')).toEqual({ chat_template_kwargs: { enable_thinking: true } });
    expect(thinkingLevels('enable_thinking')).toEqual(['off', 'high']);
    expect(thinkingLevels('none')).toEqual([]);
  });

  it('sends the level, and without it (with a notice, remembered) when the model rejects it', async () => {
    const fetchMock = mockFetch([
      sseResponse([delta({ content: 'ok' }, 'stop'), 'data: [DONE]\n\n']),
      new Response('{"error":{"message":"reasoning_effort is not supported by this model"}}', { status: 400 }),
      sseResponse([delta({ content: 'ok' }, 'stop'), 'data: [DONE]\n\n']),
    ]);
    const p = new OpenAICompatProvider({ baseURL: 'https://litellm.test/v1' });
    await collect(p.chat({ model: 'thinker', messages: history, thinking: 'high' }, signal));
    const events = await collect(p.chat({ model: 'plain', messages: history, thinking: 'low' }, signal));
    await collect(p.chat({ model: 'plain', messages: history, thinking: 'low' }, signal));
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body));
    expect(bodies.map((b) => b.reasoning_effort)).toEqual(['high', 'low', undefined, undefined]);
    expect(events[0]).toEqual({ type: 'notice', text: 'plain does not accept the thinking setting: sent without it.' });
  });
});

describe('the reasoning sent back', () => {
  it('goes in the request, and once a server rejects the field it is asked again without it', async () => {
    const rejected = new Response(JSON.stringify({ error: { message: "Additional properties are not allowed ('reasoning' was unexpected) - 'messages.2'" } }), { status: 400 });
    const fetchMock = mockFetch([rejected, sseResponse([delta({ content: 'ok' }, 'stop')]), sseResponse([delta({ content: 'ok' }, 'stop')])]);
    const p = new OpenAICompatProvider({ baseURL: 'https://strict.test/v1', apiKey: 'k' });
    await collect(p.chat({ model: 'm', messages: inLoop }, signal));
    const sent = fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string).messages.some((m: { reasoning?: string }) => m.reasoning));
    expect(sent).toEqual([true, false]);
    await collect(p.chat({ model: 'm', messages: inLoop }, signal));
    expect(JSON.parse((fetchMock.mock.calls[2]![1] as RequestInit).body as string).messages.some((m: { reasoning?: string }) => m.reasoning)).toBe(false);
  });
});

describe('a 400 taken for a rejected setting', () => {
  const overflow = (model: string) => new Response(JSON.stringify({ error: { message: `This model's maximum context length is 8192 tokens. However, your messages resulted in 9000 tokens (model ${model}).` } }), { status: 400 });

  it('names the thinking field sent, not a model whose name says thinking', async () => {
    for (const [param, model] of [['reasoning_effort', 'qwen3-thinking'], ['openrouter', 'deepseek/r1-reasoning'], ['enable_thinking', 'org/thinking']] as const) {
      const fetchMock = mockFetch([overflow(model), sseResponse([delta({ content: 'ok' }, 'stop')])]);
      const p = new OpenAICompatProvider({ baseURL: `https://${param}.test/v1`, thinkingParam: param });
      await expect(collect(p.chat({ model, messages: history, thinking: 'high' }, signal))).rejects.toThrow('chat 400');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it('still drops the thinking field when the error names it', async () => {
    for (const [param, error] of [['enable_thinking', 'unexpected keyword argument: enable_thinking.'], ['openrouter', "Unrecognized request argument supplied: reasoning"]] as const) {
      const fetchMock = mockFetch([new Response(error, { status: 400 }), sseResponse([delta({ content: 'ok' }, 'stop')])]);
      const p = new OpenAICompatProvider({ baseURL: `https://named-${param}.test/v1`, thinkingParam: param });
      await collect(p.chat({ model: 'm', messages: history, thinking: 'high' }, signal));
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
  });

  it('names the reasoning sent back, not a model whose name says reasoning', async () => {
    const fetchMock = mockFetch([overflow('r1-reasoning'), sseResponse([delta({ content: 'ok' }, 'stop')])]);
    const p = new OpenAICompatProvider({ baseURL: 'https://overflow.test/v1' });
    await expect(collect(p.chat({ model: 'r1-reasoning', messages: inLoop }, signal))).rejects.toThrow('chat 400');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
