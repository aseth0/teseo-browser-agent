// The tabs runs use and the tabs watched (watches/run), not discarded by the browser to save
// memory while one goes on (a discarded page loses its floating chat, what the run reads and the
// watch). One registry for both, so that neither gives back a tab the other still holds: a run's tab
// as it was once no run holds it and no watch is on it; a watched one discardable once its last
// watch ends and no run holds it. The watches are stored (watches/store), so they outlive this
// worker. The runs' holds, and the background tabs sub-agents open (background/sub-agent), are
// kept in storage.session (RUN_TABS), so that a worker that starts again after one died mid-run
// gives them back (recover).
import { browser } from 'wxt/browser';
import { loadWatches } from './store';

// { held, opened }: the tabs runs made not discardable (they were), and those sub-agents opened.
export const RUN_TABS = 'runTabs';
const tabIds = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x)) : []);

export function createTabHolds() {
  // tab → the runs holding it, and whether it goes back to discardable once they end (it was, or a
  // watch that made it not ended meanwhile).
  const runHolds = new Map<number, { runs: number; restore: boolean }>();
  const watched = async (id: number) => (await loadWatches()).some((w) => w.tabId === id);
  const discardable = (id: number) => browser.tabs.update(id, { autoDiscardable: true }).catch(() => undefined);
  const opened = new Set<number>(); // by sub-agents, open still

  // The record, written as it is now, one write at a time; none before what a dead worker left is
  // read (recover), or it would be lost.
  let recovered!: () => void;
  const readFirst = new Promise<void>((resolve) => (recovered = resolve));
  let writing = Promise.resolve();
  const keep = () => {
    writing = writing
      .then(() => readFirst)
      .then(() => browser.storage.session.set({ [RUN_TABS]: { held: [...runHolds].filter(([, h]) => h.restore).map(([id]) => id), opened: [...opened] } }))
      .catch(() => undefined);
  };

  // A run's tabs held; resolves to their release.
  const holdForRun = async (ids: (number | undefined)[]) => {
    const held: number[] = [];
    for (const id of new Set(ids.filter((t): t is number => t !== undefined))) {
      let hold = runHolds.get(id);
      if (!hold) {
        const t = await browser.tabs.get(id).catch(() => undefined);
        if (!t) continue;
        const restore = t.autoDiscardable === true;
        if (restore && !(await browser.tabs.update(id, { autoDiscardable: false }).catch(() => undefined))) continue;
        // Held meanwhile by another run (the awaits above): that one's hold is the one counted.
        hold = runHolds.get(id) ?? { runs: 0, restore };
        runHolds.set(id, hold);
        if (hold.restore) keep();
      }
      hold.runs++;
      held.push(id);
    }
    return async () => {
      for (const id of held) {
        const hold = runHolds.get(id);
        if (!hold || --hold.runs) continue;
        runHolds.delete(id);
        if (hold.restore) keep();
        if (hold.restore && !(await watched(id))) await discardable(id);
      }
    };
  };

  // A watch started on the tab (stored before): not discarded while it runs.
  const watchStarted = (id: number) => browser.tabs.update(id, { autoDiscardable: false }).catch(() => undefined);

  // A watch ended (taken from the store before): the tab discardable once no watch nor run holds it.
  const watchEnded = async (id: number) => {
    if (await watched(id)) return;
    const hold = runHolds.get(id);
    if (hold) {
      hold.restore = true;
      keep();
    } else await discardable(id);
  };

  // A background tab a sub-agent opened, and closed.
  const openedForRun = (id: number) => {
    opened.add(id);
    keep();
  };
  const closedForRun = (id: number) => {
    if (opened.delete(id)) keep();
  };

  // At the worker's start, what one that died mid-run left: its runs' tabs discardable again (unless
  // watched; held by a run started since: once that ends), its sub-agents' tabs closed.
  const recover = async () => {
    try {
      const stored: Record<string, unknown> = await browser.storage.session.get(RUN_TABS).catch(() => ({}));
      const left = (stored[RUN_TABS] ?? {}) as { held?: unknown; opened?: unknown };
      for (const id of tabIds(left.opened)) if (!opened.has(id)) await browser.tabs.remove(id).catch(() => undefined);
      for (const id of tabIds(left.held)) {
        const hold = runHolds.get(id);
        if (hold) hold.restore = true;
        else if (!(await watched(id).catch(() => false))) await discardable(id);
      }
    } finally {
      recovered();
      keep();
    }
    await writing;
  };

  return { holdForRun, watchStarted, watchEnded, openedForRun, closedForRun, recover };
}

// The worker's one registry.
export const tabHolds = createTabHolds();
