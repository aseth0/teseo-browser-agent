// The word blacklist's substitution (Settings → Word blacklist): the user's sensitive terms swapped for
// the placeholders they chose before anything reaches the model (mask), and the placeholders put back
// in what it answers (restore). Pure: no storage, no browser.
// Masking finds a term whatever its case and accents, as a whole word, the longest first; restoring
// finds a placeholder whatever its case, as a whole word. A placeholder split across two chunks of a
// streamed answer is still restored (streamRestorer).
import { escapeRegExp, fold, globMatches, isObject } from '../core/util';

export interface BlacklistEntry {
  term: string; // as the user wrote it, what restoring puts back
  replacement: string; // what the model gets instead, e.g. CLIENT_A
}

// An entry as stored or in a file: both sides as text.
export const isBlacklistEntry = (e: unknown): e is BlacklistEntry => isObject(e) && typeof e.term === 'string' && typeof e.replacement === 'string';

// What counts as part of a word on either side of a match: none of these may touch it.
const WORD = '[\\p{L}\\p{N}_]';
const bounded = (alternatives: string[]) => `(?<!${WORD})(?:${alternatives.join('|')})(?!${WORD})`;

// The text folded, and for each code unit of it where its character starts in the text (one more at
// the end: the text's length), to map a match in the folded text back to the text.
function foldedWithMap(s: string): { text: string; at: number[] } {
  let text = '';
  const at: number[] = [];
  let i = 0;
  for (const ch of s) {
    const f = fold(ch);
    for (let k = 0; k < f.length; k++) at.push(i);
    text += f;
    i += ch.length;
  }
  at.push(i);
  return { text, at };
}

// Two terms are the same term whatever their case, accents and spaces.
export const termKey = (term: string) => fold(term.trim()).split(/\s+/).join(' ');

// The entries that can be used: both sides written. Those that are not are left out.
export const usableEntries = (entries: BlacklistEntry[]) =>
  entries.map((e) => ({ term: e.term.trim(), replacement: e.replacement.trim() })).filter((e) => e.term && e.replacement);

export interface Blacklist {
  readonly empty: boolean;
  mask(s: string): string;
  restore(s: string): string;
  maskDeep<T>(v: T): T; // every string inside (not the keys)
  restoreDeep<T>(v: T): T;
  findsTerm(s: string): boolean; // whether masking would change it
  replaced(s: string): BlacklistEntry[]; // the entries masking uses in it, once each, as they come
  streamRestorer(): StreamRestorer;
}

// Restores a text that comes in chunks: what `push` returns may hold back the end of what it got,
// which may be the start of a placeholder; `end` gives what is left.
export interface StreamRestorer {
  push(chunk: string): string;
  end(): string;
}

export function compileBlacklist(entries: BlacklistEntry[]): Blacklist {
  const usable = usableEntries(entries);
  const byTerm = new Map<string, string>(); // folded term → replacement; the first entry wins
  const entryOf = new Map<string, BlacklistEntry>(); // folded term → its entry
  const byReplacement = new Map<string, string>(); // lowercased replacement → term
  for (const e of usable) {
    const key = termKey(e.term);
    if (!byTerm.has(key)) {
      byTerm.set(key, e.replacement);
      entryOf.set(key, e);
    }
    const r = e.replacement.toLowerCase();
    if (!byReplacement.has(r)) byReplacement.set(r, e.term);
  }
  const longestFirst = (a: string, b: string) => b.length - a.length;
  // A space in a term matches any run of spaces (a line break in a page's text).
  const terms = [...byTerm.keys()].sort(longestFirst).map((t) => t.split(' ').map(escapeRegExp).join('\\s+'));
  const replacements = [...byReplacement.keys()].sort(longestFirst);
  const maskRe = terms.length ? new RegExp(bounded(terms), 'gu') : undefined;
  const restoreRe = replacements.length ? new RegExp(bounded(replacements.map(escapeRegExp)), 'giu') : undefined;
  const longest = Math.max(0, ...replacements.map((r) => r.length));

  const mask = (s: string): string => {
    if (!maskRe || !s) return s;
    const { text, at } = foldedWithMap(s);
    let out = '';
    let last = 0;
    for (const m of text.matchAll(maskRe)) {
      const start = at[m.index]!;
      const end = at[m.index + m[0].length]!;
      out += s.slice(last, start) + byTerm.get(m[0].split(/\s+/).join(' '))!;
      last = end;
    }
    return last ? out + s.slice(last) : s;
  };
  const replaced = (s: string): BlacklistEntry[] => {
    if (!maskRe || !s) return [];
    const keys = [...foldedWithMap(s).text.matchAll(maskRe)].map((m) => m[0].split(/\s+/).join(' '));
    return [...new Set(keys)].map((k) => entryOf.get(k)!);
  };
  const termOf = (found: string) => byReplacement.get(found.toLowerCase()) ?? found;
  const restore = (s: string): string => (restoreRe && s ? s.replace(restoreRe, termOf) : s);

  const streamRestorer = (): StreamRestorer => {
    let held = ''; // received, not given yet
    let before = ''; // the last character given: what precedes `held`, for the word boundary
    const give = (upTo: number, matches: RegExpMatchArray[]) => {
      let out = '';
      let last = 0;
      for (const m of matches) {
        const start = m.index! - before.length;
        if (start < 0 || start >= upTo) continue;
        out += held.slice(last, start) + termOf(m[0]);
        last = start + m[0].length;
      }
      out += held.slice(last, upTo);
      if (upTo) before = [...held.slice(0, upTo)].at(-1) ?? before;
      held = held.slice(upTo);
      return out;
    };
    return {
      push(chunk) {
        if (!restoreRe) return chunk;
        held += chunk;
        const matches = [...(before + held).matchAll(restoreRe)];
        // A placeholder that may still be coming starts in the last `longest` characters: kept until
        // the next chunk says. One that starts before them ends before the last character, whose
        // next one says whether it is a whole word: it is restored now.
        let cut = Math.max(0, held.length - longest);
        for (const m of matches) {
          const start = m.index - before.length;
          if (start < cut) cut = Math.max(cut, start + m[0].length);
        }
        // Never between the two halves of a surrogate pair.
        if (cut > 0 && cut < held.length && /[\uDC00-\uDFFF]/.test(held[cut]!)) cut--;
        return give(cut, matches);
      },
      end() {
        if (!restoreRe || !held) return held;
        const matches = [...(before + held).matchAll(restoreRe)];
        return give(held.length, matches);
      },
    };
  };

  return {
    empty: !usable.length,
    mask,
    restore,
    maskDeep: (v) => deepStrings(v, mask),
    restoreDeep: (v) => deepStrings(v, restore),
    findsTerm: (s) => mask(s) !== s,
    replaced,
    streamRestorer,
  };
}

