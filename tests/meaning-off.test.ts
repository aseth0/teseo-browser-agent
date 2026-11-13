// "Match by meaning" left out of a conversation lasts (context/meaning-off): unlike the other rows of
// the ✨ menu, forgetting it would send text to a provider after the user said not to.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeStorage } from './fakes/browser';

const storage = fakeStorage();
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));
const { meaningOffFor, onMeaningOff, setMeaningOff } = await import('../src/context/meaning-off');

beforeEach(() => storage.reset());

describe('the choice per conversation', () => {
  it('is kept for that conversation only', async () => {
    await setMeaningOff('c1', true);
    expect(await meaningOffFor('c1')).toBe(true);
    expect(await meaningOffFor('c2')).toBe(false);
  });

  it('is nothing for no conversation', async () => {
    expect(await meaningOffFor(undefined)).toBe(false);
  });

  it('goes when turned back on', async () => {
    await setMeaningOff('c1', true);
    await setMeaningOff('c1', false);
    expect(await meaningOffFor('c1')).toBe(false);
  });

  it('keeps the latest 500, dropping the oldest', async () => {
    const now = vi.spyOn(Date, 'now');
    for (let i = 0; i < 501; i++) {
      now.mockReturnValue(1000 + i);
      await setMeaningOff(`c${i}`, true);
    }
    now.mockRestore();
    expect(await meaningOffFor('c0')).toBe(false);
    expect(await meaningOffFor('c1')).toBe(true);
    expect(await meaningOffFor('c500')).toBe(true);
  });

  it('keeps both of two choices made at once', async () => {
    await Promise.all([setMeaningOff('c1', true), setMeaningOff('c2', true)]);
    expect(await meaningOffFor('c1')).toBe(true);
    expect(await meaningOffFor('c2')).toBe(true);
  });

  it('reads as nothing what an unknown build left there', async () => {
    await storage.local.set({ memoryMeaningOff: 'not a record' });
    expect(await meaningOffFor('c1')).toBe(false);
    await setMeaningOff('c1', true);
    expect(await meaningOffFor('c1')).toBe(true);
  });

  it('tells who watches, with the current ids', async () => {
    const seen = vi.fn();
    const stop = onMeaningOff(seen);
    await vi.waitFor(() => expect(seen).toHaveBeenCalled());
    await setMeaningOff('c1', true);
    await vi.waitFor(() => expect(seen.mock.lastCall![0]).toEqual(new Set(['c1'])));
    stop();
  });
});
