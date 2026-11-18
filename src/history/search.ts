// Saved conversations searched (history.search, the 🕘 search box, auto-attach, Settings → History's
// playground): ranked from their search documents (history/search-doc), a few KB each, and loaded
// whole only for what is shown of the best (snippets, transcripts). A query with quoted phrases needs
// the text: it reads them all, as before the documents. One whose document is missing or stale (saved
// by a build without them, imported) is read whole and indexed for this search, and its document
// stored after it, a bounded number per search: a large history is indexed over a few searches.
import { phrasesOf, terms, type MatchOptions } from '../search/bm25';
import { browser } from 'wxt/browser';
import { forgetIndexed, rank, searchDocFor } from './rank';
import { asSearchDoc, docVersion, rankDocs, type SearchDoc } from './search-doc';
import { listConversations, loadConversations, searchDocKey, writeSearchDocs, type Conversation, type ConversationMeta } from './store';

const REBUILD_MAX = 100; // documents a search stores, at most
const REBUILD_BATCH = 25; // in one write

export interface Ranked {
  meta: ConversationMeta;
  score: number;
  match: number;
}

export interface SavedRanking {
  ranked: Ranked[]; // best first (the latest first when even)
  loaded: Map<string, Conversation>; // the conversations read whole on the way
  rebuilt: Promise<void>; // the documents it built, stored (not waited for by the search)
}

// The saved conversations with any of the query's words (and all its quoted phrases), best first; how
// rare a word is from all of them but `except` (the one asking). `prefix`: words also find the words
// they begin (the 🕘 search box); `unseen`: the query's words none has count against the match (auto-attach).
export async function rankSaved(query: string, { except, ...options }: MatchOptions & { except?: string } = {}): Promise<SavedRanking> {
  const loaded = new Map<string, Conversation>();
  if (!terms(query).length) return { ranked: [], loaded, rebuilt: Promise.resolve() };
  const metas = (await listConversations()).filter((c) => c.id !== except);
  const stored = await browser.storage.local.get(metas.map((m) => searchDocKey(m.id)));
  const docs = new Map<string, SearchDoc>();
  for (const m of metas) {
    const doc = asSearchDoc(stored[searchDocKey(m.id)]);
    if (doc?.version === docVersion(m)) docs.set(m.id, doc);
  }
  forgetIndexed(docs.keys());
  const phrases = phrasesOf(query).length > 0;
  const read = metas.filter((m) => phrases || !docs.has(m.id));
  for (const c of await loadConversations(read.map((m) => m.id))) loaded.set(c.id, c);
  const built: [string, SearchDoc][] = [];
  for (const m of read) {
    const conv = loaded.get(m.id);
    if (docs.has(m.id) || !conv) continue;
    try {
      const doc = searchDocFor(conv, docVersion(m), true);
      docs.set(m.id, doc);
      built.push([m.id, doc]);
    } catch (e) {
      console.error('[history search]', m.id, e); // left out of the search, not the cause of its failing
    }
  }
  const rebuilt = built.length ? writeSearchDocs(built.slice(0, REBUILD_MAX), REBUILD_BATCH).catch((e: unknown) => console.error('[history search]', e)) : Promise.resolve();
  const ranked = phrases
    ? rank(query, metas.flatMap((m) => loaded.get(m.id) ?? []), options).map(({ conv, score, match }) => ({ meta: conv, score, match }))
    : rankDocs(query, metas.flatMap((m) => (docs.has(m.id) ? [{ item: m, doc: docs.get(m.id)! }] : [])), options).map(({ item, score, match }) => ({ meta: item, score, match }));
  return { ranked, loaded, rebuilt };
}

// These conversations whole: those read already, the others now (one deleted since is left out).
export async function wholeOf(ids: string[], loaded: Map<string, Conversation>): Promise<Map<string, Conversation>> {
  for (const c of await loadConversations(ids.filter((id) => !loaded.has(id)))) loaded.set(c.id, c);
  return loaded;
}

// The best `limit` matches, whole (history.search, with their snippets).
export async function searchConversations(query: string, { limit = Infinity, ...options }: MatchOptions & { except?: string; limit?: number } = {}): Promise<Conversation[]> {
  const { ranked, loaded } = await rankSaved(query, options);
  const top = ranked.slice(0, limit).map((r) => r.meta.id);
  const whole = await wholeOf(top, loaded);
  return top.flatMap((id) => whole.get(id) ?? []);
}

// Every match, the best `whole` of them whole (the 🕘 list, their snippets), the others as listed.
export async function searchList(query: string, { whole, prefix }: MatchOptions & { whole: number }): Promise<(Conversation | ConversationMeta)[]> {
  const { ranked, loaded } = await rankSaved(query, { prefix });
  await wholeOf(ranked.slice(0, whole).map((r) => r.meta.id), loaded);
  return ranked.map((r) => loaded.get(r.meta.id) ?? r.meta);
}