// Every string inside a value changed by `f` (arrays and objects copied; their keys as they are).
export function deepStrings<T>(v: T, f: (s: string) => string): T {
  if (typeof v === 'string') return f(v) as T;
  if (Array.isArray(v)) return v.map((x: unknown) => deepStrings(x, f)) as T;
  if (isObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepStrings(x, f)])) as T;
  return v;
}

// What is wrong with the entries, by entry (its index in `entries`): errors keep them from being
// saved; a warning does not.
export type EntryIssue = 'same-replacement' | 'contains-term' | 'ordinary-word';
const BLOCKING: readonly EntryIssue[] = ['same-replacement', 'contains-term'];

export function entryIssues(entries: BlacklistEntry[]): Map<number, EntryIssue[]> {
  const issues = new Map<number, EntryIssue[]>();
  const add = (i: number, issue: EntryIssue) => issues.set(i, [...(issues.get(i) ?? []), issue]);
  const terms = compileBlacklist(entries.map((e) => ({ term: e.term, replacement: '-' })));
  const used = new Map<string, number>(); // lowercased replacement → how many entries use it
  for (const e of entries) {
    const r = e.replacement.trim().toLowerCase();
    if (r && e.term.trim()) used.set(r, (used.get(r) ?? 0) + 1);
  }
  entries.forEach((e, i) => {
    const r = e.replacement.trim();
    if (!r || !e.term.trim()) return;
    if ((used.get(r.toLowerCase()) ?? 0) > 1) add(i, 'same-replacement');
    // Its own term too: the model would get the term inside its placeholder.
    if (terms.findsTerm(r)) add(i, 'contains-term');
    // Letters only, as most words are: restoring would put the term where the model meant the word.
    if (/^\p{L}+$/u.test(r)) add(i, 'ordinary-word');
  });
  return issues;
}

export const blocksSaving = (issues: Map<number, EntryIssue[]>) => [...issues.values()].some((list) => list.some((i) => BLOCKING.includes(i)));

// ---------- When it applies ----------

// A provider, and one of its models (none: any of them).
export interface BlacklistTarget {
  providerId: string;
  model?: string;
}

// What chrome.storage.local keeps of it (word-blacklist/store): nothing of the terms.
export interface BlacklistConfig {
  enabled?: boolean; // default off
  targets?: BlacklistTarget[];
  pages?: string[]; // URL patterns, glob style: *.example.com
  hideImages?: boolean;
}

// A URL pattern: `*` any characters. Without a "/" it is a host (`*.example.com` is example.com too),
// with one the URL without its scheme ("example.com/docs/*"), with "://" the whole URL.
export function urlMatches(url: string, pattern: string): boolean {
  const p = pattern.trim().toLowerCase();
  if (!p) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (p.includes('://')) return globMatches(p, parsed.href);
  if (p.includes('/')) return globMatches(p, parsed.host + parsed.pathname + parsed.search);
  const host = parsed.hostname.toLowerCase();
  return globMatches(p, host) || (p.startsWith('*.') && host === p.slice(2));
}

// Whether a request goes masked: switched on, and with this provider and model or after a page that
// matches; with neither listed, always.
export function blacklistApplies(config: BlacklistConfig, at: { providerId: string; model: string; urls: string[] }): boolean {
  if (!config.enabled) return false;
  const targets = config.targets ?? [];
  const pages = (config.pages ?? []).filter((p) => p.trim());
  if (!targets.length && !pages.length) return true;
  return targets.some((t) => t.providerId === at.providerId && (!t.model || t.model === at.model)) || at.urls.some((u) => pages.some((p) => urlMatches(u, p)));
}
