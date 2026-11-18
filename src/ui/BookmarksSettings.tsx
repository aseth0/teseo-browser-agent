// Settings → Bookmarks: whether the model may use the browser's bookmarks (an optional permission,
// asked from a click, the switch at the top), the folder it sees (only that one and what is inside it,
// or all of them), auto-attach and a message tried against them.
import { onPermissionsChanged } from './permissions-changed';
import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { BOOKMARK_AUTO_DEFAULTS, BOOKMARK_CANDIDATES, BOOKMARKS_PERMISSION, bookmarksAllowed, bookmarksUnder, defaultFolder, DEFAULT_FOLDER_TITLE, everyFolder, rankBookmarks, type Folder } from '../bookmarks/store';
import { withAutoAttach } from '../storage/settings-select';
import { ATTACH_UNSEEN, type StepAttach } from '../storage/settings-types';
import { MentionsFold } from './MentionsFold';
import { bookmarkPicks } from '../bookmarks/auto';
import { AttachPlayground, AutoAttachCard, StepsCheck } from './AutoAttachBlock';
import { MatchCards, SectionHead, SectionTabs, StatStrip, TryBelow } from './SectionParts';
import { PageModelTexts } from './PageModelTexts';
import { Snippet } from './Snippet';
import { toolPage } from './text-pages';
import type { SectionProps as Props } from './useSettings';
import { errorText } from '../core/errors';
import { askPermission } from './ask-permission';

export function BookmarksSection({ settings, onChange }: Props) {
  const [allowed, setAllowed] = useState<boolean>();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [count, setCount] = useState<number>();
  const [message, setMessage] = useState('');
  const rootId = settings.bookmarks?.rootId;
  // On the settings as they are by then: a folder made is set after an await.
  const setRoot = (id: string | undefined) => onChange((s) => ({ ...s, bookmarks: { ...s.bookmarks, rootId: id } }));

  const refresh = async () => {
    const now = await bookmarksAllowed();
    setAllowed(now);
    setFolders(now ? await everyFolder() : []);
  };
  useEffect(() => {
    void refresh();
    return onPermissionsChanged(() => void refresh());
  }, []);
  // How many the model sees: again when the folder or the access changes.
  useEffect(() => {
    if (!allowed) return setCount(undefined);
    let current = true;
    void bookmarksUnder(rootId).then((list) => current && setCount(list.length), () => current && setCount(undefined));
    return () => {
      current = false;
    };
  }, [allowed, rootId]);

  // From the click itself: the browser asks only then.
  const allow = async () => setMessage((await askPermission(BOOKMARKS_PERMISSION)) ? '' : 'The browser did not allow it.');
  const revoke = async () => {
    await browser.permissions.remove(BOOKMARKS_PERMISSION).catch(() => false);
    setMessage('');
  };
  const makeFolder = async () => {
    try {
      const id = await defaultFolder();
      await refresh();
      setRoot(id);
    } catch (e) {
      setMessage(`Error: ${errorText(e)}`);
    }
  };
  const missing = rootId && allowed && folders.length > 0 && !folders.some((f) => f.id === rootId);
  const folder = folders.find((f) => f.id === rootId);
  const auto = settings.bookmarks?.autoAttach ?? {};
  const access = (
    <>
      {allowed === false && (
        <p>
          The browser has not given the extension your bookmarks. <button type="button" onClick={() => void allow()}>Allow bookmarks…</button>
        </p>
      )}
      {message && <p className="hint">{message}</p>}
      {allowed && (
        <div className="settings-block">
          <label>
            Folder the extension sees
            <select value={rootId ?? ''} onChange={(e) => setRoot(e.target.value || undefined)} aria-label="Bookmarks folder the extension sees">
              <option value="">All bookmarks</option>
              {missing && <option value={rootId}>(deleted folder)</option>}
              {folders.map((f) => (
                <option key={f.id} value={f.id} title={f.path}>{'\u00a0\u00a0\u00a0'.repeat(f.depth)}{f.title || '(no name)'}</option>
              ))}
            </select>
          </label>
          <p className="hint">
            With a folder, the model sees, searches and saves only inside it, and its paths start there: it does not learn the rest of your bookmarks.{' '}
            <button type="button" onClick={() => void makeFolder()}>Use a “{DEFAULT_FOLDER_TITLE}” folder</button> (made in Other bookmarks if it is not there).
          </p>
          {missing && <p className="hint warn">That folder no longer exists: choose another one.</p>}
        </div>
      )}
      <p className="hint">The tools are under Bookmarks in {toolPage('bookmarks')}.</p>
    </>
  );
  return (
    <section>
      <SectionHead title="Bookmarks" about="The model searches and lists one folder of your bookmarks, saves or deletes one once you confirm, and can attach those your message matches."
        toggle={allowed === undefined ? undefined : { label: 'Allowed', on: allowed, title: 'Whether the browser gives the extension your bookmarks', onChange: (on) => void (on ? allow() : revoke()) }} />
      <StatStrip stats={[
        { label: 'Folder the model sees', value: <span className="stat-text">{allowed === undefined ? '–' : !allowed ? 'None: not allowed' : folder ? folder.path : missing ? 'A deleted folder' : 'All bookmarks'}</span> },
        { label: 'Bookmarks in it', value: count === undefined ? '–' : count.toLocaleString('en-US') },
        { label: 'Auto-attach', value: <span className="stat-text">{auto.enabled ? `On · ${auto.threshold ?? BOOKMARK_AUTO_DEFAULTS.threshold}%` : 'Off'}</span>, sub: auto.enabled ? `At most ${auto.max ?? BOOKMARK_AUTO_DEFAULTS.max} per message` : undefined },
      ]} />
      <SectionTabs label="Bookmarks" tabs={[
        { id: 'folder', label: 'Folder', render: () => access },
        { id: 'matching', label: 'Matching', render: () => <><BookmarksMatching settings={settings} onChange={onChange} /><TryBelow><BookmarksTry settings={settings} disabled={!allowed} /></TryBelow></> },
        { id: 'texts', label: 'Mentions and texts', render: () => (
          <>
            <MentionsFold syntax="b::bookmark">
              <p className="hint">
                Mention a bookmark in a message with <code>b::</code> and its title in lowercase with dashes (the suggestions list them) to attach its title,
                URL and folder to that message (switch mentions off in Auto-inject → Mentions).
              </p>
            </MentionsFold>
            <PageModelTexts page="bookmarks" />
          </>
        ) },
      ]} />
    </section>
  );
}

