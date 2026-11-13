import { describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', async () => (await import('./fakes/browser')).emptyBrowser());
const { ALL_PARTS, compactedView, seenWhole, trimMessages } = await import('../src/context/compaction');
const { SKILL_MENTION_SOURCE } = await import('../src/context/sources');
const { text } = await import('../src/core/model-texts');
const { toOpenAIMessages } = await import('../src/providers/wire');
type Message = import('../src/core/types').Message;
type Compaction = import('../src/core/types').Compaction;

// Compaction also leaves out the model's long replies (their start kept), long call arguments, and site skills and memory attached earlier.
const note = (what: string, chars: number) => text('compaction.trimmed', { what, chars: chars.toLocaleString('en-US') });
const long = (c: string, n: number) => c.repeat(n);
const ask: Message = { role: 'user', parts: [{ type: 'text', text: long('u', 2000) }, { type: 'text', context: 'skill', source: 'shop-buy', text: long('s', 2000) }, { type: 'text', context: 'memory', source: 'memory:example.com', text: long('m', 640) }, { type: 'text', context: 'skill', source: `${SKILL_MENTION_SOURCE}summarize`, text: long('k', 500) }, { type: 'text', context: 'skill', text: 'short reminder' }] };
const call: Message = { role: 'assistant', parts: [{ type: 'text', text: long('r', 5000) }, { type: 'tool_call', id: 'c1', name: 'custom_tools.save', args: { script: long('x', 3000) } }, { type: 'tool_call', id: 'c2', name: 'browser.click', args: { ref: 'ref_1' } }] };
const short: Message = { role: 'assistant', parts: [{ type: 'text', text: long('a', 1400) }] };

describe('compaction, the other long parts', () => {
  it('keeps the start of a long reply, and leaves out long arguments, site skills and memory', () => {
    const [user, model, kept] = trimMessages([ask, call, short], ALL_PARTS);
    expect(user!.parts[0]).toEqual(ask.parts[0]); // your text stays
    expect(user!.parts[1]).toMatchObject({ context: 'skill', source: 'shop-buy', text: note('the site skill shop-buy', 2000) });
    expect(user!.parts[2]).toMatchObject({ text: note('memory items', 640) });
    expect(user!.parts[3]).toMatchObject({ text: note('the skill summarize', 500) });
    expect(user!.parts[4]).toEqual(ask.parts[4]);
    expect(model!.parts[0]).toEqual({ type: 'text', text: `${long('r', 1000)}\n${note('the rest of this reply', 4000)}` });
    const args = JSON.stringify(call.parts[1]!.type === 'tool_call' && call.parts[1]!.args).length;
    expect(model!.parts[1]).toMatchObject({ id: 'c1', name: 'custom_tools.save', args: { left_out: note('the arguments of this call', args) } });
    expect(model!.parts[2]).toEqual(call.parts[2]); // short arguments stay
    expect(kept).toEqual(short); // a reply this short stays whole
  });

  it('leaves them as they are for a compaction made before it knew them', () => {
    const old: Compaction = { at: 1, turns: 1, trimmed: { pages: true, toolResults: true, screenshots: true }, before: 1, after: 1 };
    const now = { role: 'user' as const, parts: [{ type: 'text' as const, text: 'next' }], compaction: old };
    const sent = compactedView([ask, call, now]).messages;
    expect(sent[0]!.parts[1]).toEqual(ask.parts[1]);
    expect(sent[1]).toEqual(call);
  });

  it('sends a site skill it left out again, as what the model still sees no longer has it', () => {
    const compaction: Compaction = { at: 1, turns: 1, trimmed: ALL_PARTS, before: 1, after: 1 };
    const seen = seenWhole([ask, call, { role: 'user', parts: [{ type: 'text', text: 'next' }], compaction }]);
    expect(seen.flatMap((m) => m.parts).some((p) => p.type === 'text' && p.source === 'shop-buy')).toBe(false);
  });

  it('sends a call\'s arguments without the origin marks its note may carry', () => {
    const marked: Message = { role: 'assistant', parts: [{ type: 'tool_call', id: 'c1', name: 'browser__find', args: { left_out: '[\uE002the arguments\uE003 left out]' } }] };
    const wire = toOpenAIMessages(undefined, [marked]) as { tool_calls?: { function: { arguments: string } }[] }[];
    expect(wire[0]!.tool_calls![0]!.function.arguments).toBe('{"left_out":"[the arguments left out]"}');
  });
});
