// @vitest-environment jsdom
// Settings → Memory → Semantic search: nothing can start before Test passed for this provider and model,
// and what is sent is said before it can. Its model field lists the provider's models, and that list starts nothing.
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeStorage } from './fakes/browser';
import type { Settings } from '../src/storage/settings';
import type { SettingsChange } from '../src/ui/useSettings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const storage = fakeStorage();
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));
const allowSite = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../src/ui/ask-permission', () => ({ allowSite }));

const { MeaningCard, SemanticSearchBlock } = await import('../src/ui/SemanticSearchBlock');
const { applySettingsChange } = await import('../src/ui/useSettings');

const p1 = { id: 'p1', name: 'Local', baseURL: 'https://llm.example.com/v1', apiKey: '', defaultModel: 'chat' };
const p2 = { id: 'p2', name: 'Other', baseURL: 'https://other.example.com/v1', apiKey: '', defaultModel: 'chat' };
const base = (semantic: object = {}) => ({ providers: [p1, p2], systemPrompt: '', memory: { semantic: { providerId: 'p1', model: 'embed', ...semantic } } }) as unknown as Settings;

let container: HTMLDivElement;
let current: Settings;
let replaceSettings: (next: Settings) => void;
function mount(start: Settings) {
  current = start;
  const Host = () => {
    const [settings, set] = useState(start);
    replaceSettings = (next) => set((current = next));
    // As the pages do: a change applies to the settings as they are when it is made.
    return createElement(SemanticSearchBlock, {
      settings,
      onChange: (change: SettingsChange) => set((current = applySettingsChange(current, change))),
    });
  };
  container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(createElement(Host)));
}
const toggle = () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
const testButton = () => [...container.querySelectorAll('button')].find((b) => b.textContent === 'Test')!;
const field = (label: string) => container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
const type = (el: HTMLInputElement | HTMLSelectElement, value: string) =>
  act(() => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
const clickTest = () => act(async () => testButton().click());
const semantic = () => current.memory?.semantic;

const listing = (...ids: string[]) => new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }));
const isList = (url: string) => url.endsWith('/models');
const fetchVectors = (n = 768) => vi.fn(async (url: string, _init: RequestInit) => (isList(url) ? listing() : new Response(JSON.stringify({ data: [{ index: 0, embedding: Array.from({ length: n }, () => 0.1) }] }))));

beforeEach(() => {
  storage.reset();
  allowSite.mockClear();
  vi.stubGlobal('fetch', vi.fn(async () => listing()));
});
afterEach(() => {
  container?.remove();
  vi.unstubAllGlobals();
});

describe('the switch', () => {
  it('cannot be turned on until Test passed', async () => {
    vi.stubGlobal('fetch', fetchVectors());
    mount(base());
    expect(toggle().disabled).toBe(true);
    expect(toggle().closest('label')!.title).toBe('Test the model first');
    await clickTest();
    expect(toggle().disabled).toBe(false);
    act(() => toggle().click());
    expect(semantic()?.enabled).toBe(true);
  });

  it('stays off when Test fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    mount(base());
    await clickTest();
    expect(toggle().disabled).toBe(true);
    expect(container.textContent).toContain('404');
  });

  it('turns off when the model changes, and asks for Test again', async () => {
    vi.stubGlobal('fetch', fetchVectors());
    mount(base({ enabled: true }));
    expect(toggle().checked).toBe(true);
    type(field('Embeddings model'), 'another-model');
    expect(semantic()).toMatchObject({ enabled: false, model: 'another-model' });
    expect(toggle().disabled).toBe(true);
  });

  it('turns off when the provider changes', () => {
    mount(base({ enabled: true }));
    type(field('Embeddings provider') as unknown as HTMLSelectElement, 'p2');
    expect(semantic()).toMatchObject({ enabled: false, providerId: 'p2' });
  });

  it('can always be turned off', () => {
    mount(base({ enabled: true }));
    expect(toggle().disabled).toBe(false);
    act(() => toggle().click());
    expect(semantic()?.enabled).toBe(false);
  });
});

