// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

// The message box parses the mentions in its text once per text, not on every render of the chat.
// Measured: 50 renders of the chat with the same text parsed it 50 times before the memo.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const parsed = vi.fn();
vi.mock('../src/templates/mentions', async (actual) => {
  const real = await actual<typeof import('../src/templates/mentions')>();
  return { ...real, parseMentions: (...args: Parameters<typeof real.parseMentions>) => (parsed(), real.parseMentions(...args)) };
});
const none: never[] = [];
vi.mock('../src/ui/templates/useTemplates', () => ({ useTemplates: () => none }));
vi.mock('../src/ui/Skills', () => ({ useSkills: () => none }));
vi.mock('../src/ui/useConversations', () => ({ useConversations: () => none }));
vi.mock('../src/ui/useBookmarks', () => ({ useBookmarks: () => none }));
const { MentionComposer } = await import('../src/entrypoints/sidepanel/MentionComposer');

const onChange = () => undefined;
const onSend = () => undefined;
const tools: never[] = [];
let rerender!: () => void;
let type!: (text: string) => void;
function Chat() {
  const [, setTick] = useState(0);
  const [text, setText] = useState('Hi ::shop');
  rerender = () => setTick((n) => n + 1);
  type = setText;
  return createElement(MentionComposer, { value: text, onChange, onSend, placeholder: '', tools });
}

describe('the message box', () => {
  it('parses its text once per text', async () => {
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(createElement(Chat)));
    parsed.mockClear();
    for (let i = 0; i < 50; i++) act(() => rerender());
    expect(parsed).toHaveBeenCalledTimes(0);
    act(() => type('Hi ::shop/cart'));
    expect(parsed).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  // While the agent works Enter queues; Ctrl/⌘+Enter stops it and sends (sidepanel/send-queue).
  it('sends at once with Ctrl or ⌘ and Enter', async () => {
    const send = vi.fn();
    const sendNow = vi.fn();
    const div = document.createElement('div');
    const root = createRoot(div);
    await act(async () => root.render(createElement(MentionComposer, { value: 'go', onChange, onSend: send, onSendNow: sendNow, placeholder: '', tools })));
    const box = div.querySelector('textarea')!;
    const press = (init: KeyboardEventInit) => act(() => void box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, ...init })));
    press({});
    press({ ctrlKey: true });
    press({ metaKey: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(sendNow).toHaveBeenCalledTimes(2);
    act(() => root.unmount());
  });
});
