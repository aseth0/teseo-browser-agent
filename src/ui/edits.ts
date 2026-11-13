// Edited copies of what an editor holds, for setState: the original stays as it was.

// The record with `key` set to `value`, or without it when `value` is undefined.
export function withKey<R extends object, K extends keyof R>(record: R | undefined, key: K, value: R[K] | undefined): R {
  const next = { ...record } as R; // an empty record when none: R's keys are all optional where this is used
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

// The set with `item` in it or not (`on`; by default, the other way round from now).
export function withMember<T>(set: Set<T>, item: T, on = !set.has(item)): Set<T> {
  const next = new Set(set);
  if (on) next.add(item);
  else next.delete(item);
  return next;
}