describe('Test', () => {
  it('keeps the dimensions, which go when the model changes', async () => {
    vi.stubGlobal('fetch', fetchVectors(768));
    mount(base());
    await clickTest();
    expect(semantic()?.dimensions).toBe(768);
    type(field('Embeddings model'), 'another-model');
    expect(semantic()?.dimensions).toBeUndefined();
  });

  it('keeps what changed in the settings while it was testing', async () => {
    let answer: ((r: Response) => void) | undefined;
    vi.stubGlobal('fetch', vi.fn((url: string) => (isList(url) ? Promise.resolve(listing()) : new Promise<Response>((r) => (answer = r)))));
    mount(base());
    const testing = clickTest();
    await vi.waitFor(() => expect(answer).not.toBe(undefined));
    await act(async () => replaceSettings({ ...current, memory: { ...current.memory, enabled: false } }));
    answer!(new Response(JSON.stringify({ data: [{ index: 0, embedding: [0.1, 0.2] }] })));
    await testing;
    await act(async () => undefined);
    expect(semantic()?.dimensions).toBe(2);
    expect(current.memory?.enabled).toBe(false);
  });

  it('gives up on a server that never answers', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort(new DOMException('timed out', 'TimeoutError')));
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_, reject) => {
      if (init.signal!.aborted) reject(init.signal!.reason);
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
    })));
    mount(base());
    await clickTest();
    expect(timeout).toHaveBeenCalled();
    expect(container.textContent).not.toContain('Testing…');
    expect(toggle().disabled).toBe(true);
    timeout.mockRestore();
  });

  it('asks for the host, sends only a fixed word, and shows the dimensions', async () => {
    const fetch = fetchVectors();
    vi.stubGlobal('fetch', fetch);
    mount(base());
    await clickTest();
    expect(allowSite).toHaveBeenCalledWith('https://llm.example.com/v1');
    expect(JSON.parse(fetch.mock.calls.find(([url]) => url.endsWith('/embeddings'))![1].body as string)).toEqual({ model: 'embed', input: ['test'] });
    expect(container.textContent).toContain('768 dimensions');
  });
});

