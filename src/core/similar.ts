// How alike two texts are, for errors that name what the model may have meant: the share of pairs of
// characters they have in common (0 to 1), spaces and line breaks counted as one space.
export function similarity(a: string, b: string): number {
  const pairs = (s: string) => {
    const t = s.replace(/\s+/g, ' ').trim();
    const counts = new Map<string, number>();
    for (let i = 0; i < t.length - 1; i++) counts.set(t.slice(i, i + 2), (counts.get(t.slice(i, i + 2)) ?? 0) + 1);
    return { counts, size: Math.max(0, t.length - 1) };
  };
  const x = pairs(a);
  const y = pairs(b);
  if (!x.size || !y.size) return a.trim() === b.trim() ? 1 : 0;
  let shared = 0;
  for (const [pair, n] of x.counts) shared += Math.min(n, y.counts.get(pair) ?? 0);
  return (2 * shared) / (x.size + y.size);
}

// A name as a model may write it in another form: case, and "_", "__" and "." between its words.
const normalized = (name: string) => name.toLowerCase().replace(/[._]+/g, '_');

// The names most like `written`, best first: those equal to it in another form ("Memory_Search" for
// "memory__search"); those it ends with or that end with it after a dot ("custom.gpt.ask" for
// "gpt.ask"); those that start with it ("mcp__docs" for every "mcp__docs__…"); then the alike enough.
export function closestNames(names: string[], written: string, max = 3, enough = 0.5): string[] {
  const form = normalized(written);
  const same = names.filter((n) => normalized(n) === form);
  const dotted = names.filter((n) => written.endsWith(`.${n}`) || n.endsWith(`.${written}`));
  const started = form.length >= 3 ? names.filter((n) => normalized(n).startsWith(form)) : [];
  const alike = names
    .map((n) => ({ n, score: similarity(n, written) }))
    .filter((c) => c.score >= enough)
    .sort((a, b) => b.score - a.score)
    .map((c) => c.n);
  return [...new Set([...same, ...dotted, ...started, ...alike])].slice(0, max);
}

// Whether two names differ by at most one edit for every four letters (at most two): a typo.
export function near(a: string, b: string): boolean {
  const most = Math.min(2, Math.floor(Math.max(a.length, b.length) / 4));
  if (!most || Math.abs(a.length - b.length) > most) return false;
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length]! <= most;
}
