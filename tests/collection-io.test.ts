// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ImportRow } from '../src/storage/import';

vi.mock('wxt/browser', async () => (await import('./fakes/browser')).emptyBrowser());
vi.mock('../src/ui/download', () => ({ downloadText: vi.fn(), fileStamp: () => '' }));
vi.mock('../src/ui/ask-permission', () => ({ askOrigins: vi.fn(async () => true) }));
vi.mock('../src/ui/icons', async (real) => ({ ...(await real<typeof import('../src/ui/icons')>()), writeClip: vi.fn(async () => undefined) }));
const { CollectionIO } = await import('../src/ui/collection/CollectionIO');
const { useSelection } = await import('../src/ui/collection/selection');
const { downloadText } = await import('../src/ui/download');
const { askOrigins } = await import('../src/ui/ask-permission');
const { writeClip } = await import('../src/ui/icons');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type It = { id: string; name: string; builtin?: boolean };
const a: It = { id: 'a', name: 'alpha' };
const b: It = { id: 'b', name: 'beta' };
const c: It = { id: 'c', name: 'gamma', builtin: true };

let host: HTMLDivElement;
let root: Root;
let exportJson: Mock<(items: It[], options: Record<string, boolean>) => string>;
let save: Mock<(items: It[]) => Promise<void>>;
let read: Mock<(json: string) => { rows: ImportRow<It>[] }>;
let selection: ReturnType<typeof useSelection>;

const rows: ImportRow<It>[] = [
  { name: 'fresh', status: 'new', item: { id: 'f', name: 'fresh' } },
  { name: 'beta', status: 'replaces', item: { id: 'b', name: 'beta' } },
  { name: 'team.search', status: 'leaves-source', item: { id: 't', name: 'team.search' }, sourceId: 's1' },
  { name: 'gamma', status: 'left-out', why: 'gamma: a built-in one has this name.' },
];

function Harness({ shown }: { shown: It[] }) {
  const items = [a, b, c];
  selection = useSelection(items.filter((i) => !i.builtin).map((i) => i.id));
  return h(CollectionIO<It>, {
    noun: ['thing', 'things'], label: 'Things', fileName: 'things.json', items, shown, id: (i) => i.id,
    cannot: (i) => (i.builtin ? 'Built in' : undefined), exportJson, read, save, placeholder: '{ "things": [] }', selection,
    options: [{ key: 'withKeys', label: 'Include header values (API keys)' }], sourceLabel: (id) => `${id}.example.com`,
    children: h('button', null, '＋ New thing'),
  });
}
const render = (shown: It[] = [b, c]) => act(() => root.render(h(Harness, { shown })));
const buttons = () => [...host.querySelectorAll<HTMLButtonElement>('button')];
const button = (text: string | RegExp) => buttons().find((x) => (typeof text === 'string' ? x.textContent === text : text.test(x.textContent ?? '')))!;
const click = (el: Element) => act(async () => (el as HTMLElement).click());
const menu = async (name: string) => {
  await click(button(`${name} ▾`));
  return [...host.querySelectorAll('[role^="menuitem"]')].map((m) => m.textContent?.trim());
};
const type = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => act(async () => {
  const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!;
  set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});

