// What is learned per model reaches the budget as numbers only: a value of another shape (written by
// another build in the shared profile) counts as not learned, never as NaN.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeStorage } from './fakes/browser';

const storage = fakeStorage();
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));
const { modelMap } = await import('../src/context/model-map');
const { storageList, storageRecord } = await import('../src/storage/area');

beforeEach(() => storage.reset());

describe('modelMap', () => {
  it('reads only the numbers there', async () => {
    storage.local.data.windows = { 'p|a': 8000, 'p|b': 'big', 'p|c': null, 'p|d': Infinity };
    const map = modelMap('windows');
    expect(await map.all()).toEqual({ 'p|a': 8000 });
    expect(await map.of('p', 'b')).toBeUndefined();
  });

  it('starts empty over what is not a record', async () => {
    storage.local.data.windows = [1, 2];
    const map = modelMap('windows');
    await map.change('p', 'a', () => 4096);
    expect(storage.local.data.windows).toEqual({ 'p|a': 4096 });
  });
});

describe('storageRecord and storageList', () => {
  it('give empty ones for a value of another shape', async () => {
    storage.session.data.r = 'text';
    storage.session.data.l = { 0: 'x' };
    expect(await storageRecord('session', 'r')).toEqual({});
    expect(await storageList('session', 'l')).toEqual([]);
    expect(await storageList('session', 'none')).toEqual([]);
  });
});
