import { describe, expect, it } from 'vitest';
import { markStopped } from '../src/core/messages';
import { text } from '../src/core/model-texts';
import type { Message } from '../src/core/types';
import { modelView } from '../src/context/compaction';
import { toOpenAIMessages } from '../src/providers/wire';

const sent = (history: Message[]) => toOpenAIMessages(undefined, modelView(undefined, history).messages);

const user: Message = { role: 'user', parts: [{ type: 'text', text: 'hi' }] };

describe('markStopped', () => {
  it('keeps what was streamed as a stopped assistant message', () => {
    const out = markStopped([user], [
      { kind: 'reasoning', text: 'thinking' },
      { kind: 'text', text: 'half an ans' },
    ]);
    expect(out).toEqual([
      user,
      { role: 'assistant', parts: [{ type: 'reasoning', text: 'thinking' }, { type: 'text', text: 'half an ans' }], stopped: true },
    ]);
  });

  it('marks a turn interrupted by a message sent at once', () => {
    expect(markStopped([user], [], true)).toEqual([{ ...user, stopped: true, interrupted: true }]);
  });

  it('marks the last message when nothing was streamed', () => {
    expect(markStopped([user], [])).toEqual([{ ...user, stopped: true }]);
    expect(markStopped([], [])).toEqual([]);
  });

  it('answers tool calls left without results, so the history stays valid', () => {
    const calling: Message = { role: 'assistant', parts: [{ type: 'tool_call', id: 'c1', name: 'browser__click', args: {} }] };
    const out = markStopped([user, calling], []);
    expect(out[2]).toEqual({
      role: 'tool',
      parts: [{ type: 'tool_result', toolCallId: 'c1', content: text('result.stopped'), isError: true }],
      stopped: true,
    });
  });
});

describe('markStopped, with the results of the calls that ended', () => {
  const calling: Message = { role: 'assistant', parts: ['c1', 'c2', 'c3'].map((id) => ({ type: 'tool_call' as const, id, name: 'browser__click', args: {} })) };
  const done = (id: string) => ({ type: 'tool_result' as const, toolCallId: id, content: `${id} clicked` });
  const stopped = (id: string) => ({ type: 'tool_result' as const, toolCallId: id, content: text('result.stopped'), isError: true });

  it('keeps them, in the calls\' order, and says the others were stopped', () => {
    const out = markStopped([user, calling], [], false, [done('c1')]);
    expect(out[2]).toEqual({ role: 'tool', parts: [done('c1'), stopped('c2'), stopped('c3')], stopped: true });
  });

  it('never answers a call twice, nor one of an earlier step', () => {
    const answered: Message = { role: 'tool', parts: [done('c1')] };
    expect(markStopped([user, calling, answered], [], false, [done('c1')])).toEqual([user, calling, { ...answered, stopped: true }]);
    expect(markStopped([user, calling], [], false, [done('c1'), done('c1'), done('x9')])[2]).toEqual({ role: 'tool', parts: [done('c1'), stopped('c2'), stopped('c3')], stopped: true });
  });
});

describe('the model hears that the previous turn was stopped', () => {
  it('prepends a note to the next user message', () => {
    const history: Message[] = [user, { role: 'assistant', parts: [{ type: 'text', text: 'half' }], stopped: true }, { role: 'user', parts: [{ type: 'text', text: 'go on' }] }];
    const wire = sent(history) as { role: string; content: string }[];
    expect(wire[1]).toEqual({ role: 'assistant', content: 'half' });
    expect(wire[2]!.content).toBe(`${text('user.stopped')}\n\ngo on`);
  });

  it('leaves out a stopped answer that was only thinking (servers reject an empty one), and still tells the model', () => {
    const history = markStopped([user], [{ kind: 'reasoning', text: 'thinking' }]).concat({ role: 'user', parts: [{ type: 'text', text: 'go on' }] });
    const wire = sent(history) as { role: string; content: string }[];
    expect(wire.map((m) => m.role)).toEqual(['user', 'user']);
    expect(wire[1]!.content).toBe(`${text('user.stopped')}\n\ngo on`);
  });

  it('says it was interrupted, not stopped, when a message was sent at once', () => {
    const history = markStopped([user], [{ kind: 'text', text: 'half' }], true).concat({ role: 'user', parts: [{ type: 'text', text: 'also this' }] });
    const wire = sent(history) as { role: string; content: string }[];
    expect(wire[2]!.content).toBe(`${text('user.interrupted')}\n\nalso this`);
  });

  it('says nothing when the turn was not stopped', () => {
    const wire = toOpenAIMessages(undefined, [user, { role: 'assistant', parts: [{ type: 'text', text: 'ok' }] }, user]) as { content: string }[];
    expect(wire[2]!.content).toBe('hi');
  });
});
