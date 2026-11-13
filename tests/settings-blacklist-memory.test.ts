// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSecretDb, fakeStorage } from './fakes/browser';
import { buttonNamed, pageBrowser, pageGlobals, settle, typeInto } from './fakes/panel';

// Settings → Word blacklist and Memory, on the Options page. The blacklist: terms added are kept as
// secrets (never in storage.local), two with one replacement are not saved and say why, a file of
// terms is imported (one that is not, refused), and Try it shows a text as the model would get it.
// Memory: an item written is saved, pinned and unpinned from the list, deleted once confirmed.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
pageGlobals();
const storage = fakeStorage();
const secrets = fakeSecretDb();
const fake = pageBrowser(storage);
vi.mock('../src/storage/secret-db', () => secrets);
vi.mock('wxt/browser', () => ({ browser: fake.browser }));

const { loadBlacklistEntries, loadBlacklistConfig, saveBlacklistEntries } = await import('../src/word-blacklist/store');
const { memoryStore } = await import('../src/memory/store');
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
const click = async (el: Element) => {
  await act(async () => (el as HTMLElement).click());
  await settle();
};
const inputs = (label: string) => [...box.querySelectorAll<HTMLInputElement>(`main input[aria-label="${label}"]`)];
async function importFile(text: string, name: string) {
  const input = box.querySelector<HTMLInputElement>('main .wbl-toolbar input[type="file"]')!;
  Object.defineProperty(input, 'files', { value: [new File([text], name)], configurable: true });
  await act(async () => void input.dispatchEvent(new Event('change', { bubbles: true })));
  await settle();
}

beforeEach(() => {
  storage.reset();
  secrets.data.clear();
});
afterEach(() => {
  act(() => root.unmount());
  box.remove();
});

describe('Settings → Word blacklist', () => {
  it('a term added is kept as a secret, never in storage.local', async () => {
    await open('#word-blacklist');
    expect(box.textContent).toContain('No terms yet');
    await click(buttonNamed(box, '＋ Add term')!);
    await typeInto(inputs('Real term')[0]!, 'Acme Corp');
    await typeInto(inputs('Sent as')[0]!, 'CLIENT_A');
    await settle();
    expect(await loadBlacklistEntries()).toEqual([{ term: 'Acme Corp', replacement: 'CLIENT_A' }]);
    expect(JSON.stringify(storage.local.data)).not.toContain('Acme Corp');
  });

  it('switched on from the head of the page, stored', async () => {
    await open('#word-blacklist');
    await click(box.querySelector('main input[role="switch"][aria-label="Use the blacklist"]')!);
    expect((await loadBlacklistConfig()).enabled).toBe(true);
  });

  it('two terms with the same replacement say so, and the list is not saved meanwhile', async () => {
    await saveBlacklistEntries([{ term: 'Acme', replacement: 'CLIENT_A' }]);
    await open('#word-blacklist');
    await click(buttonNamed(box, '＋ Add term')!);
    await typeInto(inputs('Real term')[0]!, 'Globex');
    await typeInto(inputs('Sent as')[0]!, 'CLIENT_A');
    await settle();
    expect([...box.querySelectorAll('main [role="alert"]')].map((a) => a.textContent)).toContain('Two terms use the same replacement.');
    expect(await loadBlacklistEntries()).toEqual([{ term: 'Acme', replacement: 'CLIENT_A' }]);
    await typeInto(inputs('Sent as')[0]!, 'CLIENT_B');
    await settle();
    expect(await loadBlacklistEntries()).toEqual([{ term: 'Globex', replacement: 'CLIENT_B' }, { term: 'Acme', replacement: 'CLIENT_A' }]);
  });

  it('a term removed goes', async () => {
    await saveBlacklistEntries([{ term: 'Acme', replacement: 'CLIENT_A' }, { term: 'Globex', replacement: 'CLIENT_B' }]);
    await open('#word-blacklist');
    await click(buttonNamed(box, 'Remove Acme')!);
    expect(await loadBlacklistEntries()).toEqual([{ term: 'Globex', replacement: 'CLIENT_B' }]);
  });

  it('a CSV of terms is imported; a file that is none is refused', async () => {
    await open('#word-blacklist');
    await importFile('term,replacement\nInitech,CLIENT_C\nUmbrella,CLIENT_D\n', 'terms.csv');
    expect(box.querySelector('main [role="status"]')!.textContent).toBe('Imported 2 terms.');
    expect((await loadBlacklistEntries()).map((e) => e.term).sort()).toEqual(['Initech', 'Umbrella']);
    await importFile('\u0000\u0001 not a list', 'photo.txt');
    expect(box.querySelector('main [role="status"]')!.className).toBe('error-text');
    expect((await loadBlacklistEntries())).toHaveLength(2);
  });

  it('Try it shows a text as the model would get it', async () => {
    await saveBlacklistEntries([{ term: 'Acme', replacement: 'CLIENT_A' }]);
    await open('#word-blacklist');
    await click([...box.querySelectorAll('main [role="tab"]')].find((t) => t.textContent === 'Try it')!);
    await typeInto(box.querySelector('textarea[aria-label="Text to try"]')!, 'Send the invoice to Acme today');
    expect(box.querySelector('[aria-label="As the model gets it"]')!.textContent).toBe('Send the invoice to CLIENT_A today');
    expect(box.querySelector('.wbl-used')!.textContent).toBe('Acme → CLIENT_A');
  });
});

