// Names made from what a user pasted or typed: an input's, a saved value's, a tool's.

// A name as an input's may be: "pageSize" or "page-size" as "page_size".
export function snake(name: string): string {
  return name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+|_+$/g, '');
}

export function singular(word: string): string {
  if (/ies$/.test(word)) return `${word.slice(0, -3)}y`;
  if (/[^s]s$/.test(word)) return word.slice(0, -1);
  return word;
}

// `name`, or with _2, _3… when taken.
export function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  let n = 2;
  while (taken.has(`${name}_${n}`)) n++;
  return `${name}_${n}`;
}
