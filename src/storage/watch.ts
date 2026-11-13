// Calls back when one storage key changes, here or in another page; returns the unsubscribe.
import { browser } from 'wxt/browser';

type StorageAreaName = 'local' | 'session' | 'sync';
export interface KeyChange {
  oldValue?: unknown;
  newValue?: unknown;
}

export function watchKey(areas: StorageAreaName | StorageAreaName[], key: string, cb: (change: KeyChange) => void): () => void {
  const wanted = ([] as string[]).concat(areas);
  const listener = (changes: Record<string, KeyChange>, area: string) => {
    if (wanted.includes(area) && key in changes) cb(changes[key]!);
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