beforeEach(() => {
  exportJson = vi.fn((items: It[]) => JSON.stringify({ things: items.map((i) => i.name) }));
  save = vi.fn(async () => undefined);
  read = vi.fn(() => ({ rows }));
  vi.mocked(downloadText).mockClear();
  vi.mocked(askOrigins).mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('CollectionIO: the toolbar and Export', () => {
  it('puts its own buttons after the section’s, in the same order everywhere', async () => {
    await render();
    expect(buttons().map((x) => x.textContent)).toEqual(['＋ New thing', 'Select', 'Import ▾', 'Export ▾']);
  });

  it('exports all, or those the filter shows, to a file or copied, never the ones that cannot go', async () => {
    await render();
    expect(await menu('Export')).toEqual(['Download all (2)', 'Copy all as JSON (2)', 'Download shown (1)', 'Copy shown as JSON (1)', 'Choose which…', 'Include header values (API keys)']);
    await click(button('Download all (2)'));
    expect(downloadText).toHaveBeenCalledWith('things.json', JSON.stringify({ things: ['alpha', 'beta'] }));
    await menu('Export');
    await click(button('Copy shown as JSON (1)'));
    expect(writeClip).toHaveBeenCalledWith(JSON.stringify({ things: ['beta'] }));
    expect(host.textContent).toContain('Copied 1 thing as JSON.');
  });

  it('has no "shown" choices while the filter hides nothing', async () => {
    await render([a, b, c]);
    expect(await menu('Export')).not.toContain('Download shown (2)');
  });
});

describe('CollectionIO: Select', () => {
  it('exports the selected ones, also those the filter hides, saying so', async () => {
    await render();
    await menu('Export');
    await click(button('Choose which…'));
    expect(selection.selecting).toBe(true);
    expect(buttons().map((x) => x.textContent)).toEqual(['＋ New thing', 'Select all shown (1)', 'Download', 'Copy JSON', 'Done']);
    expect(button('Download').disabled).toBe(true);
    await act(async () => selection.toggle('a', true));
    expect(host.querySelector('.selection-bar')!.textContent).toContain('1 selected (1 hidden by the filter)');
    await click(button('Download'));
    expect(exportJson).toHaveBeenLastCalledWith([a], {});
    expect(downloadText).toHaveBeenCalledWith('things.json', JSON.stringify({ things: ['alpha'] }));
  });

  it('shows the export options in the bar too, off again once the section opens again', async () => {
    await render();
    await click(button('Select'));
    await act(async () => selection.toggle('b', true));
    await click(host.querySelector<HTMLInputElement>('.selection-bar input[type=checkbox]')!);
    await click(button('Copy JSON'));
    expect(exportJson).toHaveBeenLastCalledWith([b], { withKeys: true });
    await click(button('Done'));
    expect(selection.selecting).toBe(false);
    act(() => root.unmount());
    root = createRoot(host);
    await render();
    await menu('Export');
    expect(host.querySelector<HTMLInputElement>('[role="menuitemcheckbox"] input')!.checked).toBe(false);
  });
});

describe('CollectionIO: Import', () => {
  const paste = async (json = '{}') => {
    expect(await menu('Import')).toEqual(['From file…', 'Paste JSON…', 'From URL…']);
    await click(button('Paste JSON…'));
    await type(host.querySelector('textarea')!, json);
    await click(host.querySelector('.paste-json')!.querySelector('button')!);
  };

  it('previews what comes in before saving the ticked ones', async () => {
    await render();
    await paste();
    const preview = host.querySelector('.import-preview')!;
    expect(preview.textContent).toContain('4 things in the pasted JSON');
    const box = (name: string) => preview.querySelector<HTMLInputElement>(`input[aria-label="Import ${name}"]`)!;
    expect([box('fresh').checked, box('beta').checked, box('team.search').checked, box('gamma').checked]).toEqual([true, true, false, false]);
    expect(box('gamma').disabled).toBe(true);
    expect(preview.textContent).toContain('replaces a tool synced from s1.example.com: it leaves that source');
    expect(preview.querySelector('[title="gamma: a built-in one has this name."]')).not.toBeNull();
    await click(box('beta'));
    await click(button('Import 1'));
    expect(save).toHaveBeenCalledWith([{ id: 'f', name: 'fresh' }], expect.objectContaining({ rows: expect.any(Array) })); // and the preview it came from
    expect(host.querySelector('.import-preview')).toBeNull();
    expect(host.textContent).toContain('Imported fresh: they start off');
  });

  it('starts each preview afresh, with what that JSON holds ticked', async () => {
    await render();
    await paste();
    await click(host.querySelector<HTMLInputElement>('input[aria-label="Import beta"]')!); // only fresh stays ticked
    read = vi.fn(() => ({ rows: [rows[3]!, rows[0]!] })); // another JSON, from a file chosen meanwhile: left out first, then fresh
    await render();
    const input = host.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['{}'], 'other.json')] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    await act(async () => undefined); // the file is read
    expect(host.querySelector('.import-preview')!.textContent).toContain('in other.json');
    const box = (name: string) => host.querySelector<HTMLInputElement>(`.import-preview input[aria-label="Import ${name}"]`)!;
    expect([box('gamma').checked, box('fresh').checked]).toEqual([false, true]);
    await click(button('Import 1'));
    expect(save).toHaveBeenCalledWith([{ id: 'f', name: 'fresh' }], expect.objectContaining({ rows: expect.any(Array) })); // and the preview it came from
  });

  it('keeps what was pasted when it cannot be read', async () => {
    read = vi.fn((): { rows: ImportRow<It>[] } => {
      throw new Error('No "things" list in this JSON');
    });
    await render();
    await paste('{ "nope": 1 }');
    expect(host.querySelector('textarea')!.value).toBe('{ "nope": 1 }');
    expect(host.querySelector('.error-text')!.textContent).toContain('No "things" list');
  });

  it('says why the JSON cannot be read, showing no preview', async () => {
    read = vi.fn((): { rows: ImportRow<It>[] } => {
      throw new Error('This is a site templates file: import it in Site templates.');
    });
    await render();
    await paste();
    expect(host.querySelector('.import-preview')).toBeNull();
    expect(host.querySelector('.error-text')!.textContent).toContain('This is a site templates file');
  });

  it('reads a URL once its site is granted, as a raw file', async () => {
    const fetch = vi.fn(async () => new Response('{"things":[]}'));
    vi.stubGlobal('fetch', fetch);
    await render();
    await menu('Import');
    await click(button('From URL…'));
    const url = host.querySelector<HTMLInputElement>('input[aria-label="JSON URL"]')!;
    await type(url, 'http://example.com/t.json');
    await click(button('Read it'));
    expect(host.textContent).toContain('Use an https:// address.');
    expect(askOrigins).not.toHaveBeenCalled();
    vi.mocked(askOrigins).mockResolvedValueOnce(false);
    await type(url, 'https://example.com/t.json');
    await click(button('Read it'));
    expect(host.textContent).toContain('Access to https://example.com/* was not granted.');
    expect(fetch).not.toHaveBeenCalled();
    await type(url, 'https://github.com/example/things/blob/main/t.json');
    await click(button('Read it'));
    expect(askOrigins).toHaveBeenLastCalledWith('https://raw.githubusercontent.com/*');
    expect(fetch).toHaveBeenCalledWith('https://raw.githubusercontent.com/example/things/main/t.json', expect.anything());
    expect(read).toHaveBeenCalledWith('{"things":[]}');
    expect(host.querySelector('.import-preview')!.textContent).toContain('4 things in raw.githubusercontent.com');
  });
});
