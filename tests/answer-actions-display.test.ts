// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { Message } from '../src/core/types';
import { DISPLAY_DEFAULTS, type DisplayValues } from '../src/core/display-defs';

// Under the answer, the agent that gave it and the turn's tokens and time, as Settings → Display says;
// a change shows on the answers already in the chat.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../src/ui/useCollection', () => ({ useCollection: () => [{ id: 'a1', name: 'Shopper' }] }));
const { ChatHistory } = await import('../src/ui/ChatMessages');
const { DisplayContext } = await import('../src/ui/chat/contexts');

const history: Message[] = [
  { role: 'user', agent: 'a1', parts: [{ type: 'text', text: 'find shoes' }] },
  { role: 'assistant', parts: [{ type: 'text', text: 'Here they are' }], meta: { input: 1200, output: 80, reported: true, ms: 900, sinceStartMs: 1500 } },
];

describe('the row under the answer', () => {
  it('shows or hides the agent and the stats', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const show = (display: Partial<DisplayValues>) =>
      act(() => root.render(createElement(DisplayContext.Provider, { value: { ...DISPLAY_DEFAULTS, ...display } },
        createElement(ChatHistory, { history, results: new Map(), running: false, format: 'plain' }))));
    show({});
    expect(host.querySelector('.msg-agent')!.textContent).toBe('Shopper');
    expect(host.querySelector('.msg-stats')!.textContent).toContain('1.5');
    show({ answerAgent: 'hidden', answerStats: 'hidden' });
    expect(host.querySelector('.msg-agent')).toBeNull();
    expect(host.querySelector('.msg-stats')).toBeNull();
    act(() => root.unmount());
  });
});