describe('the model list', () => {
  // fetchModels keeps a list per provider for the page: each test has its own.
  let count = 0;
  const provider = () => {
    const id = `list-${++count}`;
    return { id, name: id, baseURL: `https://${id}.example.com/v1`, apiKey: '', defaultModel: 'chat' };
  };
  const withProviders = (providers: object[], semantic: object = {}) => ({ providers, systemPrompt: '', memory: { semantic: { providerId: (providers[0] as { id: string }).id, model: 'embed', ...semantic } } }) as unknown as Settings;
  const options = () => {
    const list = field('Embeddings model').getAttribute('list');
    return [...container.querySelectorAll(`datalist[id="${list}"] option`)].map((o) => o.getAttribute('value'));
  };
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r)); });
  // A server per base URL: its /models answer waits until `answer` is called.
  const pending = () => {
    const answers = new Map<string, (r: Response) => void>();
    const fetch = vi.fn((url: string) => new Promise<Response>((resolve) => answers.set(url, resolve)));
    return { fetch, answer: (p: { baseURL: string }, ...ids: string[]) => act(async () => answers.get(`${p.baseURL}/models`)!(listing(...ids))) };
  };
  const asked = (fetch: ReturnType<typeof vi.fn>) => fetch.mock.calls.filter(([url]) => isList(url as string)).length;

  it("offers the provider's models, the embeddings looking ones first", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => listing('llama3', 'text-embedding-3-small', 'bge-m3')));
    mount(withProviders([provider()]));
    await settle();
    expect(options()).toEqual(['bge-m3', 'text-embedding-3-small', 'llama3']);
    expect(field('Embeddings model').value).toBe('embed');
  });

  it('asks a chosen model for a new Test, and any name can still be typed', async () => {
    const p = provider();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (isList(url) ? listing('bge-m3', 'nomic-embed-text') : fetchVectors()(url, {}))));
    mount(withProviders([p]));
    await settle();
    await clickTest();
    act(() => toggle().click());
    expect(semantic()?.enabled).toBe(true);
    type(field('Embeddings model'), 'nomic-embed-text');
    expect(semantic()).toMatchObject({ enabled: false, model: 'nomic-embed-text', dimensions: undefined });
    expect(toggle().disabled).toBe(true);
    type(field('Embeddings model'), 'not-listed');
    expect(semantic()?.model).toBe('not-listed');
    await clickTest();
    expect(toggle().disabled).toBe(false);
  });

  it.each([
    ['lists none', vi.fn(async (url: string) => (isList(url) ? listing() : fetchVectors()(url, {})))],
    ['answers an error', vi.fn(async (url: string) => (isList(url) ? new Response('{}', { status: 500 }) : fetchVectors()(url, {})))],
    ['cannot be reached', vi.fn(async (url: string) => {
      if (isList(url)) throw new TypeError('Failed to fetch');
      return fetchVectors()(url, {});
    })],
  ])('leaves the field usable when the server %s', async (_, fetch) => {
    vi.stubGlobal('fetch', fetch);
    mount(withProviders([provider()]));
    await settle();
    expect(options()).toEqual([]);
    expect(field('Embeddings model').disabled).toBe(false);
    type(field('Embeddings model'), 'typed-model');
    expect(semantic()?.model).toBe('typed-model');
    await clickTest();
    expect(toggle().disabled).toBe(false);
  });

  it("does not show the previous provider's list after switching", async () => {
    const [a, b] = [provider(), provider()];
    const { fetch, answer } = pending();
    vi.stubGlobal('fetch', fetch);
    mount(withProviders([a, b]));
    await answer(a, 'a-embed');
    expect(options()).toEqual(['a-embed']);
    type(field('Embeddings provider') as unknown as HTMLSelectElement, b.id);
    await settle();
    expect(options()).toEqual([]);
    await answer(b, 'b-embed');
    expect(options()).toEqual(['b-embed']);
  });

  it("drops the previous provider's answer when it comes late", async () => {
    const [a, b] = [provider(), provider()];
    const { fetch, answer } = pending();
    vi.stubGlobal('fetch', fetch);
    mount(withProviders([a, b]));
    await settle();
    type(field('Embeddings provider') as unknown as HTMLSelectElement, b.id);
    await settle();
    await answer(b, 'b-embed');
    await answer(a, 'a-embed');
    expect(options()).toEqual(['b-embed']);
  });

  it('starts nothing by loading: no Test, no change to the settings, and a switch on stays on', async () => {
    const p = provider();
    const { fetch, answer } = pending();
    vi.stubGlobal('fetch', fetch);
    const start = withProviders([p], { enabled: true, dimensions: 768 });
    mount(start);
    await settle();
    await answer(p, 'bge-m3', 'embed');
    expect(options()).toEqual(['bge-m3', 'embed']);
    expect(current).toBe(start);
    expect(toggle().checked).toBe(true);
    expect(allowSite).not.toHaveBeenCalled();
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([`${p.baseURL}/models`]);
    expect(container.textContent).not.toContain('Testing…');
  });

  it('asks nobody without a provider', async () => {
    const fetch = vi.fn(async () => listing('embed'));
    vi.stubGlobal('fetch', fetch);
    mount(base({ providerId: 'gone' }));
    await settle();
    expect(fetch).not.toHaveBeenCalled();
    expect(options()).toEqual([]);
  });

  // Settings give a new provider object on every change, and fetchModels keeps no failure.
  it('does not ask a failing server again for each change of the settings, only when what it is asked with changes', async () => {
    const p = provider();
    const fetch = vi.fn(async () => new Response('{}', { status: 500 }));
    vi.stubGlobal('fetch', fetch);
    const start = withProviders([p]);
    mount(start);
    await settle();
    expect(asked(fetch)).toBe(1);
    act(() => replaceSettings({ ...start, providers: [{ ...p }] }));
    await settle();
    expect(asked(fetch)).toBe(1);
    act(() => replaceSettings({ ...start, providers: [{ ...p, apiKey: 'another-key' }] }));
    await settle();
    expect(asked(fetch)).toBe(2);
    act(() => replaceSettings({ ...start, providers: [{ ...p, apiKey: 'another-key', extraHeaders: { 'X-Team': 'a' } }] }));
    await settle();
    expect(asked(fetch)).toBe(3);
  });
});

