// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSecretDb, fakeStorage, mockFetch } from './fakes/browser';
import { buttonNamed, pageBrowser, pageGlobals, settle, typeInto } from './fakes/panel';
import type { Message } from '../src/core/types';

// The message box and what it sends (useSendPipeline, the send queue), in the side panel as a whole:
// a message written while the agent works waits for the turn to end, "send now" stops it and sends,
// what you attach goes with the message, and a mention picked from the list goes as written.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
pageGlobals();
const storage = fakeStorage();
const secrets = fakeSecretDb();
const fake = pageBrowser(storage);
vi.mock('../src/storage/secret-db', () => secrets);
vi.mock('wxt/browser', () => ({ browser: fake.browser }));

const { saveSettings, loadSettings } = await import('../src/storage/settings');
const { saveConversation } = await import('../src/history/store');
const { PORT_NAME } = await import('../src/core/protocol');
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
const textarea = () => box.querySelector<HTMLTextAreaElement>('.composer textarea')!;
const button = (name: string) => buttonNamed(box, name);
const press = (init: KeyboardEventInit) => act(async () => void textarea().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init })));
async function send(text: string) {
  await typeInto(textarea(), text);
  await press({});
}
// The paperclip's file picker: behind the bar's ⋯ in jsdom, which lays out nothing.
async function attach(file: File) {
  await act(async () => button('More: message box buttons')!.click());
  const input = box.querySelector<HTMLInputElement>('input[type="file"][aria-label="Files to attach"]')!;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => void input.dispatchEvent(new Event('change', { bubbles: true })));
  await settle();
}
const agentPort = () => fake.port(PORT_NAME)!;
type Run = { type: 'run'; history: Message[]; runId: number; kept?: unknown[] };
const runs = () => agentPort().posted.filter((m) => (m as { type: string }).type === 'run') as Run[];
const emit = (event: object) => act(async () => agentPort().send({ ...event, runId: runs().at(-1)!.runId }));
const lastText = (run: Run) => run.history.at(-1)!.parts.find((p) => p.type === 'text' && !p.context) as { text: string } | undefined;
async function answer(text: string) {
  await emit({ type: 'message', message: { role: 'assistant', parts: [{ type: 'text', text }] } });
  await emit({ type: 'done' });
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

describe('the message box while the agent works', () => {
  it('Enter queues the message, shown above the box, and it goes when the turn ends', async () => {
    await open();
    await send('First');
    await send('Second');
    expect(runs()).toHaveLength(1);
    expect(textarea().value).toBe('');
    expect(box.querySelector('[role="group"][aria-label="Queued"]')!.textContent).toContain('Second');
    await answer('One');
    expect(runs()).toHaveLength(2);
    expect(lastText(runs()[1]!)?.text).toBe('Second');
    expect(runs()[1]!.history.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(box.querySelector('[aria-label="Queued"]')).toBeNull();
  });

  it('a queued message goes back to the box when the turn is stopped', async () => {
    await open();
    await send('First');
    await send('Later');
    await act(async () => button('Stop')!.click());
    expect(runs()).toHaveLength(1);
    expect(textarea().value).toBe('Later');
    expect(box.querySelector('[aria-label="Queued"]')).toBeNull();
  });

  it('Ctrl+Enter stops the turn and sends the message at once, the model told it was interrupted', async () => {
    await open();
    await send('Slow task');
    await emit({ type: 'text-delta', text: 'Working on' });
    await typeInto(textarea(), 'Do this instead');
    await press({ ctrlKey: true });
    const posted = agentPort().posted.map((m) => (m as { type: string }).type);
    expect(posted.slice(-2)).toEqual(['stop', 'run']);
    const run = runs().at(-1)!;
    expect(lastText(run)?.text).toBe('Do this instead');
    expect(run.history[1]).toMatchObject({ role: 'assistant', parts: [{ type: 'text', text: 'Working on' }], stopped: true, interrupted: true });
  });

  it('a queued one sent now from its strip goes in place of the turn; the others stay queued', async () => {
    await open();
    await send('First');
    await send('Second');
    await send('Third');
    const strip = box.querySelector('[aria-label="Queued"]')!;
    await act(async () => strip.querySelectorAll<HTMLButtonElement>('[aria-label="Stop the agent and send this now"]')[1]!.click());
    expect(lastText(runs().at(-1)!)?.text).toBe('Third');
    expect(box.querySelector('[aria-label="Queued"]')!.textContent).toContain('Second');
    expect(box.querySelector('[aria-label="Queued"]')!.textContent).not.toContain('Third');
  });
});

describe('what goes with a message', () => {
  it('a text file attached goes with it, and the strip is emptied once sent', async () => {
    await open();
    await attach(new File(['size: 42\ncolor: red'], 'notes.txt', { type: 'text/plain' }));
    expect(box.querySelector('.attachments')!.textContent).toContain('notes.txt');
    await send('Summarize the file');
    const parts = runs()[0]!.history[0]!.parts;
    expect(parts[0]).toMatchObject({ type: 'text', text: 'Summarize the file' });
    expect(parts.some((p) => p.type === 'text' && p.text.includes('color: red'))).toBe(true);
    expect(box.querySelector('.attachments')).toBeNull();
  });

  it('only a file attached, with no text, can be sent', async () => {
    await open();
    expect(button('Send')!.disabled).toBe(true);
    await attach(new File(['a,b'], 'table.csv', { type: 'text/csv' }));
    expect(button('Send')!.disabled).toBe(false);
  });

  it('a saved conversation picked from the # list shows as a chip and goes as its mention', async () => {
    await saveConversation({ id: 'old', createdAt: 1, updatedAt: 1, history: [{ role: 'user', parts: [{ type: 'text', text: 'Shoe sizes' }] }] });
    await open();
    await typeInto(textarea(), 'Compare with #sho');
    const option = [...box.querySelectorAll<HTMLElement>('[role="listbox"] [role="option"]')].find((o) => o.textContent?.includes('Shoe sizes'))!;
    await act(async () => void option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })));
    expect(textarea().value).toBe('Compare with #shoe-sizes ');
    expect(box.querySelector('.mention-chips')!.textContent).toContain('Shoe sizes');
    await press({});
    expect(lastText(runs()[0]!)?.text).toBe('Compare with #shoe-sizes');
  });
});
