import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Message } from '../src/core/types';
import { ChatHistory, segmentsOf, turnsOf, turnStats } from '../src/ui/ChatMessages';

const user = (text: string): Message => ({ role: 'user', parts: [{ type: 'text', text }] });

describe('chat turns (steps grouped)', () => {
  it('put what the model did before its answer in the steps, and its last text as the answer', () => {
    const calling: Message = {
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: 'look for it' },
        { type: 'text', text: 'Let me search…' },
        { type: 'tool_call', id: 'c1', name: 'browser__find', args: {} },
      ],
    };
    const result: Message = { role: 'tool', parts: [{ type: 'tool_result', toolCallId: 'c1', content: 'ok' }] };
    const answer: Message = { role: 'assistant', parts: [{ type: 'reasoning', text: 'found it' }, { type: 'text', text: 'Here it is.' }] };
    const [turn] = turnsOf([user('find it'), calling, result, answer]);
    expect(turn!.user).toEqual(user('find it'));
    expect(turn!.answer).toEqual({ role: 'assistant', parts: [{ type: 'text', text: 'Here it is.' }] });
    // The text along the way stays in the steps; the answer's reasoning too.
    expect(turn!.steps).toEqual([calling, result, { role: 'assistant', parts: [{ type: 'reasoning', text: 'found it' }] }]);
  });

  it('have no answer while the model is still calling tools (or stopped at the step limit)', () => {
    const calling: Message = { role: 'assistant', parts: [{ type: 'tool_call', id: 'c1', name: 'browser__find', args: {} }] };
    const turns = turnsOf([user('a'), { role: 'assistant', parts: [{ type: 'text', text: 'Hi' }] }, user('b'), calling]);
    expect(turns.map((t) => [t.steps.length, t.answer?.parts])).toEqual([
      [0, [{ type: 'text', text: 'Hi' }]],
      [1, undefined],
    ]);
  });

  it('keep the model messages as they came, for the stats', () => {
    const answer: Message = { role: 'assistant', parts: [{ type: 'reasoning', text: 'r' }, { type: 'text', text: 'Hi' }] };
    const [turn] = turnsOf([user('a'), answer]);
    expect(turn!.messages).toEqual([answer]);
  });

  it('sum the tokens of the turn\'s calls and take the time until its last one ended', () => {
    const call = (input: number, output: number, reported: boolean, sinceStartMs: number): Message => ({
      role: 'assistant',
      parts: [],
      meta: { input, output, reported, ms: 1000, firstTokenMs: 400, sinceStartMs },
    });
    const both = turnStats([call(1200, 30, true, 1500), { role: 'tool', parts: [] }, call(1300, 20, true, 3200)]);
    expect(both!.label).toBe('↑ 2.5k · ↓ 50 · 3.2 s');
    expect(both!.detail).toContain('Call 2: 1,300 in · 20 out · 1.0 s · first token 0.4 s');
    // Any estimated call makes the totals approximate.
    expect(turnStats([call(10, 5, false, 900)])!.label).toBe('↑ ~10 · ↓ ~5 · 0.9 s');
    expect(turnStats([{ role: 'assistant', parts: [] }])).toBeUndefined();
  });

  it('keep what the model writes along the way in view, between collapsed blocks of steps', () => {
    const first: Message = { role: 'assistant', parts: [{ type: 'reasoning', text: 'r1' }, { type: 'text', text: 'Probing the DOM.' }, { type: 'tool_call', id: 'c1', name: 'templates__run', args: {} }] };
    const result: Message = { role: 'tool', parts: [{ type: 'tool_result', toolCallId: 'c1', content: 'ok' }] };
    const second: Message = { role: 'assistant', parts: [{ type: 'reasoning', text: 'r2' }, { type: 'tool_call', id: 'c2', name: 'templates__run', args: {} }] };
    const segments = segmentsOf([first, result, second]);
    expect(segments.map((s) => (s.kind === 'text' ? `text:${(s.message.parts[0] as { text: string }).text}` : `steps:${s.messages.length}`))).toEqual([
      'steps:1', // the first reasoning
      'text:Probing the DOM.',
      'steps:3', // its call, the result, then the second reasoning and call
    ]);
  });
});

