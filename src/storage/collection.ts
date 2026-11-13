// A stored list of items (skills, page templates): the built-in ones, bundled at build time and
// read-only (only switched on or off), plus the user's own, under one storage key.
import { browser } from 'wxt/browser';
import { isObject } from '../core/util';
import { storageGet } from './area';
import { serialized } from './serial';
import { watchKey } from './watch';

export interface CollectionItem {
  id: string;
  enabled: boolean;
  builtin?: boolean;
}

interface Stored<T> {
  user: T[];
  disabledBuiltins: string[]; // ids
}

// A change to an item: the fields to set, or the item made from the one stored.
type ItemChange<T> = Partial<T> | ((item: T) => T);

export interface Collection<T> {
  readonly key: string; // its storage key
  load(): Promise<T[]>;
  save(item: T): Promise<void>;
  saveMany(items: T[]): Promise<void>;
  // Changes the item as stored when the change is made (not as a page last saw it); none when it is
  // gone (a toggle does not bring back one just deleted). `missing`: the item to change when it is not
  // stored yet. A built-in one only switches on or off.
  update(id: string, change: ItemChange<T>, missing?: () => T): Promise<T | undefined>;
  remove(id: string): Promise<void>;
  removeMany(ids: string[]): Promise<void>;
  onChanged(cb: (items: T[]) => void): () => void;
}

// `upgrade`: brings items stored in an older format up to date, as they are read.
export function createCollection<T extends CollectionItem>(key: string, builtins: Omit<T, 'enabled'>[], upgrade: (item: T) => T = (item) => item): Collection<T> {
  // What is not of this shape (written otherwise by another build) is read as empty, never thrown on.
  const stored = (v: unknown): Stored<T> => {
    const { user, disabledBuiltins } = isObject(v) ? (v as Partial<Stored<T>>) : {};
    return {
      user: Array.isArray(user) ? user.filter((u): u is T => isObject(u) && typeof u.id === 'string').map(upgrade) : [],
      disabledBuiltins: Array.isArray(disabledBuiltins) ? disabledBuiltins.filter((id) => typeof id === 'string') : [],
    };
  };
  const read = async () => stored(await storageGet<unknown>('local', key));
  const write = (s: Stored<T>) => browser.storage.local.set({ [key]: s });
  const combine = (s: Stored<T>): T[] => [...builtins.map((b) => ({ ...b, enabled: !s.disabledBuiltins.includes(b.id) }) as T), ...s.user];
  // Saves and removals one at a time: two quick toggles, or a save by the model, keep each other's change.
  const serial = serialized(`collection:${key}`);
  const put = (s: Stored<T>, item: T) => {
    if (item.builtin) {
      s.disabledBuiltins = item.enabled ? s.disabledBuiltins.filter((id) => id !== item.id) : [...new Set([...s.disabledBuiltins, item.id])];
    } else {
      const i = s.user.findIndex((u) => u.id === item.id);
      if (i >= 0) s.user[i] = item;
      else s.user.push(item);
    }
  };
  // None to save or remove: nothing written (nor a change event).
  const saveMany = async (items: T[]) => {
    if (!items.length) return;
    await serial(async () => {
      const s = await read();
      for (const item of items) put(s, item);
      await write(s);
    });
  };
  const removeMany = async (ids: string[]) => {
    if (!ids.length) return;
    await serial(async () => {
      const s = await read();
      await write({ ...s, user: s.user.filter((u) => !ids.includes(u.id)) });
    });
  };

  return {
    key,
    load: async () => combine(await read()),
    save: (item) => saveMany([item]),
    saveMany,
    update: (id, change, missing) => serial(async () => {
      const s = await read();
      const old = combine(s).find((i) => i.id === id) ?? missing?.();
      if (!old) return undefined;
      const changed = typeof change === 'function' ? change(old) : { ...old, ...change };
      const item = old.builtin ? { ...old, enabled: changed.enabled } : { ...changed, id };
      put(s, item);
      await write(s);
      return item;
    }),
    remove: (id) => removeMany([id]),
    removeMany,
    onChanged(cb) {
      return watchKey('local', key, (c) => cb(combine(stored(c.newValue))));
    },
  };
}
