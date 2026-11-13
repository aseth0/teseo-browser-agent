import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeSecretDb, fakeStorage } from './fakes/browser';
import { TOOL_SETTINGS } from './helpers';

const storage = fakeStorage();
const secrets = fakeSecretDb();
vi.mock('../src/storage/secret-db', () => secrets);
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));
const { stripMarks } = await import('../src/core/model-texts');
const { memoryInstructions, memorySiteItems } = await import('../src/memory/prompt');
const { memoryLabel, memoryStore, newMemoryItem } = await import('../src/memory/store');
const { memoryTools } = await import('../src/memory/tools');
const { searchMemory } = await import('../src/memory/items');
const { exportMemory, importMemory } = await import('../src/memory/io');
type MemoryItem = import('../src/memory/store').MemoryItem;

const item = (id: string, change: Partial<MemoryItem> = {}): MemoryItem => ({ ...newMemoryItem([], { text: `Rule ${id}`, ...change }), id, updatedAt: change.updatedAt ?? 1 });
const tool = (name: string) => memoryTools().find((t) => t.name === name)!;
const ctx = { settings: TOOL_SETTINGS, signal: new AbortController().signal };
const said = (r: { type: string; text?: string }) => (r.type === 'text' ? r.text ?? '' : '');

beforeEach(() => storage.reset());

describe('a memory item title', () => {
  it("is its own, else the text's first line", () => {
    expect(memoryLabel({ title: 'Invoices', text: 'Send them to accounting\nby Friday' })).toBe('Invoices');
    expect(memoryLabel({ text: 'Send them to accounting\nby Friday' })).toBe('Send them to accounting');
    expect(memoryLabel({ title: '  ', text: 'Send them to accounting' })).toBe('Send them to accounting');
    expect(memoryLabel({ text: 'x'.repeat(100) })).toHaveLength(80);
  });

  it('is what the index shows; items sent whole carry it before their text', () => {
    const all = [item('m-idx', { title: 'Invoices', text: 'Send them to accounting\nby Friday' }), item('m-pin', { pinned: true, title: 'Language', text: 'Answer in English.' })];
    const system = stripMarks(memoryInstructions(all, { reads: true, saves: true }));
    expect(system).toContain('- m-idx: Invoices');
    expect(system).not.toContain('Send them to accounting');
    expect(system).toContain('- [m-pin] Language: Answer in English.');
    const [block] = memorySiteItems([item('m-s', { domains: ['example.com'], title: 'Account', text: 'Use the staging account.' })], 'example.com', []);
    expect(stripMarks(block!.text)).toContain('- [m-s] Account: Use the staging account.');
  });

  it('weighs more than the text in a search', () => {
    const all = [item('a', { title: 'Travel', text: 'Coffee orders: oat milk' }), item('b', { title: 'Coffee', text: 'Beans from the shop' }), item('c', { text: 'Window seat' })];
    expect(searchMemory(all, 'coffee').map((m) => m.id)).toEqual(['b', 'a']);
    expect(searchMemory(all, 'window').map((m) => m.id)).toEqual(['c']); // untitled: its first line
  });

  it('an item without its own title is sent and read as its text alone, its first line not twice', async () => {
    const untitled = item('m-u', { pinned: true, text: 'Prices in euros.\nAlways with VAT.' });
    const system = stripMarks(memoryInstructions([untitled], { reads: true, saves: false }));
    expect(system).toContain('- [m-u] Prices in euros.\nAlways with VAT.');
    expect(system).not.toContain('Prices in euros.: ');
    await memoryStore.saveMany([untitled]);
    expect(said(await tool('memory.read').run({ id: 'm-u' }, ctx))).toBe('Memory item m-u\n(pinned: yes; sites: every site; agents: every agent)\nPrices in euros.\nAlways with VAT.');
  });

  it('shows in memory.search, memory.list and memory.read', async () => {
    await memoryStore.save(item('m-1', { title: 'Invoices', text: 'Send them to accounting' }));
    expect(said(await tool('memory.search').run({ query: 'invoices' }, ctx))).toContain('- m-1 (every site): Invoices');
    expect(said(await tool('memory.list').run({}, ctx))).toContain('- m-1 (pinned: no; sites: every site): Invoices');
    expect(said(await tool('memory.read').run({ id: 'm-1' }, ctx))).toContain('Memory item m-1: Invoices\n(pinned: no; sites: every site; agents: every agent)\nSend them to accounting');
  });
});

