import { describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', async () => (await import('./fakes/browser')).emptyBrowser());
const { ALL_PARTS, compactedView, compactionOf, compactionStep, modelView, compactionPoint, trimMessages, trimmedAt, withCompaction } = await import('../src/context/compaction');
const { messagesTokens } = await import('../src/context/budget');
const { toOpenAIMessages } = await import('../src/providers/wire');
const { conversationToSave } = await import('../src/history/when-to-save');
const { text } = await import('../src/core/model-texts');
const { withPlansDismissed } = await import('../src/tools/user/shapes');
type Message = import('../src/core/types').Message;
type Compaction = import('../src/core/types').Compaction;

const long = (c: string) => c.repeat(600);
const user = (t: string, page?: string): Message => ({ role: 'user', parts: [{ type: 'text', text: t }, ...(page ? [{ type: 'text' as const, text: page, context: 'page' as const }] : [])] });
const answer = (t: string): Message => ({ role: 'assistant', parts: [{ type: 'text', text: t }] });
const call = (id: string): Message => ({ role: 'assistant', parts: [{ type: 'tool_call', id, name: 'browser.read_page', args: {} }] });
const result = (id: string, content: string, images = false): Message => ({
  role: 'tool',
  parts: [{ type: 'tool_result', toolCallId: id, content, ...(images && { images: [{ mediaType: 'image/png', data: 'AAAA' }] }) }],
});
// Four turns: the first with a page block and a long tool result with a screenshot.
const history: Message[] = [user('one', long('P')), call('c1'), result('c1', long('R'), true), answer('done one'), user('two'), answer('a2'), user('three'), answer('a3'), user('four'), answer('a4')];
const compaction = (change: Partial<Compaction> = {}): Compaction => ({ at: 1, turns: 1, trimmed: ALL_PARTS, before: 10, after: 2, ...change });

describe('compacting the earlier turns', () => {
  it('leaves out page blocks, long tool results and screenshots, saying what they were', () => {
    const [u, , r] = trimMessages(history, ALL_PARTS);
    expect(u!.parts[1]).toMatchObject({ context: 'page', text: '[page content left out to save context: 600 characters]' });
    expect(r!.parts[0]).toMatchObject({ content: '[the result of browser__read_page left out to save context: 600 characters]\n[a screenshot left out to save context: 4 characters]' });
    expect(r!.parts[0]).not.toHaveProperty('images');
    // Only what was asked, and short results stay.
    const pagesOnly = trimMessages([result('x', 'short'), ...history], { pages: true, toolResults: false, screenshots: false });
    expect(pagesOnly[0]!.parts[0]).toMatchObject({ content: 'short' });
    expect(pagesOnly[3]!.parts[0]).toMatchObject({ content: long('R'), images: [{ data: 'AAAA' }] });
  });

  it("keeps what went after a long result between the model's steps", () => {
    const attached = [{ kind: 'memory' as const, text: '<memory>NOTE</memory>', source: 'memory-step:1' }];
    const withMemory: Message = { role: 'tool', parts: [{ type: 'tool_result', toolCallId: 'c1', content: `${long('R')}\n\n<memory>NOTE</memory>`, attached }] };
    const [r] = trimMessages([call('c1'), withMemory], ALL_PARTS).slice(1);
    expect(r!.parts[0]).toMatchObject({ content: '[the result of browser__read_page left out to save context: 600 characters]\n\n<memory>NOTE</memory>', attached });
  });

  it('goes on the first of the latest turns kept whole, after the last compaction', () => {
    expect(compactionPoint(history, 2)).toBe(6); // "three"
    expect(compactionPoint(history, 4)).toBeUndefined(); // nothing before the first turn kept
    expect(compactionPoint(withCompaction(history, 6, compaction()), 2)).toBeUndefined();
    expect(compactionPoint(withCompaction(history, 4, compaction()), 2)).toBe(6);
  });

  it('sends the turns before it trimmed, or its summary in their place; the history stays whole', () => {
    const trimmed = withCompaction(history, 6, compaction());
    const view = compactedView(trimmed);
    expect(view.summarized).toBe(false);
    expect(view.messages).toHaveLength(history.length);
    expect(view.messages[0]!.parts[1]).toMatchObject({ text: '[page content left out to save context: 600 characters]' });
    expect(trimmed[0]!.parts[1]).toMatchObject({ text: long('P') });

    const summarized = withCompaction(history, 6, compaction({ turns: 2, summary: 'They read the page.' }));
    const { messages, summarized: yes } = compactedView(summarized);
    expect(yes).toBe(true);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(messages[0]!.parts[0]).toMatchObject({ context: 'summary', text: '<untrusted_conversation_summary turns="2">\nThey read the page.\n</untrusted_conversation_summary>' });
  });

  it('a later compaction builds on the one before', () => {
    const twice = withCompaction(withCompaction(history, 4, compaction({ summary: 'S1' })), 8, compaction());
    const { messages } = compactedView(twice);
    expect(messages[0]!.parts[0]).toMatchObject({ context: 'summary' }); // the first summary stays, untouched by the trim
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
  });

  it('weighs what it saves', () => {
    const plan = trimmedAt(history, 6, ALL_PARTS);
    expect(plan.turns).toBe(2);
    expect(plan.tokensAfter).toBeLessThan(plan.tokensBefore);
  });

  it('tells the model what the summary is, only once there is one', () => {
    const sent = (h: Message[]) => {
      const view = modelView('Be brief.', h);
      return toOpenAIMessages(view.system, view.messages)[0]!.content;
    };
    expect(sent(history)).toBe('Be brief.');
    expect(sent(withCompaction(history, 6, compaction({ summary: 'S' })))).toBe(`Be brief.\n\n${text('system.compaction')}`);
  });

  it('is saved at once, between turns', () => {
    const before = { id: 'c', history, live: [], busy: false };
    expect(conversationToSave(before, { ...before, history: withCompaction(history, 6, compaction()) })).toMatchObject({ id: 'c' });
    expect(conversationToSave(before, { ...before, history: [...history] })).toBeUndefined();
  });

  it('settings fill in their defaults', () => {
    expect(compactionOf({ threshold: 70, trim: { screenshots: false } })).toMatchObject({ auto: true, threshold: 70, keepTurns: 4, trim: { pages: true, toolResults: true, screenshots: false } });
  });
});

describe('a plan through a compaction', () => {
  const steps = (status: 'pending' | 'done', n = 2) => Array.from({ length: n }, (_, i) => ({ title: `Step ${i} of the task, with a title of some length`, status: i ? status : 'done' }));
  const plan = (id: string, status: 'pending' | 'done' = 'pending', n = 2): Message[] => [
    { role: 'assistant', parts: [{ type: 'tool_call', id, name: 'user__plan', args: { steps: steps(status, n) } }] },
    { role: 'tool', parts: [{ type: 'tool_result', toolCallId: id, content: 'Plan shown' }] },
  ];
  const withPlan = (planned: Message[]): Message[] => [user('one'), ...planned, answer('a1'), user('two'), answer('a2')];
  const kept = (h: Message[]) => h.findIndex((m, i) => i > 0 && m.role === 'user');
  const summed = (h: Message[]) => withCompaction(h, kept(h), compaction({ summary: 'S' }));
  const blockOf = (h: Message[]) => compactedView(h).messages.flatMap((m) => m.parts).find((p) => p.type === 'text' && p.text.startsWith('<plan>'));

  it('goes with the summary while it has steps to do', () => {
    const view = compactedView(summed(withPlan(plan('p1')))).messages;
    expect(view[0]!.parts.map((p) => (p.type === 'text' ? p.text.split('\n')[0] : p.type))).toEqual(['<untrusted_conversation_summary turns="1">', '<plan>', 'two']);
    const block = blockOf(summed(withPlan(plan('p1'))));
    expect(block).toMatchObject({ type: 'text', context: 'summary' });
    expect(block?.type === 'text' && block.text).toContain('- [done] Step 0 of the task, with a title of some length\n- [pending] Step 1 of the task, with a title of some length');
  });

  it('reaches the model', () => {
    expect(JSON.stringify(toOpenAIMessages(undefined, modelView(undefined, summed(withPlan(plan('p1')))).messages))).toContain('<plan>');
  });

  it('says nothing of one with every step done', () => {
    expect(blockOf(summed(withPlan(plan('p1', 'done'))))).toBeUndefined();
    expect(blockOf(summed(withPlan([...plan('p1'), ...plan('p2', 'done')])))).toBeUndefined();
  });

  it('says nothing of one the model still sees', () => {
    const h = [user('one'), answer('a1'), user('two'), ...plan('p1'), answer('a2')];
    expect(blockOf(summed(h))).toBeUndefined();
    expect(blockOf(withCompaction(withPlan(plan('p1')), 4, compaction()))).toBeUndefined(); // short: not trimmed
  });

  it('goes when trimming took its steps', () => {
    const h = withPlan(plan('p1', 'pending', 12));
    expect(blockOf(withCompaction(h, kept(h), compaction()))).toBeDefined();
  });

  it('survives a later compaction', () => {
    const h = [...withPlan(plan('p1')), user('three'), answer('a3')];
    const twice = withCompaction(summed(h), h.length - 2, compaction({ summary: 'S2' }));
    expect(blockOf(twice)).toBeDefined();
  });

  it('says nothing of one the user took away', () => {
    expect(blockOf(summed(withPlansDismissed(withPlan(plan('p1')), new Set(['p1']))))).toBeUndefined();
  });

  it('leaves the history as it is, and nothing without a compaction', () => {
    const h = summed(withPlan(plan('p1')));
    compactedView(h);
    expect(h.flatMap((m) => m.parts).some((p) => p.type === 'text' && p.text.startsWith('<plan>'))).toBe(false);
    const whole = withPlan(plan('p1'));
    expect(compactedView(whole).messages).toBe(whole);
  });
});

describe('messagesTokens', () => {
  it('weighs a part this build does not know (a newer build) as nothing, not NaN', () => {
    const odd = { role: 'user', parts: [{ type: 'text', text: 'Hi' }, { type: 'from-a-newer-build' }] } as unknown as Message;
    expect(messagesTokens([odd])).toBe(messagesTokens([{ role: 'user', parts: [{ type: 'text', text: 'Hi' }] }]));
  });
});

describe('compacting toward a target', () => {
  const big = (c: string) => c.repeat(4000); // ~1k tokens
  // A turn that read a page: your message with its page block, a tool call, its long result, the answer.
  const heavy = (n: number): Message[] => [user(`q${n}`, big('P')), call(`c${n}`), result(`c${n}`, big('R')), answer(`a${n}`)];
  const cfg = compactionOf(undefined); // threshold 80, keepTurns 4, summarize
  const ctx = (history: Message[], window: number, fixed = 0) => ({ used: messagesTokens(history) + fixed, window, canSummarize: true, auto: true });

  it('stops at the first step that brings the context under half the threshold', () => {
    const history = [1, 2, 3, 4, 5, 6].flatMap(heavy); // ~12k tokens
    const step = compactionStep(history, cfg, ctx(history, 24000))!; // target 9.6k: trimming the first two turns is enough
    expect(step).toMatchObject({ at: 8, turns: 2, inner: 0, summarize: false });
    expect(step.short).toBeUndefined();
  });

  it('keeps fewer turns whole, and summarizes, when that is what it takes', () => {
    const history = [1, 2, 3, 4, 5, 6].flatMap(heavy);
    const step = compactionStep(history, cfg, ctx(history, 9000))!; // target 3.6k
    expect(step.turns).toBeGreaterThan(2);
    expect(step.at).toBeGreaterThan(8);
  });

  it('trims all but the latest messages of a single long turn', () => {
    const history = [user('go', big('P')), ...[1, 2, 3, 4, 5].flatMap((n) => [call(`c${n}`), result(`c${n}`, big('R'))]), answer('done')];
    const step = compactionStep(history, cfg, ctx(history, 8000))!;
    expect(step).toMatchObject({ at: 0, turns: 0, inner: history.length - 4, summarize: false });
    const view = compactedView(withCompaction(history, 0, compaction({ turns: 0, inner: step.inner })));
    expect(view.messages[0]!.parts[1]).toMatchObject({ text: '[page content left out to save context: 4,000 characters]' });
    expect(view.messages.at(-2)!.parts[0]).toMatchObject({ content: big('R') }); // the latest result goes whole
  });

  it('says how short it falls when the system prompt and tools leave no room', () => {
    const history = [1, 2, 3].flatMap(heavy);
    const step = compactionStep(history, cfg, ctx(history, 10000, 6000))!; // 60% fixed, target 40%
    expect(step.short).toMatchObject({ target: 40, fixed: 60 });
    expect(step.short!.percent).toBeGreaterThan(60);
  });

  it('without a window, goes as keepTurns says, summarized only from the meter', () => {
    const history = [1, 2, 3, 4, 5, 6].flatMap(heavy);
    const auto = compactionStep(history, cfg, { used: 0, canSummarize: true, auto: true })!;
    expect(auto).toMatchObject({ at: 8, turns: 2, summarize: false });
    expect(compactionStep(history, cfg, { used: 0, canSummarize: true, auto: false })!.summarize).toBe(true);
  });
});

describe('tool calls left without results', () => {
  // Saved so by an older build when the agent was lost mid-tool: the next request would be rejected.
  it('get one in the model\'s view, after the results their message did get', () => {
    const both: Message = { role: 'assistant', parts: [{ type: 'tool_call', id: 'a', name: 'browser.click', args: {} }, { type: 'tool_call', id: 'b', name: 'browser.click', args: {} }] };
    const view = modelView(undefined, [user('one'), both, result('a', 'ok'), user('two')]).messages;
    expect(view.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'tool', 'user']);
    expect(view[3]!.parts).toEqual([{ type: 'tool_result', toolCallId: 'b', content: text('result.stopped'), isError: true }]);
    const last = modelView(undefined, [user('one'), call('c1')]).messages;
    expect(last.at(-1)).toMatchObject({ role: 'tool', parts: [{ toolCallId: 'c1' }] });
  });

  it('leave a history with every call answered as it is', () => {
    expect(modelView(undefined, history.slice(0, 4)).messages).toEqual(history.slice(0, 4));
  });
});
