import { describe, expect, it } from 'vitest';
import { summaryRequestSystem } from '../src/background/summarize';
import { messagesTokens } from '../src/context/budget';
import { ALL_PARTS, compactCall, compactionOf, compactionStep, withCompaction } from '../src/context/compaction';
import { text } from '../src/core/model-texts';
import type { Compaction, Message, ToolContext } from '../src/core/types';
import { userTools } from '../src/tools/user/user-tools';
import { compactionMarkTitle } from '../src/ui/chat/compaction-text';

const compactTool = userTools().find((t) => t.name === 'chat.compact')!;

describe('chat.compact', () => {
  it('only says the conversation will be compacted: the side panel does it when the turn ends', async () => {
    const ctx = { interact: async () => ({ dismissed: true }) } as unknown as ToolContext;
    expect(await compactTool.run({ instructions: 'keep the prices' }, ctx)).toEqual({ type: 'text', text: text('result.compact_scheduled') });
  });

  it('is refused where there is no chat to compact', async () => {
    await expect(compactTool.run({}, {} as ToolContext)).rejects.toThrow(text('error.no_chat'));
  });
});

describe('summaryRequestSystem', () => {
  it('is the summary request alone without instructions', () => {
    expect(summaryRequestSystem(300)).toBe(text('compaction.summary_request', { max_words: '300' }));
    expect(summaryRequestSystem(300, '  ')).toBe(text('compaction.summary_request', { max_words: '300' }));
  });

  it('puts the instructions after the request\'s own rules', () => {
    const system = summaryRequestSystem(300, ' keep the prices ');
    expect(system).toBe(`${text('compaction.summary_request', { max_words: '300' })}\n\n${text('compaction.summary_instructions', { instructions: 'keep the prices' })}`);
  });
});

describe('compactCall', () => {
  const user = (t: string): Message => ({ role: 'user', parts: [{ type: 'text', text: t }] });
  const answer = (t: string): Message => ({ role: 'assistant', parts: [{ type: 'text', text: t }] });
  const compactCalled = (id: string, instructions?: string): Message => ({ role: 'assistant', parts: [{ type: 'tool_call', id, name: 'chat__compact', args: instructions ? { instructions } : {} }] });
  const result = (id: string, isError = false): Message => ({ role: 'tool', parts: [{ type: 'tool_result', toolCallId: id, content: 'ok', ...(isError && { isError }) }] });
  const turn = (...calls: Message[]) => [user('one'), answer('a1'), user('compact'), ...calls, answer('done')];

  it('finds the latest turn\'s call, the last one when there are several', () => {
    expect(compactCall(turn(compactCalled('c1'), result('c1')))).toEqual({});
    expect(compactCall(turn(compactCalled('c1', 'first'), result('c1'), compactCalled('c2', 'keep the prices'), result('c2')))).toEqual({ instructions: 'keep the prices' });
  });

  it('finds a call the model named with its dots, as the tool still runs for it', () => {
    const dotted: Message = { role: 'assistant', parts: [{ type: 'tool_call', id: 'c1', name: 'chat.compact', args: { instructions: 'keep the prices' } }] };
    expect(compactCall(turn(dotted, result('c1')))).toEqual({ instructions: 'keep the prices' });
  });

  it('finds none in an earlier turn, for a call that failed, or a turn not finished or stopped', () => {
    expect(compactCall([user('compact'), compactCalled('c1'), result('c1'), answer('done'), user('next'), answer('a')])).toBeUndefined();
    expect(compactCall(turn(compactCalled('c1'), result('c1', true)))).toBeUndefined();
    // Waiting at the step limit (Continue goes on with the same turn), or a run still going.
    expect(compactCall([user('compact'), compactCalled('c1'), result('c1')])).toBeUndefined();
    const stopped = turn(compactCalled('c1'), result('c1'));
    stopped[stopped.length - 1] = { ...answer('do'), stopped: true };
    expect(compactCall(stopped)).toBeUndefined();
  });

  it('finds none once a compaction ran after the call', () => {
    const history = turn(compactCalled('c1', 'keep the prices'), result('c1'));
    const compaction: Compaction = { at: 1, turns: 1, trimmed: ALL_PARTS, before: 10, after: 2, ranAfter: history.length };
    expect(compactCall(withCompaction(history, 2, compaction))).toBeUndefined();
    // One that ran before it (on its own, before your message) does not count.
    expect(compactCall(withCompaction(history, 2, { ...compaction, ranAfter: 2 }))).toEqual({ instructions: 'keep the prices' });
  });
});

describe('compactionStep with instructions', () => {
  const big = (c: string) => c.repeat(4000);
  const heavy = (n: number): Message[] => [
    { role: 'user', parts: [{ type: 'text', text: `q${n}` }, { type: 'text', context: 'page', text: big('P') }] },
    { role: 'assistant', parts: [{ type: 'tool_call', id: `c${n}`, name: 'browser.read_page', args: {} }] },
    { role: 'tool', parts: [{ type: 'tool_result', toolCallId: `c${n}`, content: big('R') }] },
    { role: 'assistant', parts: [{ type: 'text', text: `a${n}` }] },
  ];
  const history = [1, 2, 3, 4, 5, 6].flatMap(heavy);
  const ctx = { used: messagesTokens(history), window: 24000, canSummarize: true, auto: false };

  it('summarizes even when trimming alone would reach the target', () => {
    const cfg = compactionOf(undefined);
    expect(compactionStep(history, cfg, ctx)).toMatchObject({ at: 8, summarize: false });
    expect(compactionStep(history, cfg, { ...ctx, force: true })).toMatchObject({ at: 8, turns: 2, summarize: true });
    expect(compactionStep(history, cfg, { used: 0, canSummarize: true, auto: true, force: true })).toMatchObject({ at: 8, summarize: true });
  });

  it('does not summarize when summaries are off', () => {
    expect(compactionStep(history, compactionOf({ summarize: false }), { ...ctx, force: true })).toMatchObject({ summarize: false });
  });
});

describe('the compaction mark', () => {
  const c: Compaction = { at: 1, turns: 2, trimmed: ALL_PARTS, before: 10, after: 2 };
  it('shows the instructions its summary was given, after why it fell short', () => {
    expect(compactionMarkTitle(c)).toBeUndefined();
    expect(compactionMarkTitle({ ...c, instructions: 'keep the prices' })).toBe('Instructions: "keep the prices"');
    expect(compactionMarkTitle({ ...c, short: { percent: 70, target: 40, fixed: 60 }, instructions: 'keep the prices' }))
      .toBe('It got the context to 70% of the window, not under its target of 40%: the system prompt and the tools alone take 60%.\nInstructions: "keep the prices"');
  });
});
