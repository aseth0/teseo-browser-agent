// The values an action reads from the page, as Settings → Actions edits them: rows with a name each.

export type ReadRow = { name: string; value: string };

// The first name two rows have (empty ones aside); none when every name is its own.
export const repeatedName = (rows: ReadRow[]): string | undefined => rows.map((r) => r.name.trim()).find((n, i, all) => n && all.indexOf(n) !== i);

// A name no row has, for a new one: value1, value2…
export function freeName(rows: ReadRow[]): string {
  let n = rows.length + 1;
  while (rows.some((r) => r.name.trim() === `value${n}`)) n++;
  return `value${n}`;
}

// What the action keeps: the named rows, by name.
export const readsOf = (rows: ReadRow[]): Record<string, string> => Object.fromEntries(rows.filter((r) => r.name.trim()).map((r) => [r.name.trim(), r.value]));