describe('memory.save with a title', () => {
  const save = tool('memory.save');

  it('needs one on a new item, of at most 80 characters', async () => {
    await expect(save.describe!({ text: 'Prefer metric units.' }, ctx)).rejects.toThrow('A new item needs a title.');
    await expect(save.describe!({ title: ' ', text: 'Prefer metric units.' }, ctx)).rejects.toThrow('A new item needs a title.');
    await expect(save.describe!({ title: 'x'.repeat(81), text: 'Prefer metric units.' }, ctx)).rejects.toThrow('The title is longer than 80 characters.');
    const card = await save.describe!({ title: 'Units', text: 'Prefer metric units.' }, ctx);
    expect(card.details).toContainEqual(expect.objectContaining({ label: 'Title', value: 'Units', edit: { field: 'title', value: 'Units' } }));
    expect(said(await save.run({ title: ' Units ', text: 'Prefer metric units.' }, ctx))).toMatch(/^Saved to memory as m-\w+: Units\.$/);
    expect((await memoryStore.load())[0]).toMatchObject({ title: 'Units', text: 'Prefer metric units.' });
  });

  it('keeps it on an update that does not give one; empty, the first line stands in', async () => {
    await memoryStore.save(item('m-1', { title: 'Units', text: 'Prefer metric units.' }));
    await save.run({ id: 'm-1', text: 'Prefer metric units, and 24-hour time.' }, ctx);
    expect((await memoryStore.load())[0]).toMatchObject({ title: 'Units' });
    await save.run({ id: 'm-1', title: 'Units and time' }, ctx);
    expect((await memoryStore.load())[0]).toMatchObject({ title: 'Units and time', text: 'Prefer metric units, and 24-hour time.' });
    await save.run({ id: 'm-1', title: '' }, ctx);
    const [cleared] = await memoryStore.load();
    expect(cleared!.title).toBeUndefined();
    expect(memoryLabel(cleared!)).toBe('Prefer metric units, and 24-hour time.');
  });

  it('updates an item saved without one, which keeps none', async () => {
    await memoryStore.save(item('m-old', { text: 'Old rule\ndetail' }));
    await save.run({ id: 'm-old', pinned: true }, ctx);
    const [old] = await memoryStore.load();
    expect(old).toMatchObject({ pinned: true, title: undefined });
    expect(memoryLabel(old!)).toBe('Old rule');
  });

  it('lets the user edit it on the card', async () => {
    const edited = await save.withEdits!({ title: 'Units', text: 'Prefer metric units.' }, { title: 'Measures' }, ctx);
    expect(edited).toMatchObject({ title: 'Measures' });
  });
});

describe('a title with older builds (one shared profile)', () => {
  it('an item stored before titles reads as before', async () => {
    storage.local.data.memory = { user: [{ id: 'm-old', enabled: true, text: 'Old rule\ndetail', pinned: false, domains: [], agents: [], source: 'user', createdAt: 1, updatedAt: 1 }], disabledBuiltins: [] };
    const [old] = await memoryStore.load();
    expect(old!.title).toBeUndefined();
    expect(memoryLabel(old!)).toBe('Old rule');
  });

  it('stays through what an older build writes back: a change of the stored item, or the whole item re-saved', async () => {
    await memoryStore.save(item('m-1', { title: 'Units', text: 'Prefer metric units.' }));
    // An older build knows no title: it changes the item as stored (pin, switch) or saves the one it loaded, edited.
    await memoryStore.update('m-1', { pinned: true });
    const [loaded] = await memoryStore.load();
    await memoryStore.save({ ...loaded!, text: 'Prefer metric units always.' });
    expect((storage.local.data.memory as { user: MemoryItem[] }).user[0]).toMatchObject({ title: 'Units', pinned: true, text: 'Prefer metric units always.' });
  });

  it('a stored title that is not text is dropped', async () => {
    storage.local.data.memory = { user: [{ ...item('m-1'), title: 42 }], disabledBuiltins: [] };
    expect((await memoryStore.load())[0]!.title).toBeUndefined();
  });

  it('goes out and comes back in a JSON export; a file without one gives none', () => {
    const json = exportMemory([item('m-1', { title: 'Units' }), item('m-2')], []);
    expect(JSON.parse(json).memory[1]).not.toHaveProperty('title');
    const { items } = importMemory(json, [], []);
    expect(items.map((m) => m.title)).toEqual(['Units', undefined]);
  });
});
