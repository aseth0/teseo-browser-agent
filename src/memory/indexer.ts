// Keeps the memory items' vectors current while Settings → Memory → Semantic search is on: embeds what is
// missing or no longer stands for its item, in batches, saving each, so a failure or a dead worker loses
// nothing (what is left is worked out again). Never on a message's path. Off, it sends nothing and the
// vectors stay, so that turning it back on sends nothing again.
import { browser } from 'wxt/browser';
import { errorText } from '../core/errors';
import { hostOf } from '../core/util';
import { hasAccess } from '../page/access';
import { embedTexts } from '../providers/embeddings';
import { storageGet } from '../storage/area';
import type { Settings } from '../storage/settings-types';
import { loadBlacklist } from '../word-blacklist/store';
import { documentText, endpointHash, indexable, isFresh, semanticTarget, textHash } from './semantic';
import type { MemoryItem } from './store';
import { deleteVectors, readVectors, writeVectors } from './vector-db';

export const MEMORY_INDEX_STATUS_KEY = 'memoryIndexStatus'; // in storage.local: what Settings shows
export const MEMORY_INDEX_BATCH = 32;
export const MEMORY_INDEX_TIMEOUT_MS = 25_000; // for one batch or a Test: a worker is ended past 30 seconds on one fetch

export interface IndexStatus {
  indexed: number;
  total: number;
  error?: string;
  // The length the model's vectors turned out to have when it is not the one Test found, for the target
  // (`key`, see targetKey) it was seen with: the stored vectors are kept to it rather than sent again on
  // each run, until Test is run again.
  returned?: { key: string; dimensions: number };
}

// What the index depends on, of the settings as stored: any other change, a key typed elsewhere in
// Settings, asks nothing of the provider, also while its batches keep failing.
const indexInputs = (settings: unknown) => {
  const { providers, memory } = (settings ?? {}) as Partial<Settings>;
  const { enabled, providerId, model, dimensions, documentPrefix } = memory?.semantic ?? {};
  return JSON.stringify([memory?.enabled, enabled, providerId, model, dimensions, documentPrefix, providers]);
};
export const indexInputsChanged = (before: unknown, after: unknown) => !before || indexInputs(before) !== indexInputs(after);

const changingLength = 'The model gives vectors of changing length.';
const targetKey = (providerId: string, model: string, endpoint: string, tested: number | undefined) => JSON.stringify([providerId, model, endpoint, tested ?? null]);

const report = async (status: IndexStatus) => {
  await browser.storage.local.set({ [MEMORY_INDEX_STATUS_KEY]: status });
  return status;
};

// `keepGoing`: asked before each batch, false when the settings or the items changed meanwhile.
export async function syncMemoryIndex(settings: Settings, items: MemoryItem[], keepGoing: () => boolean = () => true): Promise<IndexStatus> {
  const wanted = items.filter(indexable);
  const empty: IndexStatus = { indexed: 0, total: wanted.length };
  const target = semanticTarget(settings);
  if (!target) return empty;
  const { provider, model, semantic } = target;
  const tested = semantic.dimensions;
  let indexed = 0;
  let returned: IndexStatus['returned'];
  // What is reported: with the length the vectors have, when it is not the one Test found.
  const status = (error?: string): IndexStatus => {
    const mismatch = returned && `The model now gives vectors of ${returned.dimensions} dimensions, not the ${tested} Test found: run Test again in Settings → Memory.`;
    const shown = error ?? mismatch;
    return { indexed, total: wanted.length, ...(shown ? { error: shown } : {}), ...(returned ? { returned } : {}) };
  };
  try {
    const mask = (await loadBlacklist())?.blacklist.mask ?? ((s: string) => s);
    const endpoint = await endpointHash(provider.baseURL);
    const key = targetKey(provider.id, model, endpoint, tested);
    const before = await storageGet<IndexStatus>('local', MEMORY_INDEX_STATUS_KEY);
    if (tested !== undefined && before?.returned?.key === key && Number.isInteger(before.returned.dimensions)) returned = before.returned;
    const records = await readVectors();
    const stored = new Map(records.map((r) => [r.itemId, r]));
    const known = new Set(items.map((m) => m.id));
    const gone = records.filter((r) => !known.has(r.itemId)).map((r) => r.itemId);
    if (gone.length) await deleteVectors(gone);
    const texts = await Promise.all(wanted.map(async (m) => {
      const sent = documentText(m, semantic.documentPrefix, mask);
      return { id: m.id, sent, hash: await textHash(sent) };
    }));
    const stale = () => texts.filter((t) => {
      const r = stored.get(t.id);
      return !r || !isFresh(r, { providerId: provider.id, model, endpoint, dimensions: returned?.dimensions ?? tested }, t.hash);
    });
    let pending = stale();
    // An older build's, taken as this server's: marked as such, so that another server is told apart later.
    const unmarked = texts.flatMap((t) => {
      const r = stored.get(t.id);
      return r && r.endpoint === undefined && !pending.includes(t) ? [{ ...r, endpoint }] : [];
    });
    if (unmarked.length) await writeVectors(unmarked);
    indexed = wanted.length - pending.length;
    if (pending.length && !(await hasAccess(provider.baseURL))) {
      return await report(status(`No access to ${hostOf(provider.baseURL)}: allow it with Test in Settings → Memory.`));
    }
    await report(status());
    let learned = false;
    while (pending.length && keepGoing()) {
      const batch = pending.slice(0, MEMORY_INDEX_BATCH);
      const vectors = await embedTexts(provider, model, batch.map((t) => t.sent), AbortSignal.timeout(MEMORY_INDEX_TIMEOUT_MS));
      const written = batch.map((t, n) => ({ itemId: t.id, providerId: provider.id, model, endpoint, dimensions: vectors[n]!.length, hash: t.hash, vector: Float32Array.from(vectors[n]!) }));
      await writeVectors(written);
      written.forEach((r) => stored.set(r.itemId, r));
      // Vectors of another length than expected: what the model gives now is the truth, once per run (a
      // server whose answers keep changing length would never end).
      const length = written[0]!.dimensions;
      const expected = returned?.dimensions ?? tested;
      const relearned = expected !== undefined && length !== expected;
      if (relearned) {
        if (learned) throw new Error(changingLength);
        learned = true;
        returned = length === tested ? undefined : { key, dimensions: length };
      }
      const left = stale();
      if (!relearned && left.length >= pending.length) throw new Error(changingLength);
      pending = left;
      indexed = wanted.length - pending.length;
      await report(status());
    }
    return status();
  } catch (e) {
    return report(status(e instanceof DOMException && e.name === 'TimeoutError' ? 'The provider did not answer in time.' : errorText(e)));
  }
}

// One run at a time: a trigger while one runs tells it to stop before its next batch, and one more runs
// after it, with what is current by then.
export function indexRunner(work: (keepGoing: () => boolean) => Promise<unknown>): () => void {
  let running = false;
  let again = false;
  const start = () => {
    running = true;
    again = false;
    void work(() => !again)
      .catch((e: unknown) => console.error('[memory index]', e))
      .finally(() => {
        running = false;
        if (again) start();
      });
  };
  return () => {
    if (running) again = true;
    else start();
  };
}
