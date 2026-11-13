import type { Collection } from '../storage/collection';
import { useLive } from './useLive';

const NOT_READ = { items: [], loaded: false };

// A stored collection (skills, page templates), kept up to date with changes from any page, and
// whether it has been read yet (before that, `items` is empty).
export function useCollectionState<T>(collection: Collection<T>): { items: T[]; loaded: boolean } {
  return useLive<{ items: T[]; loaded: boolean }>(
    () => collection.load().then((items) => ({ items, loaded: true })),
    (set) => collection.onChanged((items) => set({ items, loaded: true })),
    NOT_READ,
    '[collection]',
    collection,
  );
}

export const useCollection = <T,>(collection: Collection<T>): T[] => useCollectionState(collection).items;
