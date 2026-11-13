// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSecretDb, fakeStorage } from './fakes/browser';
import { buttonNamed, pageBrowser, pageGlobals, settle, typeInto } from './fakes/panel';

// Settings → Skills and Site templates, on the Options page: one written in the editor is saved (not
// while it has a problem, which the editor lists), opened from the list and edited, switched off from
// the list, and deleted once confirmed in the page; a built-in one is read-only.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
pageGlobals();
const storage = fakeStorage();
const secrets = fakeSecretDb();
const fake = pageBrowser(storage);
vi.mock('../src/storage/secret-db', () => secrets);
vi.mock('wxt/browser', () => ({ browser: fake.browser }));

const { skillStore } = await import('../src/skills/store');
const { templateStore } = await import('../src/templates/store');
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
const field = (text: string) => [...box.querySelectorAll('main label')].find((l) => l.textContent!.startsWith(text))!.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea')!;
const footer = () => box.querySelector('main .editor')!;
const save = () => buttonNamed(footer(), 'Save')!;
const problems = () => [...footer().querySelectorAll('.problems li')].map((li) => li.textContent);
const rowNamed = (name: string) => [...box.querySelectorAll('main table tbody tr')].find((tr) => tr.querySelector('.item-name')?.textContent === name);
const mine = async () => (await skillStore.load()).filter((s) => !s.builtin);
const skill = { id: 's1', name: 'review-pr', description: 'Reviews a pull request', matches: [], body: '1. Read the diff.', references: [], enabled: true };

beforeEach(() => {
  storage.reset();
  secrets.data.clear();
});
afterEach(() => {
  act(() => root.unmount());
  box.remove();
});

describe('Settings → Skills', () => {
  it('a new one is saved once it has no problem, and listed', async () => {
    await open('#skills');
    await click(buttonNamed(box, '＋ New skill')!);
    expect(location.hash).toBe('#skills/new');
    expect(save().disabled).toBe(true);
    await typeInto(field('Name'), 'Write Notes');
    expect(problems()).toContain('Name: lowercase letters, digits and dashes (e.g. "review-pr").');
    await typeInto(field('Name'), 'write-notes');
    await typeInto(field('Description'), 'Writes meeting notes');
    await typeInto(box.querySelector('textarea[aria-label="Instructions"]')!, '1. List the decisions.');
    expect(problems()).toEqual([]);
    await click(save());
    expect(location.hash).toBe('#skills');
    expect(await mine()).toEqual([expect.objectContaining({ name: 'write-notes', description: 'Writes meeting notes', body: '1. List the decisions.', enabled: true })]);
    expect(rowNamed('write-notes')).toBeDefined();
  });

  it('opened from the list and edited', async () => {
    await skillStore.save(skill);
    await open('#skills');
    await click(rowNamed('review-pr')!.querySelector('.item-name')!);
    expect(location.hash).toBe('#skills/s1');
    await typeInto(field('Description'), 'Reviews a pull request, file by file');
    await click(save());
    expect((await mine())[0]!.description).toBe('Reviews a pull request, file by file');
  });

  it('switched off from the list', async () => {
    await skillStore.save(skill);
    await open('#skills');
    await click(rowNamed('review-pr')!.querySelector('input[role="switch"]')!);
    expect((await mine())[0]!.enabled).toBe(false);
  });

  it('deleted once confirmed in the page', async () => {
    await skillStore.save(skill);
    await open('#skills/s1');
    await click(buttonNamed(footer(), 'Delete')!);
    expect(await mine()).toHaveLength(1);
    await click(buttonNamed(footer().querySelector('[role="group"][aria-label="Delete it?"]')!, 'Delete')!);
    expect(await mine()).toEqual([]);
    expect(location.hash).toBe('#skills');
  });

  it('a built-in one opens read-only, with no Save or Delete', async () => {
    const builtin = (await skillStore.load()).find((s) => s.builtin)!; // skills/*/SKILL.md
    await open(`#skills/${encodeURIComponent(builtin.id)}`);
    expect(footer().textContent).toContain('Built-in skills are read-only.');
    expect(field('Name').disabled).toBe(true);
    expect(buttonNamed(footer(), 'Save')).toBeUndefined();
    expect(buttonNamed(footer(), 'Delete')).toBeUndefined();
  });
});

describe('Settings → Site templates', () => {
  const template = { id: 't1', name: 'shop', description: 'Products', matches: ['*://shop.example.com/*'], views: [{ name: 'main', paths: ['*'], replacePage: false, body: '{{ page | one: "h1" }}' }], enabled: true };
  const mineT = async () => (await templateStore.load()).filter((t) => !t.builtin);

  it('a new one lists what it lacks, and is saved once it has it', async () => {
    await open('#site-templates');
    await click(buttonNamed(box, '＋ New site')!);
    await typeInto(field('Name'), 'news');
    expect(problems()).toContain('URL patterns: at least one (e.g. *://www.youtube.com/*).');
    await typeInto(field('Website'), '*://news.example.com/*');
    await typeInto(box.querySelector('textarea[aria-label="Template of the view main"]')!, '{{ page | one: "h1" }}');
    expect(problems()).toEqual([]);
    await click(save());
    expect(await mineT()).toEqual([expect.objectContaining({ name: 'news', matches: ['*://news.example.com/*'], views: [expect.objectContaining({ name: 'main', body: '{{ page | one: "h1" }}' })] })]);
  });

  it('a view added and named is saved with it', async () => {
    await templateStore.save(template);
    await open('#site-templates/t1');
    await click(buttonNamed(footer(), '＋ Add view')!);
    const added = box.querySelector('fieldset[aria-label="View view-2"]')!;
    await typeInto([...added.querySelectorAll('label')].find((l) => l.textContent!.startsWith('Paths'))!.querySelector('textarea')!, '/p/*');
    await typeInto(added.querySelector('textarea[aria-label="Template of the view view-2"]')!, '{{ page | one: "h2" }}');
    await click(save());
    expect((await mineT())[0]!.views.map((v) => [v.name, v.paths])).toEqual([['main', ['*']], ['view-2', ['/p/*']]]);
  });

  it('deleted once confirmed in the page', async () => {
    await templateStore.save(template);
    await open('#site-templates/t1');
    await click(buttonNamed(footer(), 'Delete')!);
    await click(buttonNamed(footer().querySelector('[role="group"][aria-label="Delete it?"]')!, 'Delete')!);
    expect(await mineT()).toEqual([]);
  });
});
