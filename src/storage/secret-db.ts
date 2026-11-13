// The extension's own IndexedDB (its chrome-extension:// origin): its pages and its worker share it,
// and no content script can open it (there, indexedDB is the page's). One object store of values by
// name. Unlike storage.local, nothing in it is read nor told to the content scripts.
import { browser } from 'wxt/browser';

const DB = 'browser-agent';
const STORE = 'secrets';

// Only in the extension's own pages and worker: elsewhere it would open the page's database.
const trusted = () => globalThis.location?.origin === new URL(browser.runtime.getURL('/')).origin;

let db: Promise<IDBDatabase> | undefined;
const open = () =>
  (db ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open the secrets database.'));
  }).catch((e: unknown) => {
    db = undefined; // tried again next time
    throw e;
  }));

async function request<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  if (!trusted()) throw new Error("Secrets are only read in the extension's own pages.");
  const tx = (await open()).transaction(STORE, mode);
  const req = run(tx.objectStore(STORE));
  return new Promise<T>((resolve, reject) => {
    tx.oncomplete = () => resolve(req.result as T);
    tx.onerror = tx.onabort = () => reject(tx.error ?? req.error ?? new Error('The secrets database failed.'));
  });
}

export const dbGet = <T>(name: string) => request<T | undefined>('readonly', (s) => s.get(name));
export const dbSet = (name: string, value: unknown) => request<void>('readwrite', (s) => (value === undefined ? s.delete(name) : s.put(value, name)));
