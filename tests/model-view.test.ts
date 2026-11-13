import { describe, expect, it } from 'vitest';
import { ALL_PARTS, modelView } from '../src/context/compaction';
import { text } from '../src/core/model-texts';
import type { Compaction, Message } from '../src/core/types';
import { toOpenAIMessages } from '../src/providers/wire';

// What goes on the wire: the request as the model gets it (modelView), then translated.
const wire = (system: string | undefined, history: Message[]) => {
  const view = modelView(system, history);
  return toOpenAIMessages(view.system, view.messages);
};

const long = 'x'.repeat(500);
const turn = (n: number): Message[] => [
  { role: 'user', parts: [{ type: 'text', text: `q${n}` }, { type: 'text', context: 'page', source: 'page-block', text: long }] },
  { role: 'assistant', parts: [{ type: 'reasoning', text: 'r' }, { type: 'tool_call', id: `c${n}`, name: 'browser.read_page', args: {} }] },
  { role: 'tool', parts: [{ type: 'tool_result', toolCallId: `c${n}`, content: long }] },
  { role: 'assistant', parts: [{ type: 'text', text: `a${n}` }] },
];
const compaction = (c: Partial<Compaction> = {}): Compaction => ({ at: 1, turns: 1, trimmed: ALL_PARTS, before: 0, after: 0, ...c });
const compactedAt = (history: Message[], at: number, c: Compaction) => history.map((m, i) => (i === at ? { ...m, compaction: c } : m));
const stoppedNote = `${text('user.stopped')}\n\n`;

describe('the request as the model gets it', () => {
  it('goes with the earlier turns trimmed', () => {
    const history = compactedAt([...turn(1), ...turn(2)], 4, compaction());
    const trimmed = (what: string) => text('compaction.trimmed', { what, chars: '500' });
    expect(wire('Sys', history)).toEqual([
      { role: 'system', content: 'Sys' },
      { role: 'user', content: `q1\n${trimmed('page content')}` },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'browser.read_page', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: trimmed('the result of browser__read_page') },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: `q2\n${long}` },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c2', type: 'function', function: { name: 'browser.read_page', arguments: '{}' } }], reasoning: 'r' }, // since the last message: its reasoning too
      { role: 'tool', tool_call_id: 'c2', content: long },
      { role: 'assistant', content: 'a2' },
    ]);
  });

  it('goes with a summary in place of the earlier turns, and the system prompt saying what it is', () => {
    const history = compactedAt([...turn(1), ...turn(2)], 4, compaction({ summary: 'S' }));
    const summary = text('compaction.summary', { turns: '1', summary: 'S' });
    expect(wire('Sys', history).slice(0, 2)).toEqual([
      { role: 'system', content: `Sys\n\n${text('system.compaction')}` },
      { role: 'user', content: `${summary}\nq2\n${long}` },
    ]);
    expect(wire(undefined, history)[0]).toEqual({ role: 'system', content: text('system.compaction') });
  });

  it('tells the model, before your message, that you stopped the turn before', () => {
    const history: Message[] = [
      { role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'half' }], stopped: true },
      { role: 'user', parts: [{ type: 'text', text: 'go on' }, { type: 'text', context: 'page', text: 'page' }] },
      { role: 'assistant', parts: [{ type: 'reasoning', text: 'only thinking' }], stopped: true },
      { role: 'user', parts: [{ type: 'image', mediaType: 'image/png', data: 'AA' }, { type: 'image', mediaType: 'image/png', data: '' }] }, // one not kept
      { role: 'assistant', parts: [{ type: 'text', text: 'ok' }], stopped: true },
      { role: 'user', parts: [{ type: 'text', text: '' }] },
    ];
    expect(wire(undefined, history)).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'half' },
      { role: 'user', content: `${stoppedNote}go on\npage` },
      {
        role: 'user',
        content: [
          { type: 'text', text: `${stoppedNote}${text('user.image_not_kept')}` },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AA' } },
        ],
      },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: stoppedNote },
    ]);
  });

  it('leaves a history with neither as it is', () => {
    const history = turn(1);
    expect(modelView('Sys', history)).toEqual({ system: 'Sys', messages: history });
    expect(modelView('Sys', history).messages).toBe(history);
  });
});
