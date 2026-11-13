// What the imports of stored items (skills, site templates, agents, custom tools, actions, memory)
// share: the list in the JSON, its lists of strings, and items matched by name to those here, each
// with what importing it would do (the preview, ui/collection).
import { KIND_SECTION, otherKind } from './transfer';

// What importing an item does: it is new, replaces yours, replaces a custom tool synced from a source
// (which it leaves), or is left out (`why`).
export type ImportStatus = 'new' | 'replaces' | 'leaves-source' | 'left-out';
export interface ImportRow<T> {
  name: string;
  status: ImportStatus;
  item?: T; // none when left out
  why?: string;
  sourceId?: string; // of the source it leaves
}

// The list in the JSON: { "<key>": [...] }, a list, or (`single`) one item alone; another section's
// file is said so.
export function listFrom(json: string, key: string, { single = true } = {}): unknown[] {
  const parsed = JSON.parse(json) as unknown;
  const other = otherKind(parsed, key);
  if (other) throw new Error(`This is a ${KIND_SECTION[other].file} file: import it in ${KIND_SECTION[other].section}.`);
  const list = Array.isArray(parsed) ? parsed : ((parsed as Record<string, unknown> | null)?.[key] ?? (single ? [parsed] : undefined));
  if (!Array.isArray(list)) throw new Error(`No "${key}" list in this JSON`);
  return list;
}

// Its strings, the rest left out (a single string: a list of one); `trim`: each trimmed, and the
// empty ones left out.
export function stringList(v: unknown, { trim = false } = {}): string[] {
  const all = [v].flat().filter((x): x is string => typeof x === 'string');
  return trim ? all.map((x) => x.trim()).filter(Boolean) : all;
}

// A time (or any number) as read: itself when it is a finite number, else `fallback`.
export const finiteOr = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

// Whether two names are the same one, as an import matches them: trimmed, in any case.
export const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

interface Named {
  id: string;
  name: string;
}

// Each item of the list built (`old`: the one here of its name, whose id it takes; else a new id) and
// checked against the others here and those already in; those left out, with why; and a row each, for
// the preview. `build` may leave one out itself.
export function importNamed<T extends Named>(opts: {
  list: unknown[];
  existing: T[];
  build: (item: Record<string, unknown>, old: T | undefined) => Omit<T, 'id'> | { skip: string };
  problems: (item: T, others: T[]) => string[];
}): { items: T[]; skipped: string[]; rows: ImportRow<T>[] } {
  const items: T[] = [];
  const skipped: string[] = [];
  const rows: ImportRow<T>[] = [];
  for (const raw of opts.list) {
    const item = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const name = String(item.name ?? '');
    const old = name.trim() ? opts.existing.find((e) => sameName(e.name, name)) : undefined;
    const built = opts.build(item, old);
    const leftOut = (why: string) => {
      skipped.push(why);
      rows.push({ name: name.trim() || '(no name)', status: 'left-out', why });
    };
    if ('skip' in built) {
      leftOut(built.skip);
      continue;
    }
    // The second of a name: the first one already takes it (one of yours: they would share its id).
    if (items.some((i) => sameName(i.name, name))) {
      leftOut(`${name.trim()}: the file has this name more than once.`);
      continue;
    }
    const done = { ...built, id: old?.id ?? crypto.randomUUID() } as T;
    const problems = opts.problems(done, [...opts.existing.filter((e) => e.id !== done.id), ...items]);
    if (problems.length) leftOut(`${done.name || '(no name)'}: ${problems.join(' ')}`);
    else {
      items.push(done);
      rows.push({ name: done.name, status: old ? 'replaces' : 'new', item: done });
    }
  }
  return { items, skipped, rows };
}
