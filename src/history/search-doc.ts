// A saved conversation as a search reads it (history/rank's terms), kept beside it in storage.local so
// that a search, the history panel's query and auto-attach rank from these few KB each instead of
// reading every conversation in full; only the results shown are loaded whole.
// Derived data: never exported, rebuilt when missing or stale (saved by a build without it, imported).
import { scored, type Indexed, type MatchOptions } from '../search/bm25';
import { isObject } from '../core/util';
import type { ConversationMeta } from './store';

// The format's number: a change to what is kept, or to how history/rank weighs words, takes a new one,
// and the documents of the old one read as missing (rebuilt).
export const SEARCH_DOC_V = 1;
// The heaviest terms kept of a conversation: about 20 KB at most, a few KB for most. Enough for what you
// and the model wrote in a long conversation (a few hundred distinct words already fill 300); words
// past them (the lightest: once in a long page or a tool's result) are not found in it, and count no
// more for how rare a word is.
export const TERMS_MAX = 2000;

export interface SearchDoc {
  v: number;
  version: string; // docVersion of the conversation it was built from
  length: number; // its weighted number of terms (all of them, not only those kept)
  terms: string; // the terms kept, in the order first found, between spaces (no term has one)
  tenths: number[]; // each one's weight, as history/rank weighs them, in tenths
}

// What changes whenever what a search reads of a conversation may have: read from the index entry, so
// a document can be checked without loading its conversation. Every build sets `updatedAt` on a save,
// a rename sets the title, a pin `pinned`.
export const docVersion = (c: Pick<ConversationMeta, 'updatedAt' | 'pinned' | 'title' | 'turns'>): string =>
  JSON.stringify([c.updatedAt, c.pinned ? 1 : 0, c.title, c.turns]);

// A conversation's terms as a document: the heaviest TERMS_MAX, in their order.
export function searchDocOf(indexed: Pick<Indexed<unknown>, 'freq' | 'length'>, version: string): SearchDoc {
  let terms = [...indexed.freq];
  if (terms.length > TERMS_MAX) {
    const kept = new Set(
      terms
        .map(([, w], i) => [w, i] as const)
        .sort((a, b) => b[0] - a[0] || a[1] - b[1])
        .slice(0, TERMS_MAX)
        .map(([, i]) => i),
    );
    terms = terms.filter((_, i) => kept.has(i));
  }
  return { v: SEARCH_DOC_V, version, length: indexed.length, terms: terms.map(([t]) => t).join(' '), tenths: terms.map(([, w]) => Math.round(w * 10)) };
}

// Its terms with their weights.
export const termsOf = (doc: SearchDoc): [string, number][] => (doc.terms ? doc.terms.split(' ').map((t, i) => [t, doc.tenths[i]! / 10]) : []);

// A stored document as far as it can be read: one of another shape or format (another build's, or
// broken) as none, so it is rebuilt.
export function asSearchDoc(v: unknown): SearchDoc | undefined {
  if (!isObject(v) || v.v !== SEARCH_DOC_V || typeof v.version !== 'string' || !Number.isFinite(v.length)) return undefined;
  const { terms, tenths } = v;
  if (typeof terms !== 'string' || !Array.isArray(tenths) || !tenths.every(Number.isSafeInteger)) return undefined;
  return (terms ? terms.split(' ').length : 0) === tenths.length ? (v as unknown as SearchDoc) : undefined;
}

// Ranks items by their documents as history/rank ranks the conversations themselves: the same scores
// for one whose terms all fit in its document. Quoted phrases need the text: not for these.
export function rankDocs<T extends Pick<ConversationMeta, 'updatedAt'>>(
  query: string,
  docs: { item: T; doc: SearchDoc }[],
  { prefix = false }: MatchOptions = {},
): { item: T; score: number; match: number }[] {
  const indexed: Indexed<T>[] = docs.map(({ item, doc }) => ({ item, freq: new Map(termsOf(doc)), length: doc.length, plain: '' }));
  return scored(query, indexed, { prefix }).sort((a, b) => b.score - a.score || b.item.updatedAt - a.item.updatedAt);
}
