// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSecretDb, fakeStorage } from './fakes/browser';
import { buttonNamed, pageBrowser, pageGlobals, settle, typeInto } from './fakes/panel';

// Settings → Appearance, on the Options page: the mode, a theme and a font chosen are stored; a theme
// file imported is saved among yours (one that is not a theme file is refused, saying why); yours are
// saved from the current look and deleted once confirmed.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
pageGlobals();
const storage = fakeStorage();
const secrets = fakeSecretDb();
const fake = pageBrowser(storage);
vi.mock('../src/storage/secret-db', () => secrets);
vi.mock('wxt/browser', () => ({ browser: fake.browser }));

const { loadSettings, saveSettings } = await import('../src/storage/settings');
const { THEME_FILE_TYPE, THEME_FILE_VERSION } = await import('../src/ui/themes/theme-file');
const { Options } = await import('../src/entrypoints/options/Options');

let root: Root;
let box: HTMLElement;
async function open(hash: string) {
  history.replaceState(null, '', `/options.html${hash}`);
  box = document.body.appendChild(document.createElement('div'));
  root = createRoot(box);
  await act(async () => root.render(createElement(Options)));
  await settle(20);
}
const look = async () => (await loadSettings()).appearance ?? {};
const card = (group: string, name: string) => [...box.querySelectorAll<HTMLButtonElement>(`[role="radiogroup"][aria-label="${group}"] [role="radio"]`)].find((b) => b.textContent!.includes(name))!;
const click = async (el: HTMLElement) => {
  await act(async () => el.click());
  await settle();
};
async function importFile(text: string) {
  const input = box.querySelector<HTMLInputElement>('input[type="file"][aria-label="Theme file"]')!;
  Object.defineProperty(input, 'files', { value: [new File([text], 'theme.json', { type: 'application/json' })], configurable: true });
  await act(async () => void input.dispatchEvent(new Event('change', { bubbles: true })));
  await settle();
}
const themeFile = (name: string, accent: string) => JSON.stringify({ type: THEME_FILE_TYPE, version: THEME_FILE_VERSION, name, accent });

beforeEach(() => {
  storage.reset();
  secrets.data.clear();
});
afterEach(() => {
  act(() => root.unmount());
  box.remove();
});

describe('Settings → Appearance', () => {
  it('the mode chosen is stored and said over the tabs', async () => {
    await open('#appearance/theme');
    await click(buttonNamed(box.querySelector('[role="group"][aria-label="Mode"]')!, 'Dark')!);
    expect((await look()).mode).toBe('dark');
    expect(box.textContent).toContain('Mode: Dark');
  });

  it('a theme chosen sets its colors, and its card shows chosen', async () => {
    await open('#appearance/theme');
    await click(card('Themes', 'Ocean'));
    expect((await look()).accent).toBe('#0284c7');
    expect(card('Themes', 'Ocean').getAttribute('aria-checked')).toBe('true');
    expect(card('Themes', 'Default').getAttribute('aria-checked')).toBe('false');
  });

  it('a font chosen, and one installed by name, are stored', async () => {
    await open('#appearance/fonts');
    await click(card('Text font', 'Serif'));
    await typeInto(box.querySelector('input[aria-label="Code font name"]')!, 'Fira Code');
    await settle();
    expect(await look()).toMatchObject({ fontText: 'serif', fontCodeName: 'Fira Code' });
  });

  it('a theme file imported is saved among yours, not applied', async () => {
    await open('#appearance/theme');
    await importFile(themeFile('Dusk', '#7c3aed'));
    expect(box.textContent).toContain('Imported "Dusk": pick it in Theme to use it.');
    expect((await loadSettings()).customThemes).toEqual([expect.objectContaining({ name: 'Dusk', accent: '#7c3aed' })]);
    expect((await look()).accent).toBeUndefined();
    await click(card('Your themes', 'Dusk'));
    expect((await look()).accent).toBe('#7c3aed');
  });

  it('a file that is not a theme file is refused, saying why, and nothing is saved', async () => {
    await open('#appearance/theme');
    await importFile('{"type":"something-else","version":2}');
    expect(box.querySelector('.error-text')!.textContent).toBe(`Error: Not a theme file: its "type" must be "${THEME_FILE_TYPE}".`);
    await importFile('{ not json');
    expect(box.querySelector('.error-text')!.textContent).toMatch(/^Error: /);
    expect((await loadSettings()).customThemes).toBeUndefined();
  });

  it('the current look saved as a theme of yours, then deleted once confirmed', async () => {
    await saveSettings({ ...(await loadSettings()), appearance: { accent: '#16a34a' } });
    await open('#appearance/theme');
    await click(buttonNamed(box, 'Save as theme…')!);
    await typeInto(box.querySelector('input[aria-label="Theme name"]')!, 'Moss');
    await click(buttonNamed(box.querySelector('form.theme-save')!, 'Save')!);
    expect((await loadSettings()).customThemes).toEqual([expect.objectContaining({ name: 'Moss', accent: '#16a34a' })]);
    await click(buttonNamed(box, 'Delete the theme Moss')!);
    expect((await loadSettings()).customThemes).toHaveLength(1); // asked first
    await click(buttonNamed(box.querySelector('[role="group"][aria-label=\'Delete "Moss"?\']')!, 'Delete')!);
    expect((await loadSettings()).customThemes ?? []).toEqual([]);
  });
});
