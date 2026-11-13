// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeEvent, fakeStorage } from './fakes/browser';

// Settings → Shortcuts: each command with its browser shortcut (set on the browser's page) and its key
// set here (recorded, checked, stored for the extension's listeners).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const storage = fakeStorage();
const create = vi.fn(async (_p: { url: string }) => undefined);
let everySite = false;
vi.mock('wxt/browser', () => ({
  browser: fakeBrowser(storage, {
    tabs: { create },
    permissions: { contains: async () => everySite, onAdded: fakeEvent(), onRemoved: fakeEvent() },
    commands: {
      getAll: async () => [
        { name: '_execute_action', description: '', shortcut: '' },
        { name: 'open-side-panel', description: 'Open Teseo', shortcut: 'Alt+Shift+A' },
        { name: 'capture-section', description: 'Screenshot a section of the page into the chat', shortcut: '' },
      ],
    },
  }),
}));
const { ShortcutsSection } = await import('../src/ui/ShortcutsSettings');
const { withShortcut } = await import('../src/ui/shortcuts');
const { PAGE_KEYS_KEY } = await import('../src/storage/keys');

let box: HTMLDivElement;
const render = async () => {
  box = document.createElement('div');
  document.body.replaceChildren(box);
  await act(async () => createRoot(box).render(createElement(ShortcutsSection)));
};
const rows = () => [...box.querySelectorAll('tbody tr')].map((r) => [...r.querySelectorAll('td')].map((c) => c.textContent));
const recorder = (row: number) => box.querySelectorAll('tbody tr')[row]!.querySelector<HTMLButtonElement>('[data-key-recorder]')!;
const press = async (el: Element, code: string, mods: KeyboardEventInit = {}) =>
  act(async () => void el.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true, cancelable: true, ...mods })));
const stored = () => storage.local.data[PAGE_KEYS_KEY];

beforeEach(() => {
  storage.reset();
  everySite = false;
  create.mockClear();
});

describe('Settings → Shortcuts', () => {
  it("lists each with its browser shortcut and its key set here; the toolbar button's only in the browser", async () => {
    await render();
    expect(rows()).toEqual([
      ["Open the toolbar button's menu", 'Not set', '—'],
      ['Open Teseo', 'Alt+Shift+A', 'Click to set'],
      ['Screenshot a section of the page into the chat', 'Not set', 'Click to set'],
    ]);
    expect(box.querySelector('h3 svg')).not.toBeNull(); // its icon, as in the menu
  });

  it("opens the browser's page for its shortcuts, and says how many have none", async () => {
    await render();
    expect(box.textContent).toContain('2 actions have no browser shortcut');
    const open = [...box.querySelectorAll('button')].find((b) => b.textContent?.startsWith("Open the browser's shortcuts page"))!;
    await act(async () => open.click());
    expect(create).toHaveBeenCalledWith({ url: 'chrome://extensions/shortcuts' });
  });

  it('records a key: click, press it; kept for the listeners', async () => {
    await render();
    await act(async () => recorder(2).click());
    expect(recorder(2).textContent).toBe('Press keys · Esc cancels');
    await press(recorder(2), 'AltLeft', { altKey: true }); // still choosing
    await press(recorder(2), 'KeyF', { ctrlKey: true, altKey: true });
    expect(stored()).toEqual({ 'capture-section': { code: 'KeyF', ctrl: true, alt: true } });
    expect(rows()[2]?.[2]).toContain('Ctrl+Alt+F');
  });

  it('a key it cannot have: why, and nothing kept', async () => {
    await render();
    await act(async () => recorder(2).click());
    await press(recorder(2), 'KeyA', { altKey: true, shiftKey: true });
    expect(box.textContent).toContain("The browser's Alt+Shift+A is Open Teseo: pick another key");
    expect(stored()).toBeUndefined();
  });

  it('Esc cancels; ✕ clears the key', async () => {
    await storage.local.set({ [PAGE_KEYS_KEY]: { 'capture-section': { code: 'KeyF', ctrl: true, alt: true } } });
    await render();
    await act(async () => recorder(2).click());
    await press(recorder(2), 'Escape');
    expect(stored()).toEqual({ 'capture-section': { code: 'KeyF', ctrl: true, alt: true } });
    await act(async () => box.querySelector<HTMLButtonElement>('button[aria-label="Clear the key"]')!.click());
    expect(stored()).toEqual({});
  });

  it('a screenshot key set here, without access to every site: says it needs it', async () => {
    await storage.local.set({ [PAGE_KEYS_KEY]: { 'capture-section': { code: 'KeyF', ctrl: true, alt: true } } });
    await render();
    expect(rows()[2]?.[2]).toContain('Needs access to every site');
    everySite = true;
    await render();
    expect(rows()[2]?.[2]).not.toContain('Needs access to every site');
  });
});

describe('withShortcut', () => {
  it("a name, with its key when there is one", () => {
    expect(withShortcut('Section')).toBe('Section');
    expect(withShortcut('Section', '')).toBe('Section');
    expect(withShortcut('Visible', 'Alt+Shift+S')).toBe('Visible (Alt+Shift+S)');
  });
});
