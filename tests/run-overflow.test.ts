import { describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', async () => (await import('./fakes/browser')).emptyBrowser());
const { inRunOf, squeezeRun } = await import('../src/context/in-run');
const { isContextOverflow } = await import('../src/context/window');
const { runAgentLoop, SENT_SHORTER } = await import('../src/core/agent-loop');
const { text } = await import('../src/core/model-texts');
const { ToolRegistry } = await import('../src/core/tool-registry');
const { collect, loop } = await import('./helpers');
const { runView } = await import('../src/background/run-setup');
type Message = import('../src/core/types').Message;
type Part = import('../src/core/types').Part;
type ChatEvent = import('../src/core/types').ChatEvent;
type LoopContext = import('../src/core/agent-loop').LoopContext;
type LoopModel = import('../src/core/agent-loop').LoopModel;
type LoopHooks = import('../src/core/agent-loop').LoopHooks;

// A turn that would not fit: the request is shortened more, and sent once more when the server refuses it as too long.
const long = (c: string, n = 1000) => c.repeat(n);
const leftOut = (what: string, chars: number) => text('run.left_out', { what, chars: chars.toLocaleString('en-US') });
const call = (id: string, name = 'browser.get_page_text'): Message => ({ role: 'assistant', parts: [{ type: 'tool_call', id, name, args: {} }] });
const result = (id: string, content: string): Message => ({ role: 'tool', parts: [{ type: 'tool_result', toolCallId: id, content }] });
const contentOf = (messages: Message[], id: string) =>
  messages.flatMap((m) => m.parts).find((p): p is Extract<Part, { type: 'tool_result' }> => p.type === 'tool_result' && p.toolCallId === id)!.content;
const ask = (t: string): Message => ({ role: 'user', parts: [{ type: 'text', text: t }] });
const page: Part = { type: 'text', context: 'page', text: long('p') };

describe('a request shortened more', () => {
  const earlier: Message[] = [{ role: 'user', parts: [page, { type: 'text', text: 'before' }] }, call('e1'), result('e1', long('e')), { role: 'assistant', parts: [{ type: 'text', text: 'ok' }] }];
  const turn: Message[] = [ask('now'), call('c0'), result('c0', long('0')), call('c1'), result('c1', long('1')), call('c2'), result('c2', long('2'))];
  const all = [...earlier, ...turn];
  const off = inRunOf({ enabled: false });

  it('sends only the latest result of the turn whole, even with shortening during a turn off', () => {
    expect(squeezeRun(all, off)).toBe(all);
    const sent = squeezeRun(all, off, { squeeze: 1 });
    for (const id of ['c0', 'c1']) expect(contentOf(sent, id)).toBe(leftOut('the result of browser__get_page_text', 1000));
    expect(contentOf(sent, 'c2')).toBe(long('2'));
    expect(contentOf(sent, 'e1')).toBe(long('e')); // the turns before stay
  });

  it('then leaves out the page blocks and results of the turns before, not your message', () => {
    const sent = squeezeRun(all, off, { squeeze: 2 });
    expect(contentOf(sent, 'e1')).toBe(text('compaction.trimmed', { what: 'the result of browser__get_page_text', chars: '1,000' }));
    expect(sent[0]!.parts[0]).toMatchObject({ context: 'page', text: text('compaction.trimmed', { what: 'page content', chars: '1,000' }) });
    expect(sent[0]!.parts[1]).toEqual({ type: 'text', text: 'before' });
    expect(sent[4]).toEqual(ask('now'));
    expect(contentOf(sent, 'c2')).toBe(long('2'));
    expect(contentOf(all, 'e1')).toBe(long('e')); // the history stays whole
  });

  it('keeps whole the results of calls not to be made again at 1; at 2, a note that does not say to call again', () => {
    const asked: Message[] = [ask('now'), call('a1', 'agents.ask'), result('a1', long('a')), call('c2'), result('c2', long('2')), call('c3'), result('c3', 'short')];
    const repeatable = (name: string) => name !== 'agents.ask';
    expect(contentOf(squeezeRun(asked, off, { squeeze: 1, repeatable }), 'a1')).toBe(long('a'));
    expect(contentOf(squeezeRun(asked, off, { squeeze: 2, repeatable }), 'a1')).toBe(text('run.left_out_kept', { what: 'the result of agents__ask', chars: '1,000' }));
    expect(contentOf(squeezeRun([...asked, call('c4'), result('c4', 'short')], off, { squeeze: 2, repeatable }), 'c2')).toBe(leftOut('the result of browser__get_page_text', 1000));
  });

  it('keeps the arguments of this turn\'s calls whole at every level; only the turns before lose theirs', () => {
    const args = { content: long('x', 2000) };
    const written = (id: string): Message => ({ role: 'assistant', parts: [{ type: 'tool_call', id, name: 'files.write', args }] });
    const history: Message[] = [ask('before'), written('w0'), result('w0', 'ok'), { role: 'assistant', parts: [{ type: 'text', text: 'done' }] }, ask('now'), written('w1'), result('w1', 'ok'), call('c2'), result('c2', long('2'))];
    const sent = squeezeRun(history, off, { squeeze: 2 });
    const argsOf = (id: string) => sent.flatMap((m) => m.parts).find((p): p is Extract<Part, { type: 'tool_call' }> => p.type === 'tool_call' && p.id === id)!.args;
    expect(argsOf('w1')).toEqual(args);
    expect(argsOf('w0')).toHaveProperty('left_out');
  });
});

describe('a server refusing a request as too long', () => {
  it('is told with or without the limit, and not for other errors', () => {
    expect(isContextOverflow("chat 400: This model's maximum context length is 16000 tokens.")).toBe(true);
    expect(isContextOverflow('chat 400: {"error":{"code":"context_length_exceeded"}}')).toBe(true);
    expect(isContextOverflow('chat 400: prompt is too long')).toBe(true);
    expect(isContextOverflow('chat 413: Request too large: too many tokens')).toBe(true);
    expect(isContextOverflow('chat 401: invalid api key')).toBe(false);
    expect(isContextOverflow('chat 400: URL too long')).toBe(false);
  });
});

describe('the agent loop near the model\'s window', () => {
  const TOO_LONG = "chat 400: This model's maximum context length is 1000 tokens.";
  const answer: ChatEvent[] = [{ type: 'text-delta', text: 'Done' }, { type: 'done', stopReason: 'stop' }];
  const tools = new ToolRegistry();
  tools.register({ name: 'browser.get_page_text', description: 'read', inputSchema: {}, source: 'browser', effect: 'read', run: async () => ({ type: 'text', text: long('r') }) });

  // Each request's squeeze as the view got it; each call to the provider runs `step(n)` (n from 0).
  function run(step: (n: number) => ChatEvent[] | Error | { partial: ChatEvent[]; error: Error }, { onOverflow, ...model }: Partial<LoopModel> & Pick<LoopHooks, 'onOverflow'> = {}) {
    const squeezes: number[] = [];
    let calls = 0;
    const provider = {
      listModels: async () => [],
      async *chat() {
        const out = step(calls++);
        if (out instanceof Error) throw out;
        if (!Array.isArray(out)) {
          yield* out.partial;
          throw out.error;
        }
        yield* out;
      },
    };
    // The background's own view (background/run-setup), as the chat and the agents it asks run with it.
    const real = runView({ providers: [], systemPrompt: '' }, tools);
    const view: LoopContext['view'] = (system, messages, seen) => {
      squeezes.push(seen.squeeze ?? 0);
      return real(system, messages, seen);
    };
    const events = collect(runAgentLoop([ask('read it')], loop(provider, tools, { model: { overflowed: isContextOverflow, ...model }, context: { view }, hooks: { onOverflow } }), new AbortController().signal));
    return { events, squeezes, calls: () => calls };
  }
  const notices = (events: { type: string; text?: string }[]) => events.flatMap((e) => (e.type === 'notice' ? [e.text] : []));

  it('sends the rest of the run shortened as much too, once refused, and tells what the server said', async () => {
    const said: string[] = [];
    const read = (id: string): ChatEvent[] => [{ type: 'tool-call', id, name: 'browser__get_page_text', args: {} }, { type: 'done', stopReason: 'tool_calls' }];
    const r = run((n) => (n === 0 ? new Error(TOO_LONG) : n < 3 ? read(`c${n}`) : answer), { onOverflow: (e) => said.push(e) });
    const events = await r.events;
    expect(r.squeezes).toEqual([0, 2, 2, 2]);
    expect(r.calls()).toBe(4);
    expect(said).toEqual([TOO_LONG]);
    expect(notices(events)).toEqual([SENT_SHORTER]);
  });

  it('errors when refused again, squeezed as much as it can be', async () => {
    const r = run(() => new Error(TOO_LONG));
    const events = await r.events;
    expect(r.calls()).toBe(2);
    expect(events.at(-1)).toMatchObject({ type: 'error' });
  });

  it('sends it once more, shortened as much as it can be, and goes on', async () => {
    const r = run((n) => (n === 0 ? new Error(TOO_LONG) : answer));
    const events = await r.events;
    expect(r.squeezes).toEqual([0, 2]);
    expect(notices(events)).toEqual([SENT_SHORTER]);
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('errs when refused again, or for another error, or once the answer had started', async () => {
    const again = run(() => new Error(TOO_LONG));
    expect((await again.events).at(-1)).toEqual({ type: 'error', error: TOO_LONG });
    expect(again.calls()).toBe(2);
    const other = run(() => new Error('chat 401: invalid api key'));
    expect((await other.events).at(-1)).toMatchObject({ type: 'error' });
    expect(other.calls()).toBe(1);
    const midway = run((n) => (n === 0 ? { partial: [{ type: 'text-delta', text: 'Half' }], error: new Error(TOO_LONG) } : answer));
    expect((await midway.events).at(-1)).toEqual({ type: 'error', error: TOO_LONG });
    expect(midway.squeezes).toEqual([0]);
  });

  it('shortens a request estimated over 90 % of the window, telling the chat once', async () => {
    const read = (id: string): ChatEvent[] => [{ type: 'tool-call', id, name: 'browser__get_page_text', args: {} }, { type: 'done', stopReason: 'tool_calls' }];
    const r = run((n) => (n < 3 ? read(`c${n}`) : answer), { contextWindow: 10 });
    const events = await r.events;
    expect(r.squeezes).toEqual([0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2]);
    expect(notices(events)).toHaveLength(1);
    expect(notices(events)[0]).toMatch(/^Context nearly full \(\d[\d,k]* of 10, provider window; tools \d[\d,k]*\): earlier results of this turn were shortened more/);
    // Nothing of the turn to leave out yet: shortened, not told.
    const fixed = run(() => answer, { contextWindow: 10 });
    expect(notices(await fixed.events)).toEqual([]);
    expect(fixed.squeezes).toEqual([0, 1, 2]);
    // As corrected for the model: one that fits as estimated may not as its server counts.
    const sized = await run(() => answer, {}).events;
    const input = sized.flatMap((e) => (e.type === 'usage' ? [e.usage.breakdown] : [])).map((b) => Object.values(b).reduce((n, v) => n + v, 0))[0]!;
    const fits = run(() => answer, { contextWindow: Math.ceil(input * 1.5) });
    await fits.events;
    expect(fits.squeezes).toEqual([0]);
    const counted = run(() => answer, { contextWindow: Math.ceil(input * 1.5), tokenRatio: 2 });
    await counted.events;
    expect(counted.squeezes).toEqual([0, 1, 2]);
    const roomy = run(() => answer, { contextWindow: 1_000_000 });
    expect(notices(await roomy.events)).toEqual([]);
    expect(roomy.squeezes).toEqual([0]);
  });
});
