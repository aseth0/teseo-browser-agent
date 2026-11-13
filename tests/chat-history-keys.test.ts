// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { Message } from '../src/core/types';

// Turns and messages are keyed by their message: regenerated from a turn, the new one does not get
// the old one's state (here, its block of steps left open).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../src/ui/useCollection', () => ({ useCollection: () => [] }));
const { ChatHistory } = await import('../src/ui/ChatMessages');
const { ChatViewContext } = await import('../src/ui/chat/contexts');

const user = (text: string): Message => ({ role: 'user', parts: [{ type: 'text', text }] });
const answer = (text: string): Message => ({ role: 'assistant', parts: [{ type: 'text', text }] });
const call = (id: string): Message[] => [
  { role: 'assistant', parts: [{ type: 'tool_call', id, name: 'browser__find', args: {} }] },
  { role: 'tool', parts: [{ type: 'tool_result', toolCallId: id, content: 'ok' }] },
];

describe('a turn regenerated', () => {
  it('starts with its blocks as a new turn does', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const show = (history: Message[]) =>
      act(() => root.render(createElement(ChatViewContext.Provider, { value: { steps: 'grouped' } },
        createElement(ChatHistory, { history, results: new Map(), running: false, format: 'markdown' }))));
    const first = [user('one'), ...call('c1'), answer('a1')];
    show([...first, user('two'), ...call('c2'), answer('a2')]);
    const blocks = () => [...host.querySelectorAll<HTMLDetailsElement>('details.steps')];
    blocks()[1]!.open = true;
    show([...first, user('two'), ...call('c3'), answer('a3')]);
    expect(blocks().map((d) => d.open)).toEqual([false, false]);
    act(() => root.unmount());
  });
});
