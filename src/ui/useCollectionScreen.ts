import { useMemo } from 'react';
import type { Collection } from '../storage/collection';
import { useCollectionState } from './useCollection';
import { useHashTarget } from './useHashTarget';

// A Settings screen of stored items (skills, site templates, agents, memory, custom tools, actions):
// the items, and the one whose editor is open (useHashEditor).
export function useCollectionScreen<T extends { id: string }>(collection: Collection<T>, { route, fresh }: { route: string; fresh: (items: T[]) => T }) {
  const { items, loaded } = useCollectionState(collection);
  return { items, loaded, ...useHashEditor(route, items, loaded, fresh) };
}

// The item of a screen whose editor is open, which lives in the hash (#<route>/<id>; #<route>/new:
// a new one, made by `fresh`), so Back closes the editor and it can be linked. `missing`: the hash
// names an item there is none of (once the items are read).
export function useHashEditor<T extends { id: string }>(route: string, items: T[], loaded: boolean, fresh: (items: T[]) => T) {
  const target = useHashTarget(route);
  // A new one is made once each time #<route>/new is opened, not on every change to the items; once
  // they are read (opened by a link, it waits for them: its id is checked against theirs).
  // eslint-disable-next-line react-hooks/exhaustive-deps -- made again only when the editor is opened again
  const draft = useMemo(() => (target === 'new' && loaded ? fresh(items) : undefined), [target, loaded]);
  const editing = target === 'new' ? draft : target ? items.find((i) => i.id === target) : undefined;
  return {
    target,
    editing,
    missing: !!target && loaded && !editing,
    open: (id: string) => (location.hash = `${route}/${encodeURIComponent(id)}`),
    close: () => (location.hash = route),
  };
}