// Settings → Bookmarks → Matching: auto-attach on its card.
function BookmarksMatching({ settings, onChange }: Props) {
  const auto = settings.bookmarks?.autoAttach ?? {};
  const setAuto = (change: Partial<StepAttach>) => onChange(withAutoAttach(settings, 'bookmarks', change));
  return (
    <>
      <MatchCards>
        <AutoAttachCard auto={auto} defaults={BOOKMARK_AUTO_DEFAULTS} onChange={setAuto} label="Attach the bookmarks your message matches well enough on their own" rangeLabel="Bookmark match needed"
          about="Your message → the bookmarks the extension sees"
          after={<StepsCheck on={auto.steps ?? false} off={!auto.enabled} onChange={(steps) => setAuto({ steps })} />} />
      </MatchCards>
      <p className="hint">Under your message, a small bookmark pill says how many went (a click lists them).</p>
    </>
  );
}

// Settings → Bookmarks → Matching, under the card (bookmarks/auto): a message tried against the bookmarks the extension
// sees, with what would go with it.
function BookmarksTry({ settings, disabled }: Pick<Props, 'settings'> & { disabled: boolean }) {
  const auto = settings.bookmarks?.autoAttach ?? {};
  const search = async (query: string) => {
    const ranked = await rankBookmarks(settings, query, BOOKMARK_CANDIDATES, { unseen: ATTACH_UNSEEN });
    const picks = bookmarkPicks(ranked, query, [], settings.bookmarks?.autoAttach);
    return {
      picked: picks.map((p) => p.bookmark.id),
      hits: ranked.map(({ bookmark: b, match }) => ({
        id: b.id,
        match,
        title: <Snippet text={b.title || b.url!} query={query} prefix={false} cut={false} />,
        detail: <p className="muted small"><Snippet text={`/${b.path} · ${b.url}`} query={query} prefix={false} cut={false} /></p>,
      })),
    };
  };
  return (
    <AttachPlayground auto={auto} defaults={BOOKMARK_AUTO_DEFAULTS} disabled={disabled} search={search} refresh={settings.bookmarks?.rootId}
      nouns={['bookmark', 'bookmarks']} searchLabel="Try a bookmarks search"
      hint={disabled ? 'Allow bookmarks first (at the top).' : 'A message as you would send it: how well each bookmark the extension sees matches, against the card above, and which would go with it.'} />
  );
}
