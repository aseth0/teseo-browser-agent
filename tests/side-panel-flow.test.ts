// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSecretDb, fakeStorage, mockFetch } from './fakes/browser';
import { buttonNamed, pageBrowser, pageGlobals, settle, typeInto } from './fakes/panel';
import type { Message } from '../src/core/types';

// The side panel as a whole (App and its Chat) over a fake background: what you send, what streams
// back, Stop, a confirm card, a lost background, and the saved conversation.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
pageGlobals();
const storage = fakeStorage();
const secrets = fakeSecretDb();
const fake = pageBrowser(storage);
vi.mock('../src/storage/secret-db', () => secrets);
vi.mock('wxt/browser', () => ({ browser: fake.browser }));

const { saveSettings, loadSettings } = await import('../src/storage/settings');
const { PORT_NAME } = await import('../src/core/protocol');
const { saveConversation } = await import('../src/history/store');
const { App } = await import('../src/entrypoints/sidepanel/App');

const provider = { id: 'p', name: 'Local', baseURL: 'https://llm.test/v1', apiKey: 'sk-test', defaultModel: 'm' };

let root: Root;
let box: HTMLElement;
async function open() {
  box = document.body.appendChild(document.createElement('div'));
  root = createRoot(box);
  await act(async () => root.render(createElement(App)));
  await settle(20);
}

beforeEach(async () => {
  storage.reset();
  secrets.data.clear();
  mockFetch(new Response(JSON.stringify({ data: [{ id: 'm' }] }), { status: 200 }));
  await saveSettings({ ...(await loadSettings()), providers: [provider], activeProviderId: 'p' });
});
afterEach(() => {
  act(() => root.unmount());
  box.remove();
});

const flush = () => settle();
const button = (name: string) => buttonNamed(box, name);
async function send(text: string) {
  await typeInto(box.querySelector('.composer textarea')!, text);
  await act(async () => button('Send')!.click());
}
const agentPort = () => fake.port(PORT_NAME)!;
const runs = () => agentPort().posted.filter((m) => (m as { type: string }).type === 'run') as { type: 'run'; history: Message[]; conversationId: string; runId: number }[];
// The background's side: an event of the latest run.
const emit = (event: object) => act(async () => agentPort().send({ ...event, runId: runs().at(-1)!.runId }));
const stored = () => Object.entries(storage.local.data).filter(([k]) => k.startsWith('conv:')).map(([, v]) => v as { id: string; history: Message[] });
const said = (text: string): Message => ({ role: 'assistant', parts: [{ type: 'text', text }] });

