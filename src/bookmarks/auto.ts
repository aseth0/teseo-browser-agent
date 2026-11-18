// Bookmarks attached on their own (Settings → Bookmarks → Auto-attach): those inside the folder the
// extension sees that match the user's message well enough (bookmarks/store rankBookmarks, as the
// search playground shows), the best first, at most `max`, each once in a conversation and never
// one the message mentions (b::).
import { attachedParts, type ContextItem } from '../core/messages';
import { text } from '../core/model-texts';
import type { Message } from '../core/types';
import { bookmarkAutoOf, bookmarkAutoSource, bookmarkMentionOf, type AttachOrigin } from '../core/sources';
import { autoPicks } from '../storage/auto-picks';
import type { Settings } from '../storage/settings';
import { ATTACH_UNSEEN, type StepAttach } from '../storage/settings-types';
import { BOOKMARK_AUTO_DEFAULTS, BOOKMARK_CANDIDATES, bookmarksAllowed, bookmarkSlug, bookmarkSlugs, rankBookmarks, type Bookmark } from './store';
import { bookmarkLine } from './tools';

// From the bookmarks ranked against a text (rankBookmarks, as Settings → Bookmarks' playground ranks
// them), those that go on their own: over the match needed, not attached in the conversation yet (with
// a message, or between the model's steps) nor mentioned, at most `max`.
export function bookmarkPicks(ranked: { bookmark: Bookmark; match: number }[], typed: string, history: Message[], auto: StepAttach | undefined): { bookmark: Bookmark; match: number }[] {
  if (!auto?.enabled) return [];
  const before = attachedParts(history);
  const sent = new Set(before.map((p) => bookmarkAutoOf(p.source)?.id ?? '').filter(Boolean));
  const mentioned = new Set([...bookmarkSlugs(typed), ...before.map((p) => bookmarkMentionOf(p.source)?.slug ?? '')]);
  return autoPicks(ranked, auto, BOOKMARK_AUTO_DEFAULTS, ({ bookmark: b }) => !sent.has(b.id) && !mentioned.has(bookmarkSlug(b)));
}

// Those your message (or a reply of the model's, between its steps: context/step-attach) matches, each
// told so. A folder gone or the permission taken back: none, the message goes on.
export async function bookmarkAutoItems(typed: string, history: Message[], settings: Settings, origin: AttachOrigin = 'message'): Promise<ContextItem[]> {
  const auto = settings.bookmarks?.autoAttach;
  if (!auto?.enabled || !typed.trim() || !(await bookmarksAllowed())) return [];
  const ranked = await rankBookmarks(settings, typed, BOOKMARK_CANDIDATES, { unseen: ATTACH_UNSEEN }).catch(() => []);
  return bookmarkPicks(ranked, typed, history, auto).map(({ bookmark: b, match }) => {
    const pct = Math.round(match * 100);
    const note = text(origin === 'step' ? 'bookmark.step_note' : 'bookmark.auto_note', { score: String(pct) });
    return { kind: 'page' as const, source: bookmarkAutoSource(b.id, pct, b.title || b.url!, b.url), text: `${note}\n${bookmarkLine(b)}` };
  });
}