describe('what it says', () => {
  it('says what goes before anything can', () => {
    mount(base());
    expect(container.textContent).toContain("The text of your memory items, and each message you send while this is on, go to this provider. Pinned items don't need it and stay out.");
  });

  it('says which models are listed first', () => {
    mount(base());
    expect(container.textContent).toContain('Models that look like embeddings are listed first.');
  });

  it('leaves the meaning needed to the Matching tab', () => {
    mount(base());
    expect(container.querySelector('[aria-label="Meaning needed"]')).toBeNull();
  });

  it("puts it on Matching's card: 55% by default, dimmed while semantic search is off", () => {
    const card = document.createElement('div');
    document.body.append(card);
    const root = createRoot(card);
    act(() => root.render(createElement(MeaningCard, { settings: base(), onChange: () => {} })));
    const range = card.querySelector<HTMLInputElement>('[aria-label="Meaning needed"]')!;
    expect([range.min, range.max, range.step, range.value]).toEqual(['20', '95', '5', '55']);
    expect(card.querySelector('.match-card')!.classList.contains('off')).toBe(true);
    expect(card.textContent).toContain('Semantic search is off');
    act(() => root.unmount());
    card.remove();
  });

  it('shows how far the index went, as it goes', async () => {
    await storage.local.set({ memoryIndexStatus: { indexed: 38, total: 42 } });
    mount(base({ enabled: true }));
    await act(async () => {});
    expect(container.textContent).toContain('38 of 42 items indexed');
    await act(async () => storage.local.set({ memoryIndexStatus: { indexed: 42, total: 42 } }));
    expect(container.textContent).toContain('42 of 42 items indexed');
  });

  it('shows why the index stopped', async () => {
    await storage.local.set({ memoryIndexStatus: { indexed: 1, total: 2, error: 'The server answered 500.' } });
    mount(base({ enabled: true }));
    await act(async () => {});
    expect(container.textContent).toContain("Couldn't index: The server answered 500.");
  });

  it('shows no index status while off', async () => {
    await storage.local.set({ memoryIndexStatus: { indexed: 38, total: 42 } });
    mount(base());
    await act(async () => {});
    expect(container.textContent).not.toContain('items indexed');
  });

  it('says when the provider chosen is gone', () => {
    mount(base({ providerId: 'gone', enabled: true }));
    expect(container.textContent).toContain('The provider chosen is gone: choose another.');
  });

  it('sets a prefix on leaving the field, not on each key, as a change sends the items again', () => {
    mount(base({ enabled: true }));
    type(field('Document prefix'), 'pass');
    expect(semantic()?.documentPrefix).toBeUndefined();
    type(field('Document prefix'), 'passage: ');
    act(() => field('Document prefix').dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(semantic()).toMatchObject({ enabled: true, documentPrefix: 'passage: ' });
    type(field('Query prefix'), 'query: ');
    act(() => field('Query prefix').dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(semantic()).toMatchObject({ enabled: true, documentPrefix: 'passage: ', queryPrefix: 'query: ' });
  });
});
