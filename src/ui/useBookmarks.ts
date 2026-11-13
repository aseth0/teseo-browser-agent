// The bookmarks b:: suggests in the message box: those inside the folder chosen in Settings →
// Bookmarks, once allowed; read again when they or the permission change.
import { onPermissionsChanged } from './permissions-changed';
import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { bookmarksAllowed, bookmarksUnder, type Bookmark } from '../bookmarks/store';

export function useBookmarks(on: boolean, rootId: string | undefined): Bookmark[] {
  const [list, setList] = useState<Bookmark[]>([]);
  // A permission given or taken: everything below again, the bookmarks' events too (they exist only
  // while allowed).
  const [granted, setGranted] = useState(0);
  useEffect(() => onPermissionsChanged(() => setGranted((n) => n + 1)), []);
  useEffect(() => {
    if (!on) return setList([]);
    let current = true;
    const load = async () => {
      const links = (await bookmarksAllowed()) ? (await bookmarksUnder(rootId).catch(() => [])).filter((b) => b.url) : [];
      if (current) setList(links.sort((a, b) => (b.dateAdded ?? 0) - (a.dateAdded ?? 0)));
    };
    void load();
    const reload = () => void load();
    const changes = browser.bookmarks ? [browser.bookmarks.onCreated, browser.bookmarks.onRemoved, browser.bookmarks.onChanged, browser.bookmarks.onMoved] : [];
    for (const e of changes) e.addListener(reload);
    return () => {
      current = false;
      for (const e of changes) e.removeListener(reload);
    };
  }, [on, rootId, granted]);
  return list;
}
