// A collection (storage/collection) whose items keep part of themselves in storage/secrets, by item
// id, apart from storage.local: there a content script could write it (an agent's sites and tools, a
// custom tool's headers). An item has that part only as kept there; one written to storage.local with
// none kept (a page's) gets what `put` gives without it. With `boundTo`, the part is kept with what it
// was saved for (a URL, what a tool does), and an item that now says another gets none either (its
// headers never go to a URL a page wrote). storage.local keeps the item as `strip` leaves it (none:
// whole), a copy that is never read for the part: what earlier versions read there.
import type { Collection, CollectionItem } from './collection';
import { once, onSecretChanged, readSecret, updateSecret, type SecretName } from './secrets';
import { serialized } from './serial';

type Kept<S> = S & { boundTo?: string };

interface SecretPart<T, S> {
  secret: SecretName;
  pick: (item: T) => S; // the part kept apart
  strip?: (item: T) => T; // the item as storage.local keeps it: without what may not be there (a secret)
  put: (item: T, part: S | undefined) => T; // the item with it; none: without one kept
  boundTo?: (item: T) => string | undefined;
  // An item brought up to date once joined (agents/builder upgradeBuilder).
  upgrade?: (item: T) => T;
}

// The part made of whole fields of the item; `empty`: those of an item without any kept.
export function fieldsPart<T, K extends keyof T>(fields: readonly K[], empty: (item: T) => Pick<T, K>): Pick<SecretPart<T, Pick<T, K>>, 'pick' | 'put'> {
  return {
    pick: (item) => Object.fromEntries(fields.map((f) => [f, item[f]])) as Pick<T, K>,
    put: (item, part) => ({ ...item, ...(part ?? empty(item)) }),
  };
}

type SecretPartStore<T> = Collection<T> & {
  // Once (`id`, storage/secrets once): the part of the items earlier versions kept whole in
  // storage.local moved apart (`from`: those items as they were, made whole), the items left there as
  // `strip` leaves them.
  moveIn: (id: string, from?: (items: T[]) => Promise<T[]> | T[]) => Promise<void>;
};

export function withSecretPart<T extends CollectionItem, S extends object>(stored: Collection<T>, o: SecretPart<T, S>): SecretPartStore<T> {
  type All = Record<string, Kept<S>>;
  const kept = async () => (await readSecret<All>(o.secret)) ?? {};
  const { pick } = o;
  const bare = o.strip ?? ((item: T) => item);
  const join = (item: T, all: All): T => {
    const own = all[item.id];
    const mine = own && (!o.boundTo || own.boundTo === o.boundTo(item)) ? own : undefined;
    if (!mine) return o.put(item, undefined);
    const { boundTo: _bound, ...part } = mine;
    return o.put(item, part as unknown as S);
  };
  const upgrade = o.upgrade ?? ((item: T) => item);
  // Every write one at a time across the pages, its fields read inside it: two changes to one item made
  // at once (two "Always" on cards) keep each other's.
  const serial = serialized(`secret-part:${stored.key}`);
  const keep = (items: T[]) =>
    updateSecret<All>(o.secret, (all = {}) => ({
      value: { ...all, ...Object.fromEntries(items.map((i) => [i.id, { ...pick(i), ...(o.boundTo && { boundTo: o.boundTo(i) }) }])) },
      notify: true,
    }));
  // An item written by an older build (≤ v0.57.15, sharing the profile) has no part kept: it comes
  // without one (off, with nothing). Saved with its part as it came, the user did not set it: none is
  // kept, and its copy keeps the part that build wrote there, which it reads. `copy`: the item as
  // storage.local has it.
  const unset = (item: T, copy: T | undefined, all: All): copy is T =>
    copy !== undefined && !all[item.id] && JSON.stringify(pick(item)) === JSON.stringify(pick(o.put(copy, undefined)));
  // What to write: the items to keep the part of, and each item as storage.local keeps it.
  const written = (items: T[], copies: Map<string, T>, all: All) => {
    const kept: T[] = [];
    const copied = items.map((item) => {
      const copy = copies.get(item.id);
      if (unset(item, copy, all)) return o.put(item, pick(copy));
      kept.push(item);
      return bare(item);
    });
    return { kept, copied };
  };
  const writeMany = async (items: T[]) => {
    const [copies, all] = await Promise.all([stored.load(), kept()]);
    const { kept: own, copied } = written(items, new Map(copies.map((i) => [i.id, i])), all);
    if (own.length) await keep(own);
    await stored.saveMany(copied);
  };
  const drop = (ids: string[]) => updateSecret<All>(o.secret, (all = {}) => ({ value: Object.fromEntries(Object.entries(all).filter(([id]) => !ids.includes(id))), notify: true }));
  const load = async () => {
    const [items, all] = await Promise.all([stored.load(), kept()]);
    return items.map((i) => (i.builtin ? i : upgrade(join(i, all))));
  };
  const moveIn = (id: string, from: (items: T[]) => Promise<T[]> | T[] = (items) => items) =>
    once(id, async () => {
      const user = (await stored.load()).filter((i) => !i.builtin);
      const all = await kept();
      const moved = (await from(user)).filter((i) => !all[i.id]);
      if (moved.length) await keep(moved);
      if (o.strip && user.length) await stored.saveMany(user.map(o.strip));
    });
  return {
    key: stored.key,
    load,
    moveIn,
    save: (item) => serial(() => writeMany([item])),
    saveMany: async (items) => {
      if (items.length) await serial(() => writeMany(items));
    },
    // The change gets the item with its fields as kept now; `missing` makes one whole, with its own.
    update: (id, change, missing) => serial(async () => {
      const all = await kept();
      const made = new WeakSet<T>();
      let changed: T | undefined;
      let ownPart = true; // its part kept (written by this build, or set by the user now)
      await stored.update(id, (item) => {
        const now = made.has(item) ? item : upgrade(join(item, all));
        changed = typeof change === 'function' ? change(now) : { ...now, ...change };
        const { kept: own, copied } = written([changed], made.has(item) ? new Map() : new Map([[id, item]]), all);
        ownPart = own.length > 0;
        return copied[0]!;
      }, missing && (() => {
        const item = missing();
        made.add(item);
        return item;
      }));
      if (changed && ownPart) await keep([changed]);
      return changed;
    }),
    remove: (id) => serial(async () => {
      await stored.remove(id);
      await drop([id]);
    }),
    removeMany: async (ids) => {
      if (!ids.length) return;
      await serial(async () => {
        await stored.removeMany(ids);
        await drop(ids);
      });
    },
    // A write changes both (the part, then the item): only the latest read is told, so one begun between
    // the two, which would find them not matching, never comes after it.
    onChanged: (cb) => {
      let latest = 0;
      const tell = () => {
        const mine = ++latest;
        void load().then((items) => mine === latest && cb(items), (e: unknown) => console.error(`[${stored.key}]`, e));
      };
      const offStored = stored.onChanged(tell);
      const offKept = onSecretChanged(o.secret, tell);
      return () => {
        offStored();
        offKept();
      };
    },
  };
}

// The store with its move (moveIn, once) done before what reads the parts kept: loading, and a change
// (made on the item as kept). A save or a removal reads none, and a move after it leaves it as it is.
export function movedFirst<T extends CollectionItem>(store: SecretPartStore<T>, id: string): SecretPartStore<T> {
  const moved = () => store.moveIn(id);
  return {
    ...store,
    load: async () => {
      await moved();
      return store.load();
    },
    update: async (itemId, change, missing) => {
      await moved();
      return store.update(itemId, change, missing);
    },
  };
}
