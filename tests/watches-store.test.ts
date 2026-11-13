// A new tab watch is saved only while fewer than the most allowed run, judged as it is saved: two
// started at once cannot both pass the limit.
import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeStorage } from './fakes/browser';
import type { Watch } from '../src/watches/store';

const storage = fakeStorage();
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));
const { loadWatches, saveNewWatch } = await import('../src/watches/store');

const watch = (id: string): Watch => ({ id, tabId: 1, spec: { gone: 'x' }, notify: true, continueChat: false, setBy: 'agent', origin: 'https://shop.example.com', title: 't', createdAt: 0, expiresAt: 1 });
const tooMany = (n: number) => new Error(`${n} running`);

describe('saveNewWatch', () => {
  it('keeps to the most allowed, also for two at once', async () => {
    const both = await Promise.allSettled([saveNewWatch(watch('a'), 1, tooMany), saveNewWatch(watch('b'), 1, tooMany)]);
    expect(both.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await loadWatches()).toHaveLength(1);
  });
});
