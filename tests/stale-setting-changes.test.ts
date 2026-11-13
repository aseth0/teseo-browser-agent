// @vitest-environment jsdom
// Settings sections whose change comes after an await, or from a list as it was rendered: each
// applies to the settings as they are when it is made, so a change made meanwhile stays.
import { act, createElement, useState, type FunctionComponent } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeStorage } from './fakes/browser';
import type { Settings } from '../src/storage/settings';
import type { SettingsChange } from '../src/ui/useSettings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const storage = fakeStorage();
vi.mock('../src/storage/secret-db', async () => (await import('./fakes/browser')).fakeSecretDb());
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage, { identity: { getRedirectURL: () => 'https://id.test/' }, runtime: { getURL: (p: string) => `chrome-extension://x${p}`, id: 'x' }, permissions: { contains: async () => true, remove: async () => true, onAdded: { addListener: () => undefined, removeListener: () => undefined }, onRemoved: { addListener: () => undefined, removeListener: () => undefined } } }) }));

// An answer the test gives when it wants.
function later<T>() {
  let give: (v: T) => void = () => undefined;
  const promise = new Promise<T>((r) => (give = r));
  return { promise, give: (v: T) => give(v) };
}
const counting = vi.hoisted(() => ({ next: undefined as Promise<number> | undefined }));
vi.mock('../src/history/store', async (real) => ({
  ...(await real<object>()),
  listConversations: async () => [],
  historyBytes: async () => 0,
  retentionCount: () => counting.next ?? Promise.resolve(0),
}));
const folder = vi.hoisted(() => ({ next: undefined as Promise<string> | undefined }));
vi.mock('../src/bookmarks/store', async (real) => ({
  ...(await real<object>()),
  bookmarksAllowed: async () => true,
  everyFolder: async () => [],
  bookmarksUnder: async () => [],
  defaultFolder: () => folder.next!,
}));

vi.mock('../src/ui/useMcpLogs', () => ({ useMcpLogs: () => [] }));
vi.mock('../src/ui/useSitePolicies', () => ({ useSitePolicies: () => [{}, () => undefined] }));
vi.mock('../src/ui/Skills', async (real) => ({ ...(await real<object>()), useSkills: () => [] }));
vi.mock('../src/ui/templates/useTemplates', () => ({ useTemplates: () => [] }));
vi.mock('../src/ui/Tools', async (real) => ({ ...(await real<object>()), useToolCatalog: () => [] }));
// What the MCP editor's save does (settings-context `save`): fails when the test says.
const saving = vi.hoisted(() => ({ fails: false }));

const { applySettingsChange } = await import('../src/ui/useSettings');
const { SettingsContext } = await import('../src/ui/settings-context');
const { McpSection } = await import('../src/ui/mcp/McpSection');
const { BrowserEditor } = await import('../src/ui/agents/BrowserEditor');
const { HistorySection } = await import('../src/ui/HistorySettings');
const { BookmarksSection } = await import('../src/ui/BookmarksSettings');

let current: Settings;
let replace: (change: Partial<Settings>) => void;
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
async function mount(Section: FunctionComponent<{ settings: Settings; onChange: (c: SettingsChange) => void }>, start: Partial<Settings>) {
  current = { providers: [], systemPrompt: '', ...start } as Settings;
  const Host = () => {
    const [settings, set] = useState(current);
    // Another page's change, or another part of this one.
    replace = (change) => set((current = { ...current, ...change }));
    const update = (change: SettingsChange) => set((current = applySettingsChange(current, change)));
    const save = async (change: SettingsChange) => {
      if (saving.fails) throw new Error('quota');
      update(change);
    };
    return createElement(SettingsContext.Provider, { value: { settings, update, save } }, createElement(Section, { settings, onChange: update }));
  };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Host)));
}
afterEach(() => {
  act(() => root.unmount());
  location.hash = '';
  saving.fails = false;
  container.remove();
  storage.reset();
});
const input = (label: string) => [...container.querySelectorAll('label')].find((l) => l.textContent?.startsWith(label))!.querySelector('input')!;
const typeInto = (el: HTMLInputElement, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const button = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!;

describe('History: the retention', () => {
  it('keeps what changed while it counted what it would delete', async () => {
    await mount(HistorySection, { history: { enabled: true } });
    const count = later<number>();
    counting.next = count.promise;
    act(() => [...container.querySelectorAll('[role="tab"]')].find((t) => t.textContent === 'Saving')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const field = input('Keep at most');
    typeInto(field, '50');
    await act(async () => field.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    act(() => replace({ history: { ...current.history, resume: 'recent' } }));
    await act(async () => count.give(0));
    expect(current.history).toMatchObject({ enabled: true, resume: 'recent', keepCount: 50 });
  });
});

describe('Bookmarks: a folder made', () => {
  it('keeps what changed while it was made', async () => {
    await mount(BookmarksSection, { bookmarks: {} });
    const made = later<string>();
    folder.next = made.promise;
    await vi.waitFor(() => expect(button('folder')).toBeDefined());
    act(() => button('folder').click());
    act(() => replace({ bookmarks: { ...current.bookmarks, autoAttach: { enabled: true } } }));
    await act(async () => made.give('f1'));
    expect(current.bookmarks).toMatchObject({ rootId: 'f1', autoAttach: { enabled: true } });
  });
});

describe('MCP servers', () => {
  const servers = [
    { id: 's1', name: 'one', url: 'https://one.test/mcp', enabled: true },
    { id: 's2', name: 'two', url: 'https://two.test/mcp', enabled: true },
  ];
  it('keeps a server added by another page when one is switched off on a list not showing it yet', async () => {
    await mount(McpSection, { mcpServers: servers });
    // Stored by another page, its echo not here yet: the change applies to the settings as stored.
    current = { ...current, mcpServers: [...servers, { id: 's3', name: 'three', url: 'https://three.test/mcp', enabled: true }] };
    act(() => container.querySelector<HTMLInputElement>('[aria-label="one: on"]')!.click());
    expect(current.mcpServers?.map((m) => [m.id, m.enabled])).toEqual([['s1', false], ['s2', true], ['s3', true]]);
  });

  it('keeps the editor open when the server could not be saved, and closes it once saved', async () => {
    location.hash = '#mcp/s1';
    await mount(McpSection, { mcpServers: servers });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    saving.fails = true;
    await act(async () => button('Save').click());
    expect(location.hash).toBe('#mcp/s1');
    error.mockRestore();
    saving.fails = false;
    await act(async () => button('Save').click());
    expect(location.hash).not.toBe('#mcp/s1');
  });
});

describe('Browser\'s editor', () => {
  it('leaves the tools as they are by then when they were not switched in it', async () => {
    await mount((p) => createElement(BrowserEditor, { ...p, onClose: () => undefined }), { disabledTools: ['a'] });
    act(() => replace({ disabledTools: ['a', 'b'] }));
    await act(async () => button('Save').click());
    expect(current.disabledTools).toEqual(['a', 'b']);
  });
});
