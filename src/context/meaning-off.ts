// The conversations "Match by meaning" was left out of, from the ✨ menu. Unlike the menu's other rows,
// this one lasts: forgetting it when the panel closes would send text to the embeddings provider after
// the user said not to. Kept by conversation id, so it follows one to the floating chat or from history;
// and the worker reads it before each query (context/turn), whatever the panel knows by then.
import { browser } from 'wxt/browser';
import { storageRecord } from '../storage/area';
import { serialized } from '../storage/serial';
import { watchKey } from '../storage/watch';

const KEY = 'memoryMeaningOff';
const MOST = 500; // the latest kept

const inTurn = serialized(KEY); // two windows choosing at once: neither choice lost
const read = () => storageRecord<number>('local', KEY);

export const meaningOffFor = async (id: string | undefined): Promise<boolean> => !!id && id in (await read());

export const setMeaningOff = (id: string, off: boolean): Promise<void> =>
  inTurn(async () => {
    const { [id]: _, ...others } = await read();
    const kept = off ? [...Object.entries(others), [id, Date.now()] as [string, number]].sort(([, a], [, b]) => a - b).slice(-MOST) : Object.entries(others);
    await browser.storage.local.set({ [KEY]: Object.fromEntries(kept) });
  });

// Calls back with the ids now, and whenever they change; returns the unsubscribe.
export function onMeaningOff(cb: (ids: Set<string>) => void): () => void {
  const tell = () => void read().then((r) => cb(new Set(Object.keys(r))));
  tell();
  return watchKey('local', KEY, tell);
}
