// A value of browser.storage, by its key: what the extension wrote there, so typed as the caller
// says (the one cast of these reads). Undefined when the key is not there.
import { browser } from 'wxt/browser';
import { isObject } from '../core/util';

type Area = 'local' | 'session';

export async function storageGet<T>(area: Area, key: string): Promise<T | undefined> {
  return (await browser.storage[area].get(key))[key] as T | undefined;
}

// The same for a record by name (empty when there is none, or what is there is not an object: a
// build that wrote it otherwise) and for a list (empty when it is not one).
export async function storageRecord<T>(area: Area, key: string): Promise<Record<string, T>> {
  const v = await storageGet<Record<string, T>>(area, key);
  return isObject(v) ? v : {};
}
export async function storageList<T>(area: Area, key: string): Promise<T[]> {
  const v = await storageGet<T[]>(area, key);
  return Array.isArray(v) ? v : [];
}