describe('Settings → Memory', () => {
  const item = { id: 'm1', enabled: true, title: 'Language', text: 'Answer in English.', pinned: false, domains: [], agents: [], source: 'user' as const, createdAt: 1, updatedAt: 1 };
  const field = (text: string) => [...box.querySelectorAll('main label')].find((l) => l.textContent!.startsWith(text))!.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea')!;

  it('an item written is saved, with its sites, and listed', async () => {
    await open('#memory');
    await click(buttonNamed(box, '＋ New item')!);
    await typeInto(field('Text'), 'Prices are shown without tax.');
    await typeInto(field('Sites'), 'shop.example.com, docs.example.org');
    await click(buttonNamed(box.querySelector('main .editor')!, 'Save')!);
    const saved = await memoryStore.load();
    expect(saved).toEqual([expect.objectContaining({ text: 'Prices are shown without tax.', domains: ['shop.example.com', 'docs.example.org'], source: 'user', enabled: true })]);
    expect(location.hash).toBe('#memory');
    expect(box.querySelector('main table')!.textContent).toContain('Prices are shown without tax.');
  });

  it('pinned and unpinned from the list', async () => {
    await memoryStore.save(item);
    await open('#memory');
    await click(buttonNamed(box, 'Pin Language')!);
    expect((await memoryStore.load())[0]!.pinned).toBe(true);
    await click(buttonNamed(box, 'Unpin Language')!);
    expect((await memoryStore.load())[0]!.pinned).toBe(false);
  });

  it('deleted from the list once confirmed', async () => {
    await memoryStore.save(item);
    await open('#memory');
    await click(buttonNamed(box, 'Delete Language')!);
    expect(await memoryStore.load()).toHaveLength(1);
    await click(buttonNamed(box.querySelector('main [role="group"][aria-label="Delete?"]')!, 'Delete')!);
    expect(await memoryStore.load()).toEqual([]);
  });

  it('edited: the text changed is saved', async () => {
    await memoryStore.save(item);
    await open('#memory/m1');
    await typeInto(field('Text'), 'Answer in English, briefly.');
    await click(buttonNamed(box.querySelector('main .editor')!, 'Save')!);
    expect((await memoryStore.load())[0]).toMatchObject({ id: 'm1', text: 'Answer in English, briefly.' });
  });
});
