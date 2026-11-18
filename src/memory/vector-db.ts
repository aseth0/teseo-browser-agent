// The vectors of the memory items (memory/indexer), in a database of their own in the extension's
// IndexedDB: adding them to storage/secret-db's would mean a new version of it, which an older build
// sharing the profile could then no longer open, losing its secrets. Derived data: never exported.
import { browser } from 'wxt/browser';

export const VECTOR_DB = 'browser-agent-vectors';
const STORE = 'vectors';

export interface VectorRecord {
  itemId: string;
  providerId: string;
  model: string;
  dimensions: number;
  hash: string; // of the exact text sent (memory/semantic documentText, textHash)
  endpoint?: string; // the server's (memory/semantic endpointHash); not in an older build's records
  vector: Float32Array;
}

// Only in the extension's own pages and worker: elsewhere it would open the page's database.
const trusted = () => globalThis.location?.origin === new URL(browser.runtime.getURL('/')).origin;

// A database of vectors by its name: the memory items' (VECTOR_DB) and the tool groups' (tools/match-meaning),
// each its own, so that one's pruning (memory/indexer drops what is no item) never touches the other's.
export function vectorDb(name: string) {
  let db: Promise<IDBDatabase> | undefined;
  const open = () =>
    (db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'itemId' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Could not open the vectors database.'));
    }).catch((e: unknown) => {
      db = undefined; // tried again next time
      throw e;
    }));

  async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest | void): Promise<T> {
    if (!trusted()) throw new Error("Vectors are only read in the extension's own pages.");
    const tx = (await open()).transaction(STORE, mode);
    const req = work(tx.objectStore(STORE));
    return new Promise<T>((resolve, reject) => {
      tx.oncomplete = () => resolve(req?.result as T);
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('The vectors database failed.'));
    });
  }

  return {
    read: () => run<VectorRecord[]>('readonly', (s) => s.getAll()),
    write: (records: VectorRecord[]) => run<void>('readwrite', (s) => records.forEach((r) => s.put(r))),
    delete: (ids: string[]) => run<void>('readwrite', (s) => ids.forEach((id) => s.delete(id))),
  };
}

const memoryVectors = vectorDb(VECTOR_DB);
export const readVectors = memoryVectors.read;
export const writeVectors = memoryVectors.write;
export const deleteVectors = memoryVectors.delete;
