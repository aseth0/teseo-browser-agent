// The items of a Settings list chosen to export (Select), apart from whether they are on: their ids,
// while selecting.
import { useMemo, useState } from 'react';
import type { TableSelect } from '../Collection';

// Without the ids of items no longer there (the same set when none went).
export function pruneSelection(selected: Set<string>, ids: string[]): Set<string> {
  const here = new Set(ids);
  return [...selected].every((id) => here.has(id)) ? selected : new Set([...selected].filter((id) => here.has(id)));
}

// Those shown selected, or unselected; the others as they were.
export function selectShown(selected: Set<string>, shownIds: string[], on: boolean): Set<string> {
  const next = new Set(selected);
  for (const id of shownIds) {
    if (on) next.add(id);
    else next.delete(id);
  }
  return next;
}

// How many of the selected the filter hides.
export const hiddenCount = (selected: Set<string>, shownIds: string[]) => [...selected].filter((id) => !shownIds.includes(id)).length;

// Selecting or not, and what is selected among `ids` (the items that can be exported); an item
// deleted meanwhile (in another page) drops out. Stopping forgets the selection.
export function useSelection(ids: string[]) {
  const [selecting, setSelecting] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const key = ids.join('\n');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the ids' content (`ids` is a new list on every render)
  const selected = useMemo(() => pruneSelection(chosen, ids), [chosen, key]);
  return {
    selecting,
    selected,
    start: () => setSelecting(true),
    stop: () => {
      setSelecting(false);
      setChosen(new Set());
    },
    toggle: (id: string, on: boolean) => setChosen((c) => selectShown(pruneSelection(c, ids), [id], on)),
    setShown: (shownIds: string[], on: boolean) => setChosen((c) => selectShown(pruneSelection(c, ids), shownIds, on)),
  };
}

export type Selection = ReturnType<typeof useSelection>;

// What the table needs of it while selecting (none otherwise); `cannot`: why a row cannot be chosen.
export const tableSelect = <T,>(s: Selection, cannot: (row: T) => string | undefined = () => undefined): TableSelect<T> | undefined =>
  s.selecting ? { selected: s.selected, onSelect: s.toggle, onSelectShown: s.setShown, cannot } : undefined;