describe('the side panel', () => {
  it('shows your message, sends it with the provider and model, and shows the answer as it streams', async () => {
    await open();
    await send('What is on this page?');
    expect(box.querySelector('.messages')!.textContent).toContain('What is on this page?');
    expect(runs()).toHaveLength(1);
    expect(runs()[0]).toMatchObject({ providerId: 'p', model: 'm', tabId: 1, history: [{ role: 'user', parts: [{ type: 'text', text: 'What is on this page?' }] }] });
    expect(button('Stop')).toBeDefined();
    await emit({ type: 'text-delta', text: 'A shop ' });
    await emit({ type: 'text-delta', text: 'with shoes.' });
    expect(box.querySelector('.messages')!.textContent).toContain('A shop with shoes.');
    await emit({ type: 'message', message: said('A shop with shoes.') });
    await emit({ type: 'done' });
    expect(button('Send')).toBeDefined();
    expect(box.querySelector('.messages')!.textContent).toContain('A shop with shoes.');
  });

  it('Stop keeps what was streamed, marked as stopped, and drops what the run sends after', async () => {
    await open();
    await send('Write a poem');
    await emit({ type: 'text-delta', text: 'Roses are' });
    await act(async () => button('Stop')!.click());
    expect(agentPort().posted.at(-1)).toEqual({ type: 'stop' });
    await emit({ type: 'text-delta', text: ' blue' });
    const messages = box.querySelector('.messages')!.textContent!;
    expect(messages).toContain('Roses are');
    expect(messages).not.toContain('blue');
    expect(box.querySelector('.msg-stopped')?.textContent).toBe('Stopped by you');
    await flush();
    expect(stored()[0]!.history.at(-1)).toMatchObject({ role: 'assistant', parts: [{ type: 'text', text: 'Roses are' }], stopped: true });
  });

  it('a confirm card is shown, answered, and removed', async () => {
    await open();
    await send('Add it to the cart');
    await emit({ type: 'confirm', id: 'k1', summary: 'Click "Add to cart"', host: 'shop.example.com' });
    const card = box.querySelector('[role="alertdialog"][aria-label="Confirm action"]')!;
    expect(card.textContent).toContain('Allow this action on shop.example.com?');
    expect(card.textContent).toContain('Click "Add to cart"');
    await act(async () => [...card.querySelectorAll('button')].find((b) => b.textContent === 'Deny')!.click());
    expect(agentPort().posted.at(-1)).toMatchObject({ type: 'confirm-reply', id: 'k1', decision: 'deny' });
    expect(box.querySelector('[aria-label="Confirm action"]')).toBeNull();
  });

  it('a lost background says so, and the history it leaves has no tool call without its result', async () => {
    await open();
    await send('Find the price');
    await emit({ type: 'message', message: { role: 'assistant', parts: [{ type: 'tool_call', id: 't1', name: 'browser__find', args: { text: 'price' } }] } });
    await act(async () => agentPort().lose());
    expect(box.textContent).toContain('Lost the connection to the agent. Send the message again.');
    expect(button('Send')).toBeDefined();
    await flush();
    const history = stored()[0]!.history;
    const calls = history.flatMap((m) => m.parts.flatMap((p) => (p.type === 'tool_call' ? [p.id] : [])));
    const results = history.flatMap((m) => m.parts.flatMap((p) => (p.type === 'tool_result' ? [p.toolCallId] : [])));
    expect(calls).toEqual(['t1']);
    expect(results).toEqual(['t1']);
  });

  it('saves the conversation as the turn goes and when it ends', async () => {
    await open();
    await send('Hello');
    await flush();
    expect(stored()).toHaveLength(1);
    expect(stored()[0]).toMatchObject({ id: runs()[0]!.conversationId, history: [{ role: 'user' }] });
    await emit({ type: 'message', message: said('Hi there') });
    await emit({ type: 'done' });
    await flush();
    const saved = stored()[0]!;
    expect(saved.history.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(saved.history.at(-1)).not.toHaveProperty('stopped');
    expect((storage.local.data.convIndex as { id: string; title: string }[] | undefined)?.[0]).toBeDefined();
  });

  it('opening a conversation from the history replaces the chat', async () => {
    await saveConversation({ id: 'old', createdAt: 1, updatedAt: 1, history: [{ role: 'user', parts: [{ type: 'text', text: 'Any socks?' }] }, said('Plenty of socks.')] });
    await open();
    await send('Hello');
    await emit({ type: 'message', message: said('Hi there') });
    await emit({ type: 'done' });
    // jsdom lays out nothing: the top bar's buttons are all behind its ⋯.
    await act(async () => button('More: top bar')!.click());
    await act(async () => button('Conversation history')!.click());
    await flush();
    const panel = box.querySelector('[role="dialog"][aria-label="Conversation history"]')!;
    const entry = [...panel.querySelectorAll<HTMLButtonElement>('.history-open')].find((b) => b.textContent?.includes('Any socks?'))!;
    await act(async () => entry.click());
    await flush();
    expect(box.querySelector('[aria-label="Conversation history"][role="dialog"]')).toBeNull();
    const messages = box.querySelector('.messages')!.textContent!;
    expect(messages).toContain('Plenty of socks.');
    expect(messages).not.toContain('Hi there');
    await send('More socks');
    expect(runs().at(-1)).toMatchObject({ conversationId: 'old' });
    expect(runs().at(-1)!.history.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  });
});
