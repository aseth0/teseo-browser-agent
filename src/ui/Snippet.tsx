// Where a search matched (search/bm25), its words (and, with `prefix`, the words they begin) highlighted:
// the 🕘 panel's results, and the Try a message of Settings → Memory, Bookmarks and History, there
// without `prefix`, as auto-attach compares whole words.
import type { ReactNode } from 'react';
import { matchSpans } from '../search/bm25';

export function Snippet({ text, query, prefix = true, cut = true }: { text: string; query: string; prefix?: boolean; cut?: boolean }) {
  const pieces: ReactNode[] = [];
  let at = 0;
  for (const span of matchSpans(text, query, { prefix })) {
    if (span.end <= at) continue; // inside one already highlighted
    const start = Math.max(at, span.start);
    if (start > at) pieces.push(text.slice(at, start));
    pieces.push(<mark key={start}>{text.slice(start, span.end)}</mark>);
    at = span.end;
  }
  pieces.push(text.slice(at));
  return <span className="history-snippet">{cut && '…'}{pieces}{cut && '…'}</span>;
}
