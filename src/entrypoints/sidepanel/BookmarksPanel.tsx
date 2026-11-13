// The bookmarks the extension sees (Settings → Bookmarks), over the chat: a folder at a time, or the
// best matches of a search; open one in a new tab, delete one (confirmed in the panel: a side panel
// shows no confirm()), or bookmark the page open in the panel here. Until bookmarks are allowed, the
// button that asks the browser.
import { onPermissionsChanged } from '../../ui/permissions-changed';
import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { BOOKMARKS_PERMISSION, bookmarksAllowed, bookmarksUnder, folderPath, saveBookmark, searchBookmarks, type Bookmark } from '../../bookmarks/store';
import { errorText } from '../../core/errors';
import { Icon } from '../../ui/chat-icons';
import { openOptions } from '../../ui/open-options';
import { useSettingsContext } from '../../ui/settings-context';
import { askPermission } from '../../ui/ask-permission';
import { InlineConfirm } from '../../ui/InlineConfirm';
import { PanelHead } from './PanelHead';
import { useAttempt } from '../../ui/useAttempt';

interface Props {
  page: { url?: string; title?: string };
  onClose: () => void;
}

export function BookmarksPanel({ page, onClose }: Props) {
  const { settings } = useSettingsContext();
  const rootId = settings.bookmarks?.rootId;
  const [allowed, setAllowed] = useState<boolean>();
  const [all, setAll] = useState<Bookmark[]>([]);
  const [found, setFound] = useState<Bookmark[]>();
  const [query, setQuery] = useState('');
  const [path, setPath] = useState(''); // the folder shown, from the root
  const { failed, setFailed, attempt: attemptThen } = useAttempt();
  const [version, setVersion] = useState(0);

  useEffect(() => onPermissionsChanged(() => setVersion((v) => v + 1)), []);
  useEffect(() => {
    let current = true;
    void (async () => {
      const ok = await bookmarksAllowed();
      if (!current) return;
      setAllowed(ok);
      if (!ok) return;
      try {
        const list = await bookmarksUnder(rootId);
        if (current) setAll(list);
        setFailed('');
      } catch (e) {
        if (current) setFailed(errorText(e));
      }
    })();
    return () => {
      current = false;
    };
  }, [rootId, version, setFailed]);
  useEffect(() => {
    if (!query.trim() || !allowed) return setFound(undefined);
    let current = true;
    // A failed one shows no results and says why, rather than none found.
    const search = async () => {
      try {
        const l = await searchBookmarks(settings, query, 50);
        if (!current) return;
        setFound(l);
        setFailed('');
      } catch (e) {
        if (!current) return;
        setFound([]);
        setFailed(`The search failed: ${errorText(e)}`);
      }
    };
    const timer = setTimeout(() => void search(), 150);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, allowed, version, settings, setFailed]);

  // A click's work: its error shown, the list read again either way.
  const attempt = (work: Promise<unknown>) => attemptThen(work, () => setVersion((v) => v + 1));
  const folder = path ? all.find((b) => !b.url && folderPath(b) === path) : undefined;
  const here = all.filter((b) => b.path === path).sort((a, b) => Number(!!a.url) - Number(!!b.url)); // folders first
  const shown = found ?? here;
  const up = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  const addPage = async () => {
    if (!page.url || !/^(https?|ftp|file):/i.test(page.url)) throw new Error('This page cannot be bookmarked.');
    await saveBookmark(settings, { title: page.title || page.url, url: page.url, folderId: folder?.id });
  };

  return (
    <div className="overlay-panel" role="dialog" aria-label="Bookmarks">
      <PanelHead query={query} onQuery={setQuery} placeholder="Search bookmarks…" label="Search bookmarks" disabled={!allowed} onClose={onClose}>
        <button onClick={() => void openOptions('bookmarks')} title="The folder the extension sees, in Settings → Bookmarks">Settings…</button>
      </PanelHead>
      {allowed === false && (
        <div className="history-list">
          <p className="muted">The browser has not given the extension your bookmarks.</p>
          <button onClick={() => void askPermission(BOOKMARKS_PERMISSION)}>Allow bookmarks…</button>
        </div>
      )}
      {allowed && (
        <>
          {!found && (
            <div className="history-selection">
              <span>
                {path && (
                  <button className="icon-button" title="Up one folder" aria-label="Up one folder" onClick={() => setPath(up)}><Icon name="folderUp" /></button>
                )}{' '}
                /{path}
              </span>
              <button onClick={() => attempt(addPage())} disabled={!page.url} title={`Bookmark ${page.title ?? 'the page open in the panel'} in this folder`}>
                <Icon name="newChat" size={12} /> This page
              </button>
            </div>
          )}
          {failed && <div className="msg error" role="alert">{failed}</div>}
          <div className="history-list">
            {!shown.length && <p className="muted">{found ? 'No bookmark matches.' : 'This folder is empty.'}</p>}
            {shown.map((b) => (
              <div key={b.id} className="history-item">
                {b.url ? (
                  <button className="history-open" title={b.url} onClick={() => void browser.tabs.create({ url: b.url })}>
                    <span className="history-title"><Icon name="bookmark" size={12} /> {b.title || b.url}</span>
                    <span className="history-meta">{[found && `/${b.path}`, b.url].filter(Boolean).join(' · ')}</span>
                  </button>
                ) : (
                  <button className="history-open" onClick={() => { setQuery(''); setPath(folderPath(b)); }}>
                    <span className="history-title"><Icon name="folder" size={12} /> {b.title}</span>
                    {found && <span className="history-meta">/{b.path}</span>}
                  </button>
                )}
                <InlineConfirm label={`Confirm: delete ${b.title}`} onConfirm={() => attempt(browser.bookmarks.remove(b.id))}>
                  {(ask) => (
                    <span className="history-actions">
                      <button className="icon-button warn" title={b.url ? 'Delete' : 'Delete (only an empty folder)'} aria-label={`Delete ${b.title}`} onClick={ask}>
                        <Icon name="close" />
                      </button>
                    </span>
                  )}
                </InlineConfirm>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
