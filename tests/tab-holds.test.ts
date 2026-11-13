// Runs and watches hold tabs in one registry: neither makes discardable a tab the other still holds.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeStorage } from './fakes/browser';
import type { Watch } from '../src/watches/store';

const storage = fakeStorage();
const discardable = new Map<number, boolean>();
const removed: number[] = [];
const tabs = {
  remove: async (id: number) => void removed.push(id),
  get: async (id: number) => ({ id, autoDiscardable: discardable.get(id) }),
  update: async (id: number, { autoDiscardable }: { autoDiscardable: boolean }) => {
    discardable.set(id, autoDiscardable);
    return { id };
  },
};
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage, { tabs }) }));
const { RUN_TABS, createTabHolds } = await import('../src/watches/tab-holds');
const { saveNewWatch, takeWatch } = await import('../src/watches/store');

const watch = (id: string, tabId: number): Watch => ({ id, tabId, spec: { gone: 'x' }, notify: false, continueChat: false, setBy: 'agent', origin: 'https://shop.example.com', title: 't', createdAt: 0, expiresAt: 1 });
const startWatch = async (holds: ReturnType<typeof createTabHolds>, w: Watch) => {
  await saveNewWatch(w, 10, () => new Error('too many'));
  await holds.watchStarted(w.tabId);
};
const endWatch = async (holds: ReturnType<typeof createTabHolds>, w: Watch) => {
  await takeWatch(w.id);
  await holds.watchEnded(w.tabId);
};

beforeEach(() => {
  storage.reset();
  discardable.clear();
  discardable.set(1, true);
  removed.length = 0;
});

describe('the tab holds', () => {
  it('keep a tab watched during a run held once the run ends', async () => {
    const holds = createTabHolds();
    const release = await holds.holdForRun([1]);
    expect(discardable.get(1)).toBe(false);
    const w = watch('w', 1);
    await startWatch(holds, w);
    await release();
    expect(discardable.get(1)).toBe(false);
    await endWatch(holds, w);
    expect(discardable.get(1)).toBe(true);
  });

  it('keep a tab a run uses held once a watch on it ends', async () => {
    const holds = createTabHolds();
    const w = watch('w', 1);
    await startWatch(holds, w);
    const release = await holds.holdForRun([1]);
    await endWatch(holds, w);
    expect(discardable.get(1)).toBe(false);
    await release();
    expect(discardable.get(1)).toBe(true);
  });

  it('give a tab back once the last of two runs ends, and leave alone one the browser already keeps', async () => {
    const holds = createTabHolds();
    discardable.set(2, false);
    const [a, b] = await Promise.all([holds.holdForRun([1, 2]), holds.holdForRun([1])]);
    await a();
    expect(discardable.get(1)).toBe(false);
    await b();
    expect(discardable.get(1)).toBe(true);
    expect(discardable.get(2)).toBe(false);
  });
});

// The service worker may die mid-run: what its runs did to the tabs is kept in storage.session, and a
// worker that starts again undoes it.
describe('the tabs a dead worker left', () => {
  const kept = () => storage.session.data[RUN_TABS] as { held: number[]; opened: number[] };

  it('are kept while a run goes on, and forgotten once it ends', async () => {
    const holds = createTabHolds();
    await holds.recover();
    discardable.set(2, false);
    const release = await holds.holdForRun([1, 2]);
    holds.openedForRun(5);
    await vi.waitFor(() => expect(kept()).toEqual({ held: [1], opened: [5] })); // 2 was not discardable
    await release();
    holds.closedForRun(5);
    await vi.waitFor(() => expect(kept()).toEqual({ held: [], opened: [] }));
  });

  it('are given back at start: held tabs discardable, sub-agents\' tabs closed', async () => {
    discardable.set(1, false);
    discardable.set(2, false);
    storage.session.data[RUN_TABS] = { held: [1, 2], opened: [5, 6] };
    await saveNewWatch(watch('w', 2), 10, () => new Error('too many'));
    const holds = createTabHolds();
    await holds.recover();
    expect(discardable.get(1)).toBe(true);
    expect(discardable.get(2)).toBe(false); // watched
    expect(removed).toEqual([5, 6]);
    expect(kept()).toEqual({ held: [], opened: [] });
  });

  it('leave alone what a run started meanwhile holds, given back once it ends', async () => {
    discardable.set(1, false);
    storage.session.data[RUN_TABS] = { held: [1], opened: [] };
    const holds = createTabHolds();
    const release = await holds.holdForRun([1]);
    await holds.recover();
    expect(discardable.get(1)).toBe(false);
    await release();
    expect(discardable.get(1)).toBe(true);
  });

  it('ignore a record they cannot read', async () => {
    storage.session.data[RUN_TABS] = { held: 'all', opened: [5, 'x'] };
    const holds = createTabHolds();
    await holds.recover();
    expect(removed).toEqual([5]);
  });
});
