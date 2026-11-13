// Small helpers shared across the extension.

export const sleep = (ms: number) => new Promise<undefined>((resolve) => setTimeout(resolve, ms));

// How long something has run, in whole seconds: since `startedAt`, until `endedAt` or now (a recording,
// a tab's audio and their statuses all carry both).
export const secondsSince = ({ startedAt, endedAt }: { startedAt: number; endedAt?: number }) => Math.round(((endedAt ?? Date.now()) - startedAt) / 1000);

// A count with its noun: "1 tool", "2 tools" (`many`: when not the noun with an s).
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// A URL's host ("shop.test:8080"), or '' when there is none or it is not a URL.
export function hostOf(url: string | undefined): string {
  try {
    return url ? new URL(url).host : '';
  } catch {
    return '';
  }
}

// A header value with the key in place of "{{apiKey}}" (a provider's headers, an MCP server's).
export const API_KEY_PLACEHOLDER = '{{apiKey}}';
export const fillApiKey = (value: string, apiKey: string | undefined) => value.replaceAll(API_KEY_PLACEHOLDER, apiKey ?? '');

// Whitespace runs as one space, trimmed (none for no text).
export const collapseSpaces = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

// Without accents nor case, to match what is typed against what is written: "Café" and "CAFE" are the
// same. Only for comparing: what is shown keeps its accents.
export const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// A JSON object (not null, not a list): what was read before its fields are looked at.
export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// JSON with every object's keys sorted: the same whatever order storage.local gives them in (the
// browser's does not keep it).
const sortedKeys = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sortedKeys) : isObject(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortedKeys(v[k])])) : v;
export const stableJson = (v: unknown) => JSON.stringify(sortedKeys(v));

// The default branch of a switch that handles every case: `never` keeps it so (a case added and not
// handled does not compile), and a value only a newer build knows (the profile is shared) gets there.
export const unknownCase = (_: never): void => undefined;

// The tab a tool call names (its `tabId`), as a number ("12" from a model that wrote it as text);
// none when it names none or not a tab's id.
export function namedTab(args: unknown): number | undefined {
  const t = isObject(args) ? args.tabId : undefined;
  const n = typeof t === 'number' ? t : typeof t === 'string' && t.trim() ? Number(t) : NaN;
  return Number.isInteger(n) ? n : undefined;
}

// What is remembered per provider and model (thinking level, context window) is keyed by.
export const modelKey = (providerId: string, model: string) => `${providerId}|${model}`;

// A glob (`*` any characters, the rest as written, the whole of `s`) matched segment by segment, never
// through a RegExp: one the user typed (`*a*a*a*…`) cannot make the matcher backtrack on a long
// address. Case ignored unless `caseSensitive`.
export function globMatches(pattern: string, s: string, o: { caseSensitive?: boolean } = {}): boolean {
  const [p, t] = o.caseSensitive ? [pattern, s] : [pattern.toLowerCase(), s.toLowerCase()];
  const parts = p.split('*');
  if (parts.length === 1) return p === t;
  const first = parts[0]!;
  const last = parts[parts.length - 1]!;
  if (!t.startsWith(first)) return false;
  let at = first.length;
  for (const part of parts.slice(1, -1)) {
    const i = part ? t.indexOf(part, at) : at;
    if (i < 0) return false;
    at = i + part.length;
  }
  return t.length - last.length >= at && t.endsWith(last);
}

// A text matched as written inside a RegExp: its special characters escaped.
export const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

// A date as YYYY-MM-DD (UTC).
export const isoDate = (at: number) => new Date(at).toISOString().slice(0, 10);

// How many of `lines`, from the first, fit in `max` characters, each counted with the line break
// after it. `atLeastOne`: the first counts even when it alone is longer.
export function linesThatFit(lines: string[], max: number, atLeastOne = false): number {
  let size = 0;
  let n = 0;
  for (const line of lines) {
    if (size + line.length > max && (n || !atLeastOne)) break;
    size += line.length + 1;
    n++;
  }
  return n;
}
