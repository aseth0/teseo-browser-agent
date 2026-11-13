import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeStorage } from './fakes/browser';

// Reads are slow, so two changes overlap.
const storage = fakeStorage({ delayMs: 5 });
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));

const { createCollection } = await import('../src/storage/collection');

describe('createCollection', () => {
  it('keeps both of two changes made at once', async () => {
    const items = createCollection<{ id: string; enabled: boolean; builtin?: boolean }>('things', [{ id: 'built', builtin: true }]);
    await Promise.all([items.save({ id: 'a', enabled: true }), items.save({ id: 'built', enabled: false, builtin: true }), items.save({ id: 'b', enabled: true })]);
    expect(await items.load()).toEqual([{ id: 'built', builtin: true, enabled: false }, { id: 'a', enabled: true }, { id: 'b', enabled: true }]);
  });
  type Thing = { id: string; enabled: boolean; builtin?: boolean; name?: string; count?: number };

  it('changes an item as stored, keeping a change made meanwhile', async () => {
    const items = createCollection<Thing>('updated', []);
    await items.save({ id: 'a', enabled: true, name: 'a', count: 0 });
    // The page saw it before the rename; its toggle keeps the rename.
    await Promise.all([items.save({ id: 'a', enabled: true, name: 'renamed', count: 0 }), items.update('a', { enabled: false })]);
    expect(await items.load()).toEqual([{ id: 'a', enabled: false, name: 'renamed', count: 0 }]);
    await Promise.all([1, 2, 3].map(() => items.update('a', (t) => ({ ...t, count: (t.count ?? 0) + 1 }))));
    expect((await items.load())[0]!.count).toBe(3);
  });

  it('does not bring back an item removed, and only switches a built-in one', async () => {
    const items = createCollection<Thing>('gone', [{ id: 'built', builtin: true, name: 'built' }]);
    await items.save({ id: 'a', enabled: true });
    await items.remove('a');
    expect(await items.update('a', { enabled: true })).toBeUndefined();
    expect(await items.update('built', { enabled: false, name: 'changed' })).toEqual({ id: 'built', builtin: true, name: 'built', enabled: false });
    expect(await items.load()).toEqual([{ id: 'built', builtin: true, name: 'built', enabled: false }]);
    expect(await items.update('new', { enabled: false }, () => ({ id: 'new', enabled: true, name: 'fallback' }))).toEqual({ id: 'new', enabled: false, name: 'fallback' });
  });

  it('saves and removes many at once, in one write', async () => {
    const items = createCollection<Thing>('many', [{ id: 'built', builtin: true }]);
    const set = vi.spyOn(storage.local, 'set');
    await items.saveMany([{ id: 'a', enabled: true }, { id: 'b', enabled: false }, { id: 'built', builtin: true, enabled: false }]);
    expect(set).toHaveBeenCalledTimes(1);
    expect(await items.load()).toEqual([{ id: 'built', builtin: true, enabled: false }, { id: 'a', enabled: true }, { id: 'b', enabled: false }]);
    await items.removeMany(['a', 'b']);
    expect(set).toHaveBeenCalledTimes(2);
    expect((await items.load()).map((t) => t.id)).toEqual(['built']);
    await items.saveMany([]);
    await items.removeMany([]);
    expect(set).toHaveBeenCalledTimes(2); // nothing to do: nothing written
    expect(items.key).toBe('many');
  });
});

describe('a collection stored in another shape', () => {
  it('reads as empty, and a save writes over it, instead of throwing on every load', async () => {
    const items = createCollection<{ id: string; enabled: boolean }>('odd', []);
    storage.local.data.odd = { user: 'not a list', disabledBuiltins: 3 };
    expect(await items.load()).toEqual([]);
    storage.local.data.odd = { user: [null, 7, { id: 'a', enabled: true }] };
    expect(await items.load()).toEqual([{ id: 'a', enabled: true }]);
    storage.local.data.odd = 'garbage';
    await items.save({ id: 'b', enabled: true });
    expect(await items.load()).toEqual([{ id: 'b', enabled: true }]);
  });
});
