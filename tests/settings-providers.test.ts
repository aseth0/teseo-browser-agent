// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSecretDb, fakeStorage, mockFetch } from './fakes/browser';
import { buttonNamed, pageBrowser, pageGlobals, settle, typeInto } from './fakes/panel';

// Settings → Providers, on the Options page: one added from the list becomes the chat's when it has
// none; its key is kept as a secret, never in storage.local; Test connection says what the server
// answered; removing the chat's asks first, saying so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
pageGlobals();
const storage = fakeStorage();
const secrets = fakeSecretDb();
const fake = pageBrowser(storage);
vi.mock('../src/storage/secret-db', () => secrets);
vi.mock('wxt/browser', () => ({ browser: fake.browser }));

const { loadSettings, saveSettings } = await import('../src/storage/settings');
const { Options } = await import('../src/entrypoints/options/Options');

let root: Root;
let box: HTMLElement;
async function open() {
  history.replaceState(null, '', '/options.html#providers');
  box = document.body.appendChild(document.createElement('div'));
  root = createRoot(box);
  await act(async () => root.render(createElement(Options)));
  await settle(20);
}
const listed = () => [...box.querySelectorAll('nav[aria-label="Providers"] button')].map((b) => b.firstElementChild!.textContent);
const field = (label: string) => box.querySelector<HTMLInputElement>(`main [aria-label="${label}"]`)!;
async function add(preset: string) {
  const select = box.querySelector<HTMLSelectElement>('select[aria-label="Add a provider"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, preset);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
}
const click = async (el: HTMLElement) => {
  await act(async () => el.click());
  await settle();
};
const local = { id: 'p', name: 'Local', baseURL: 'https://llm.test/v1', apiKey: '', defaultModel: 'm' };

beforeEach(() => {
  storage.reset();
  secrets.data.clear();
});
afterEach(() => {
  act(() => root.unmount());
  box.remove();
});

describe('Settings → Providers', () => {
  it('one added from the list is shown and becomes the chat\'s, the first one', async () => {
    await open();
    expect(listed()).toEqual([]);
    await add('Groq');
    expect(listed()).toEqual(['Groq']);
    expect(field('Base URL').value).toBe('https://api.groq.com/openai/v1');
    const stored = await loadSettings();
    expect(stored.providers.map((p) => p.name)).toEqual(['Groq']);
    expect(stored.activeProviderId).toBe(stored.providers[0]!.id);
    await add('OpenAI');
    expect((await loadSettings()).activeProviderId).toBe(stored.providers[0]!.id); // a second one does not take its place
    expect(field('Name').value).toBe('OpenAI'); // shown once added
  });

  it('its key is kept as a secret, not in storage.local', async () => {
    await saveSettings({ ...(await loadSettings()), providers: [local], activeProviderId: 'p' });
    await open();
    await typeInto(field('API key'), 'sk-very-secret');
    await settle();
    expect((await loadSettings()).providers[0]!.apiKey).toBe('sk-very-secret');
    expect(JSON.stringify(storage.local.data)).not.toContain('sk-very-secret');
    expect(JSON.stringify(storage.session.data)).not.toContain('sk-very-secret');
  });

  it('Test connection says how many models the server lists, or why it failed', async () => {
    await saveSettings({ ...(await loadSettings()), providers: [local], activeProviderId: 'p' });
    await open();
    mockFetch({ '/models': new Response(JSON.stringify({ data: [{ id: 'm' }, { id: 'n' }] }), { status: 200 }) });
    await click(buttonNamed(box, 'Test connection')!);
    expect(box.querySelector('main')!.textContent).toContain('OK · 2 models');
    mockFetch(new Response('{"error":{"message":"Invalid API key"}}', { status: 401 }));
    await click(buttonNamed(box, 'Test connection')!);
    const main = box.querySelector('main')!.textContent!;
    expect(main).toContain('Error: ');
    expect(main).not.toContain('OK · 2 models');
    expect(main).toContain('1 failed');
  });

  it("removing the chat's provider asks first, saying the chat uses it", async () => {
    await saveSettings({ ...(await loadSettings()), providers: [local, { ...local, id: 'q', name: 'Other' }], activeProviderId: 'p' });
    await open();
    await click(buttonNamed(box, 'Remove')!);
    const ask = box.querySelector('[role="group"][aria-label="Remove? The chat uses it."]')!;
    expect(ask).not.toBeNull();
    expect((await loadSettings()).providers).toHaveLength(2);
    await click(buttonNamed(ask, 'Remove')!);
    expect((await loadSettings()).providers.map((p) => p.id)).toEqual(['q']);
    expect(listed()).toEqual(['Other']);
  });

  it('another provider picked in the list is shown, and edits go to it alone', async () => {
    await saveSettings({ ...(await loadSettings()), providers: [local, { ...local, id: 'q', name: 'Other' }], activeProviderId: 'p' });
    await open();
    await click([...box.querySelectorAll<HTMLButtonElement>('nav[aria-label="Providers"] button')][1]!);
    await typeInto(field('Base URL'), 'https://other.test/v1');
    await settle();
    expect((await loadSettings()).providers.map((p) => p.baseURL)).toEqual(['https://llm.test/v1', 'https://other.test/v1']);
  });
});
