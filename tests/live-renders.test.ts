// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { Message } from '../src/core/types';
import type { PageTarget } from '../src/entrypoints/sidepanel/usePageTarget';
import type { Settings } from '../src/storage/settings';

// Streamed text re-renders only what shows it, not the component that holds the conversation (and
// with it the whole chat). Measured: 200 tokens rendered the chat 200 times before the live store.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let deliver!: (m: unknown) => void;
const port = () => ({ postMessage: () => undefined, disconnect: () => undefined, onMessage: { addListener: (f: (m: unknown) => void) => (deliver = f) }, onDisconnect: { addListener: () => undefined } });
const saved: { id: string; history: Message[] }[] = [];
vi.mock('wxt/browser', () => ({ browser: { runtime: { connect: port } } }));
vi.mock('../src/history/store', () => ({
  listConversations: async () => [],
  loadConversation: async () => undefined,
  saveConversation: async (c: { id: string; history: Message[] }) => void saved.push(c),
  onConversationsDeleted: () => () => undefined,
}));
vi.mock('../src/entrypoints/sidepanel/AgentPicker', () => ({ useActiveAgent: () => ({ agents: [], agent: undefined }) }));
const { useAgent } = await import('../src/entrypoints/sidepanel/useAgent');
const { useLive } = await import('../src/entrypoints/sidepanel/agent-store');
const { useHistory } = await import('../src/entrypoints/sidepanel/useHistory');

const settings = { providers: [], history: { enabled: true } } as unknown as Settings;
const page = { tabId: 1, url: 'https://example.com/', access: 'ok' } as PageTarget;
const run = { providerId: 'p', model: 'm' } as never;
let agent: ReturnType<typeof useAgent>;
const renders = { owner: 0, live: 0 };
let shown = '';
function Streaming() {
  const segments = useLive(agent.live);
  renders.live++;
  shown = segments.map((s) => s.text).join('');
  return null;
}
function Owner() {
  agent = useAgent();
  useHistory(agent, settings, page, () => undefined, () => false);
  renders.owner++;
  return createElement(Streaming);
}

describe('the streamed text', () => {
  it('renders only what shows it', async () => {
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(createElement(Owner)));
    act(() => agent.send('Hi', run));
    const before = { ...renders };
    for (let i = 0; i < 200; i++) act(() => deliver({ type: 'text-delta', text: 'x' }));
    expect(renders.owner - before.owner).toBe(0);
    expect(renders.live - before.live).toBe(200);
    expect(shown).toBe('x'.repeat(200));
    act(() => deliver({ type: 'message', message: { role: 'assistant', parts: [{ type: 'text', text: 'x'.repeat(200) }] } }));
    expect(renders.owner - before.owner).toBe(1);
    expect(shown).toBe('');
    act(() => root.unmount());
  });

  it('is saved with its conversation when another replaces it mid-turn', async () => {
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(createElement(Owner)));
    act(() => agent.send('Hi', run));
    const left = agent.conversationId;
    act(() => deliver({ type: 'text-delta', text: 'Half an ans' }));
    act(() => deliver({ type: 'text-delta', text: 'wer' }));
    await act(async () => agent.open('other', []));
    const kept = saved.findLast((c) => c.id === left); // the latest save of it: what is kept
    expect(kept?.history.at(-1)?.parts).toEqual([expect.objectContaining({ type: 'text', text: 'Half an answer' })]);
    act(() => root.unmount());
  });
});
