// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSecretDb, fakeStorage } from './fakes/browser';
import { pageBrowser, pageGlobals, settle, typeInto } from './fakes/panel';

// The Options page (Settings): the menu of sections, the one shown by the URL's hash (a deep link may
// point inside it), a change saved from another page shown here, and a save that fails said so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
pageGlobals();
const storage = fakeStorage();
const secrets = fakeSecretDb();
const fake = pageBrowser(storage);
vi.mock('../src/storage/secret-db', () => secrets);
vi.mock('wxt/browser', () => ({ browser: fake.browser }));

const { loadSettings, saveSettings } = await import('../src/storage/settings');
const { SETTINGS_SECTIONS } = await import('../src/ui/Settings');
const { Options } = await import('../src/entrypoints/options/Options');

let root: Root;
let box: HTMLElement;
async function open(hash = '') {
  history.replaceState(null, '', `/options.html${hash}`);
  box = document.body.appendChild(document.createElement('div'));
  root = createRoot(box);
  await act(async () => root.render(createElement(Options)));
  await settle(20);
}
const current = () => box.querySelector('nav [aria-current="page"]')?.textContent;
const heading = () => box.querySelector('main h3, main h2')?.textContent;
async function go(hash: string) {
  history.replaceState(null, '', `/options.html${hash}`);
  await act(async () => void window.dispatchEvent(new HashChangeEvent('hashchange')));
}

beforeEach(() => {
  storage.reset();
  secrets.data.clear();
});
afterEach(() => {
  act(() => root.unmount());
  box.remove();
  vi.restoreAllMocks();
});

describe('the Options page', () => {
  it('a link per section, under the names of their groups; the first one shown with no hash', async () => {
    await open();
    const links = [...box.querySelectorAll<HTMLAnchorElement>('nav a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(SETTINGS_SECTIONS.map((s) => `#${s.id}`));
    expect([...box.querySelectorAll('nav [role="separator"]')].map((g) => g.textContent)).toEqual(SETTINGS_SECTIONS.flatMap((s) => (s.group ? [s.group] : [])));
    expect(current()).toContain(SETTINGS_SECTIONS[0]!.title);
  });

  it('opens on the section of its hash, also one that points inside it', async () => {
    await open('#about-you');
    expect(current()).toContain('About you');
    expect(heading()).toBe('About you');
    act(() => root.unmount());
    box.remove();
    await open('#memory/some-item');
    expect(current()).toContain('Memory');
  });

  it('an unknown hash shows the first section', async () => {
    await open('#no-such-section');
    expect(current()).toContain(SETTINGS_SECTIONS[0]!.title);
  });

  it('follows the hash as it changes, to the top only for another section', async () => {
    await open('#about-you');
    const scrolled = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    await go('#limits');
    expect(current()).toContain('Limits');
    expect(scrolled).toHaveBeenCalledTimes(1);
    await go('#limits/aboutUser');
    expect(scrolled).toHaveBeenCalledTimes(1);
  });

  it('a change typed is saved; one saved by another page shows', async () => {
    await open('#about-you');
    const text = box.querySelector<HTMLTextAreaElement>('main textarea')!;
    await typeInto(text, 'I am a tester.');
    await settle();
    expect((await loadSettings()).aboutUser).toBe('I am a tester.');
    // The side panel (another page) saves the settings meanwhile.
    await act(async () => saveSettings({ ...(await loadSettings()), aboutUser: 'Changed in the side panel.' }));
    await settle();
    expect(box.querySelector<HTMLTextAreaElement>('main textarea')!.value).toBe('Changed in the side panel.');
  });

  it('a save that fails says why, and what was typed is not kept as if saved', async () => {
    await open('#about-you');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(storage.local, 'set').mockRejectedValue(new Error('Storage quota exceeded'));
    await typeInto(box.querySelector<HTMLTextAreaElement>('main textarea')!, 'Lost words');
    await settle();
    expect(box.querySelector('main [role="alert"]')?.textContent).toBe('Could not save the settings: Storage quota exceeded');
    expect(box.querySelector<HTMLTextAreaElement>('main textarea')!.value).toBe('');
  });
});
