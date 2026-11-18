// Calls back when one storage key changes, here or in another page; returns the unsubscribe.
import { browser } from 'wxt/browser';

type StorageAreaName = 'local' | 'session' | 'sync';
export interface KeyChange {
  oldValue?: unknown;
  newValue?: unknown;
}

// The storage's change event; returns the unsubscribe. A content script cut off from the extension (reloaded
// under its page) has no browser.storage any more: nothing is left to unsubscribe from, and that copy must
// not throw while it leaves the page (widget/ui/lifecycle stop, entrypoints/page-widget retire).
export function onStorageChanged<C>(listener: (changes: Record<string, C>, area: string) => void): () => void {
  browser.storage.onChanged.addListener(listener as (changes: Record<string, unknown>, area: string) => void);
  return () => {
    try {
      browser.storage.onChanged.removeListener(listener as (changes: Record<string, unknown>, area: string) => void);
    } catch {
      // cut off: the listener went with the extension
    }
  };
}

export function watchKey(areas: StorageAreaName | StorageAreaName[], key: string, cb: (change: KeyChange) => void): () => void {
  const wanted = ([] as string[]).concat(areas);
  const listener = (changes: Record<string, KeyChange>, area: string) => {
    if (wanted.includes(area) && key in changes) cb(changes[key]!);
  };
  return onStorageChanged(listener);
}
