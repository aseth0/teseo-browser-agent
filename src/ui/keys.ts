// Stable React keys for the items of a list being edited (moved, removed, added), without storing
// them: each item object has one, and the edited copy of an item (patchAt) keeps it. With index keys,
// after ↑ or ✕ the focus and the inputs' state would stay on the old position.
const keys = new WeakMap<object, string>();

export function keyOf(item: object): string {
  let key = keys.get(item);
  if (!key) keys.set(item, (key = crypto.randomUUID()));
  return key;
}

// The list with item i changed, under the same key.
export const patchAt = <T extends object>(list: T[], i: number, change: Partial<T>): T[] =>
  list.map((x, j) => {
    if (j !== i) return x;
    const next = { ...x, ...change };
    keys.set(next, keyOf(x));
    return next;
  });

// The list with item i moved `by` places (±1), each item with its key.
export const swapAt = <T,>(list: T[], i: number, by: number): T[] => {
  const next = [...list];
  [next[i], next[i + by]] = [next[i + by]!, next[i]!];
  return next;
};
