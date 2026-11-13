// What the search playgrounds share (Settings → Bookmarks, History, Memory: ui/AutoAttachBlock): what
// the search reads in what you typed (search/bm25).
import { phrasesOf, terms } from '../search/bm25';

// Its words as the search compares them (lowercase, no accents nor plurals, no commonest words), and
// its quoted phrases.
export function SearchedAs({ query }: { query: string }) {
  if (!query.trim()) return null;
  const words = terms(query);
  const phrases = phrasesOf(query);
  return (
    <p className="muted small">
      Searched as: {words.length ? words.map((w) => <code key={w}>{w}</code>) : 'no word that counts (too short, or one of the commonest)'}
      {phrases.length > 0 && <> · phrases: {phrases.map((p) => <code key={p}>"{p}"</code>)}</>}
    </p>
  );
}
