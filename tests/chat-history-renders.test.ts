// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { Message } from '../src/core/types';

// Each message added (and each flip of `running`) renders the conversation again: the earlier
// messages' Markdown is not parsed again. Before, a 150-message chat re-ran react-markdown 150 times.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const parsed: string[] = [];
vi.mock('../src/ui/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => {
    parsed.push(text);
    return createElement('div', null, text);
  },
}));
vi.mock('../src/ui/useCollection', () => ({ useCollection: () => [] }));
const { ChatHistory } = await import('../src/ui/ChatMessages');

const user = (text: string): Message => ({ role: 'user', parts: [{ type: 'text', text }] });
const answer = (text: string): Message => ({ role: 'assistant', parts: [{ type: 'text', text }] });
const calling: Message = { role: 'assistant', parts: [{ type: 'tool_call', id: 'c1', name: 'browser__find', args: {} }] };
const result: Message = { role: 'tool', parts: [{ type: 'tool_result', toolCallId: 'c1', content: 'ok' }] };

describe('the conversation as it grows', () => {
  for (const [name, grouped] of [['inline', false], ['grouped', true]] as const)
    it(`renders an earlier message once (${name})`, async () => {
      const { ChatViewContext } = await import('../src/ui/chat/contexts');
      const root = createRoot(document.createElement('div'));
      const show = (history: Message[], running: boolean) =>
        act(() => root.render(createElement(ChatViewContext.Provider, { value: grouped ? { steps: 'grouped' } : { steps: 'inline' } },
          createElement(ChatHistory, { history, results: new Map(), running, format: 'markdown' }))));
      const first = [user('first question'), calling, result, answer('first answer')];
      parsed.length = 0;
      show(first, false);
      expect(parsed.filter((t) => t === 'first answer')).toHaveLength(1);
      show([...first, user('second question')], true);
      show([...first, user('second question'), answer('second answer')], true);
      show([...first, user('second question'), answer('second answer')], false);
      expect(parsed.filter((t) => t === 'first answer')).toHaveLength(1);
      expect(parsed.filter((t) => t === 'first question')).toHaveLength(1);
      act(() => root.unmount());
    });
});
