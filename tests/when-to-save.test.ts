import { describe, expect, it } from 'vitest';
import type { Message } from '../src/core/types';
import { conversationToSave, type PanelConversation } from '../src/history/when-to-save';

const asked: Message[] = [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }];
const answered: Message[] = [...asked, { role: 'assistant', parts: [{ type: 'text', text: 'hello' }] }];
const saved: Message[] = [{ role: 'user', parts: [{ type: 'text', text: 'old one' }] }];
const at = (c: Partial<PanelConversation>): PanelConversation => ({ id: 'a', history: [], live: [], busy: false, ...c });

describe('conversationToSave', () => {
  it('saves when a turn ends', () => {
    expect(conversationToSave(at({ history: asked, busy: true }), at({ history: answered }))).toEqual({ id: 'a', history: answered });
  });

  it('saves at once a plan taken away between turns, and keeps it for the turn\'s end while one runs', () => {
    const plan = (dismissed?: boolean): Message[] => [...asked, { role: 'assistant', parts: [{ type: 'tool_call', id: 'p1', name: 'user__plan', args: {}, ...(dismissed && { dismissed }) }] }];
    expect(conversationToSave(at({ history: plan() }), at({ history: plan(true) }))).toEqual({ id: 'a', history: plan(true) });
    expect(conversationToSave(at({ history: plan(), busy: true }), at({ history: plan(true), busy: true }))).toBeUndefined();
    expect(conversationToSave(at({ history: plan(true) }), at({ history: plan(true) }))).toBeUndefined();
  });

  // Closing the panel mid-turn stops the run: what it did so far is kept, as a valid history.
  it('saves as stopped when a turn starts and each time a message is added while it runs', () => {
    expect(conversationToSave(at({ history: [] }), at({ history: asked, busy: true }))).toEqual({ id: 'a', history: [{ ...asked[0]!, stopped: true }], midTurn: true });
    const call: Message = { role: 'assistant', parts: [{ type: 'tool_call', id: 't1', name: 'browser.click', args: {} }] };
    const mid = conversationToSave(at({ history: asked, busy: true }), at({ history: [...asked, call], busy: true }));
    expect(mid).toMatchObject({ midTurn: true, history: [asked[0], call, { role: 'tool', stopped: true, parts: [{ type: 'tool_result', toolCallId: 't1' }] }] });
  });

  it('saves nothing as the answer streams, or when nothing ran', () => {
    expect(conversationToSave(at({ history: asked, busy: true }), at({ history: asked, busy: true, live: [{ kind: 'text', text: 'he' }] }))).toBeUndefined();
    expect(conversationToSave(at({ history: answered }), at({ history: answered }))).toBeUndefined();
  });

  it('saves the one left as stopped, under its own id, when another is opened while it runs', () => {
    const left = at({ history: asked, live: [{ kind: 'text', text: 'half' }], busy: true });
    expect(conversationToSave(left, at({ id: 'b', history: saved }))).toEqual({
      id: 'a',
      history: [...asked, { role: 'assistant', parts: [{ type: 'text', text: 'half' }], stopped: true }],
    });
  });

  it('leaves the one opened untouched when nothing was running', () => {
    expect(conversationToSave(at({ history: answered }), at({ id: 'b', history: saved }))).toBeUndefined();
  });
});
