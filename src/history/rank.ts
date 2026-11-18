// The saved conversations ranked for a search (search/bm25): where a word is weighs (a title more
// than a tool's result), and a pinned conversation is searched in full, its reasoning and the tools'
// arguments too. Each conversation's index is kept while it does not change.
import { indexTexts, scored, type Indexed, type MatchOptions } from '../search/bm25';
import { docVersion, searchDocOf, type SearchDoc } from './search-doc';
import type { Conversation } from './store';

type Doc = Indexed<Conversation>;

// How much a word counts by where it is: tenths, so that a word's weight in a conversation is kept
// as a whole number of them (history/search-doc).
const WEIGHTS = { title: 3, user: 2, answer: 1, reasoning: 0.5, context: 0.3 } as const;

// Each conversation's terms, kept while it does not change: a search (with auto-attach, every
// message) only indexes again the ones saved, renamed or pinned since.
const indexed = new Map<string, { version: string; doc: Doc }>();
const versionOf = (c: Conversation) => {
  let chars = 0; // far cheaper than its terms, and changes with nearly any edit
  for (const m of c.history) for (const p of m.parts) chars += p.type === 'text' || p.type === 'reasoning' ? p.text.length : p.type === 'tool_result' ? p.content.length : 1;
  return `${c.updatedAt}|${c.pinned ? 1 : 0}|${c.title}|${c.history.length}|${chars}`;
};

function docOf(conv: Conversation): Doc {
  const version = versionOf(conv);
  const hit = indexed.get(conv.id);
  if (hit?.version === version) return { ...hit.doc, item: conv };
  const doc = indexOf(conv);
  indexed.set(conv.id, { version, doc });
  return doc;
}

// A conversation's search document (history/search-doc): the terms its search reads, kept with it.
// `version`: the index entry's (a search rebuilding one); `cached`: through the terms kept here
// between searches (a search, that may build it again before it is stored), not on a save.
export const searchDocFor = (conv: Conversation, version = docVersion(conv), cached = false): SearchDoc =>
  searchDocOf(cached ? docOf(conv) : indexOf(conv), version);

// Those a search now reads from their stored documents are let go.
export function forgetIndexed(ids: Iterable<string>) {
  for (const id of ids) indexed.delete(id);
}

// Those no longer saved are let go.
function forgetOthers(corpus: Conversation[]) {
  if (indexed.size <= corpus.length) return;
  const ids = new Set(corpus.map((c) => c.id));
  for (const id of indexed.keys()) if (!ids.has(id)) indexed.delete(id);
}

function indexOf(conv: Conversation): Doc {
  const texts: [string, number][] = [];
  const add = (text: string, weight: number) => texts.push([text, weight]);
  add(conv.title, WEIGHTS.title);
  for (const m of conv.history) {
    for (const p of m.parts) {
      if (p.type === 'text') add(p.text, p.context ? WEIGHTS.context : m.role === 'user' ? WEIGHTS.user : WEIGHTS.answer);
      else if (p.type === 'tool_result') add(p.content, WEIGHTS.context);
      else if (conv.pinned && p.type === 'reasoning') add(p.text, WEIGHTS.reasoning);
      else if (conv.pinned && p.type === 'tool_call') add(JSON.stringify(p.args ?? {}), WEIGHTS.context);
    }
  }
  const doc = indexTexts(conv, texts);
  // Their sums as the tenths they are (0.3 + 0.3 + 0.3 is 0.8999999999999999): as kept in its search document.
  for (const [t, w] of doc.freq) doc.freq.set(t, Math.round(w * 10) / 10);
  return doc;
}

// The conversations with any of the query's words, best first (the latest first when even). How rare
// a word is comes from `corpus` (all the saved conversations, when only some are ranked); `match`:
// how much of the query each covers (search/bm25 scored).
// One that cannot be indexed (stored malformed, by another build or a backup) is left out of the
// search, not the cause of its failing.
function docsOf(convs: Conversation[]): Doc[] {
  return convs.flatMap((c) => {
    try {
      return [docOf(c)];
    } catch (e) {
      console.error('[history search]', c.id, e);
      return [];
    }
  });
}

export function rank(query: string, convs: Conversation[], { corpus = convs, prefix = false, unseen }: MatchOptions & { corpus?: Conversation[] } = {}): { conv: Conversation; score: number; match: number }[] {
  const docs = docsOf(convs);
  const all = corpus === convs ? docs : docsOf(corpus);
  forgetOthers(corpus);
  return scored(query, docs, { corpus: all, prefix, unseen })
    .map(({ item, score, match }) => ({ conv: item, score, match }))
    .sort((a, b) => b.score - a.score || b.conv.updatedAt - a.conv.updatedAt);
}
