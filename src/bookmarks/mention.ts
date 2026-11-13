// "b::<slug>" in a message attaches that bookmark (its title in lowercase with dashes; the latest
// added when several share it): its line as bookmarks.search lists it. Only with bookmarks allowed,
// and only those inside the folder chosen in Settings → Bookmarks.
import type { ContextItem } from '../core/messages';
import { bookmarkMentionSource } from '../core/sources';
import type { Settings } from '../storage/settings';
import { allBookmarks, bookmarksAllowed, bookmarkSlug, bookmarkSlugs } from './store';
import { bookmarkLine } from './tools';

export async function bookmarkMentionItems(typed: string, settings: Settings): Promise<ContextItem[]> {
  const slugs = bookmarkSlugs(typed);
  if (!slugs.length || !(await bookmarksAllowed())) return [];
  const links = (await allBookmarks(settings).catch(() => [])).filter((b) => b.url).sort((a, b) => (b.dateAdded ?? 0) - (a.dateAdded ?? 0));
  return slugs.flatMap((slug) => {
    const b = links.find((x) => bookmarkSlug(x) === slug);
    return b ? [{ kind: 'page' as const, source: bookmarkMentionSource(slug, b.title || b.url!), text: bookmarkLine(b) }] : [];
  });
}