describe('chat layers', () => {
  it('go with every message of the history once, at its last piece; those a block of steps folds, together on its line', () => {
    const calling: Message = { role: 'assistant', parts: [{ type: 'reasoning', text: 'think' }, { type: 'text', text: 'Going' }, { type: 'tool_call', id: 'c1', name: 'x', args: {} }] };
    const result: Message = { role: 'tool', parts: [{ type: 'tool_result', toolCallId: 'c1', content: 'ok' }] };
    const answer: Message = { role: 'assistant', parts: [{ type: 'reasoning', text: 'again' }, { type: 'text', text: 'Done' }] };
    const history = [user('hi'), calling, result, answer];
    const html = renderToStaticMarkup(
      createElement(ChatHistory, {
        history,
        results: new Map(),
        running: false,
        format: 'plain',
        layers: { trailing: (ms) => `[layers of ${ms.map((m) => history.indexOf(m)).join(',')}]`, below: () => null },
      }),
    );
    expect(html.match(/\[layers of [-\d,]+\]/g)).toEqual(['[layers of 0]', '[layers of 1,2]', '[layers of 3]']);
    // Yours and the answer's, in the row of their actions.
    expect(html).toMatch(/<div class="msg-actions user">\[layers of 0\]/);
    expect(html).toMatch(/<div class="msg-actions">\[layers of 3\]/);
    // The answer that called the tool and its result: once, on the line of the block they are folded in.
    expect(html).toMatch(/<summary>(?:(?!<\/summary>).)*<span class="layer-chips">\[layers of 1,2\]<\/span><\/summary>/); // after the icons and counts
  });
});

describe('a compaction in the chat', () => {
  it('has its divider where the turns it kept start, and its mark where the chat was when it ran', () => {
    const say = (text: string): Message => ({ role: 'assistant', parts: [{ type: 'text', text }] });
    const compaction = { at: 1, turns: 1, trimmed: { pages: true, toolResults: true, screenshots: false }, before: 4200, after: 300, ranAfter: 4 };
    const history = [user('one'), say('A1'), { ...user('two'), compaction }, say('A2'), user('three'), say('A3')];
    const html = renderToStaticMarkup(createElement(ChatHistory, { history, results: new Map(), running: false, format: 'plain' }));
    const at = (s: string) => html.indexOf(s);
    expect(at('A1')).toBeLessThan(at('class="compaction-divider"'));
    expect(at('class="compaction-divider"')).toBeLessThan(at('two'));
    expect(at('A2')).toBeLessThan(at('class="compaction-mark"'));
    expect(at('class="compaction-mark"')).toBeLessThan(at('three'));
    expect(html).toContain('Compacted here · 1 turn · ~4.2k → ~300 tokens');
  });
});

describe('the calls the layers show', () => {
  it('go compacted only once the compaction ran', async () => {
    const { callsOf } = await import('../src/ui/calls/calls');
    const say = (text: string): Message => ({ role: 'assistant', parts: [{ type: 'text', text }] });
    const compaction = { at: 1, turns: 2, trimmed: { pages: true, toolResults: true, screenshots: false }, summary: 'S', before: 900, after: 30, ranAfter: 6 };
    const history = [user('one'), say('A1'), user('two'), say('A2'), { ...user('three'), compaction }, say('A3'), user('four'), say('A4')];
    expect(callsOf(history).map((c) => c.history.some((m) => m.compaction))).toEqual([false, false, false, true]);
  });
});

describe('a compaction that trimmed the latest turn and fell short', () => {
  it('says what it trimmed below its divider, and why it fell short', () => {
    const say = (text: string): Message => ({ role: 'assistant', parts: [{ type: 'text', text }] });
    const compaction = { at: 1, turns: 0, trimmed: { pages: true, toolResults: true, screenshots: false }, inner: 6, before: 9000, after: 4000, ranAfter: 2, short: { percent: 55, target: 40, fixed: 48 } };
    const html = renderToStaticMarkup(createElement(ChatHistory, { history: [{ ...user('go'), compaction }, say('done')], results: new Map(), running: false, format: 'plain' }));
    expect(html).toContain('Compacted here · 6 older messages in its turn · ~9.0k → ~4.0k tokens · still 55%');
    expect(html).toContain('Below, the first 6 messages go without their page blocks, tool results too');
    expect(html).toContain('the system prompt and the tools alone take 48%');
  });
});
