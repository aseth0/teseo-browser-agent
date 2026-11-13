// The saved conversations, over the chat: grouped by when they were last touched, or the best matches
// of a search first (search/bm25); open one to go on with it, rename, export (Markdown or JSON) or delete it,
// or select several and delete them. Deleting is confirmed inside the panel: a side panel shows no confirm().
// One open in another chat now (history/held) does not open here: one in the Agents Panel shows its row there.
import { Icon } from '../../ui/chat-icons';
import { useEffect, useState } from 'react';
import { errorText } from '../../core/errors';
import { AUTO_DEFAULTS } from '../../history/auto';
import { conversationMarkdown } from '../../history/markdown';
import { snippetOf } from '../../history/read';
import { agentNames, deleteConversations, listConversations, loadConversation, renameConversation, setPinned, type Conversation, type ConversationMeta } from '../../history/store';
import { searchList } from '../../history/search';
import { useConversationsVersion } from '../../ui/useConversations';
import { downloadText } from '../../ui/download';
import { AutoAttachFields } from '../../ui/HistorySettings';
import { shortTokens } from '../../ui/Usage';
import { Snippet } from '../../ui/Snippet';
import { useSettingsContext } from '../../ui/settings-context';
import { InlineConfirm } from '../../ui/InlineConfirm';
import { PanelHead } from './PanelHead';
import { useAttempt } from '../../ui/useAttempt';
import { isEnter } from '../../ui/enter';
import { TitleLinks } from '../../ui/TitleLinks';
import { plainTitle } from '../../history/title-links';
import { openOffTitle, type OpenOff } from './WatchesMenu';
import { heldConversations, heldElsewhere, type Holder } from '../../history/held';
import { useHeldConversations } from '../../ui/useHeld';
import { sendRuntime } from '../../core/runtime';
import { SHOW_IN_MANAGER } from '../../core/protocol';

interface Props {
  currentId?: string; // none: no chat (the Agents Panel's own history)
  openOff?: OpenOff; // none opens now, and why
  onOpen: (conv: Conversation) => void;
  onClose: () => void;
  // A conversation open in the Agents Panel: its row shown (by default, asked of the page that has it).
  onShowInManager?: (conversationId: string) => void;
}

const showInManager = (conversationId: string) => void sendRuntime({ type: SHOW_IN_MANAGER, conversationId }).catch(() => undefined);

// What a conversation open in another chat says, and does on a click.
const HELD_TITLE: Record<Holder, string> = {
  manager: 'Open in the Agents Panel: show it there',
  chat: 'Open in another chat now: go on with it there',
  floating: 'Open in a chat floating on a page now: go on with it there',
};
const HELD_NOTE: Record<Holder, string> = { manager: 'In the Agents Panel', chat: 'Open in another chat', floating: 'Open in another chat' };

const DAY = 86_400_000;
const startOfToday = () => new Date().setHours(0, 0, 0, 0);

function groupOf(at: number): string {
  const today = startOfToday();
  if (at >= today) return 'Today';
  if (at >= today - DAY) return 'Yesterday';
  if (at >= today - 6 * DAY) return 'Last 7 days';
  return 'Older';
}

const when = (at: number) =>
  at >= startOfToday() ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : new Date(at).toLocaleDateString([], { day: 'numeric', month: 'short' });

const fileName = (c: ConversationMeta, ext: string) => `${c.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 50) || 'conversation'}.${ext}`;

export function HistoryPanel({ currentId, openOff, onOpen, onClose, onShowInManager = showInManager }: Props) {
  const { settings, update: onChange } = useSettingsContext();
  const [autoOpen, setAutoOpen] = useState(false);
  const auto = settings.history?.autoAttach ?? {};
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const { failed, attempt } = useAttempt();
  const { list, unread } = useHistoryList(query);
  const selection = useHistorySelection(list);
  const held = useHeldConversations();
  const { selecting, setSelecting, setPicked, selected, allSelected, stopSelecting, deleteSelected } = selection;

  const open = async (id: string) => {
    if (heldElsewhere(await heldConversations(), id, currentId)) return; // taken since the list was read
    const conv = await loadConversation(id);
    if (conv) onOpen(conv);
  };
  const exportAs = async (c: ConversationMeta, format: 'md' | 'json') => {
    const conv = await loadConversation(c.id);
    if (!conv) return;
    if (format === 'md') downloadText(fileName(c, 'md'), conversationMarkdown(conv), 'text/markdown');
    else downloadText(fileName(c, 'json'), JSON.stringify(conv, null, 1));
  };

  const conversations = (n: number) => `${n} ${n === 1 ? 'conversation' : 'conversations'}`;

  // Searching: the best matches; otherwise the pinned ones first, then by when they were touched.
  const groups = query.trim() ? (list?.length ? [['Best matches', list] as const] : []) : Object.entries(Object.groupBy(list ?? [], (c) => (c.pinned ? 'Pinned' : groupOf(c.updatedAt))));
  return (
    <div className="overlay-panel" role="dialog" aria-label="Conversation history">
      <PanelHead query={query} onQuery={setQuery} placeholder='Search conversations… ("a phrase" in quotes)' label="Search conversations" onClose={onClose}>
        <button className="history-auto-toggle" aria-expanded={autoOpen} onClick={() => setAutoOpen((o) => !o)}
          title="Attach saved conversations to your messages on their own (Settings → History)">
          Auto-attach: {auto.enabled ? `${auto.threshold ?? AUTO_DEFAULTS.threshold}%` : 'off'} ▾
        </button>
        <button aria-pressed={selecting} onClick={() => (selecting ? stopSelecting() : setSelecting(true))} title="Select several conversations to delete them">
          {selecting ? 'Done' : 'Select'}
        </button>
      </PanelHead>
      {selecting && (
        <div className="history-selection">
          <label className="check">
            <input type="checkbox" checked={allSelected} disabled={!list?.length} aria-label="Select all"
              onChange={() => setPicked(allSelected ? new Set() : new Set(list!.map((c) => c.id)))} />
            {selected.length} selected
          </label>
          <InlineConfirm question={`Delete ${conversations(selected.length)}${selected.some((c) => c.pinned) ? ', pinned ones too' : ''}?`}
            label={`Confirm: delete ${conversations(selected.length)}`} onConfirm={() => attempt(deleteSelected())}>
            {(ask) => <button className="danger" disabled={!selected.length} onClick={ask}>Delete selected</button>}
          </InlineConfirm>
        </div>
      )}
      {autoOpen && (
        <div className="history-auto">
          <AutoAttachFields settings={settings} onChange={onChange} />
        </div>
      )}
      {failed && <p className="error-text" role="alert">{failed}</p>}
      <div className="history-list">
        {unread && <p className="error-text" role="alert">The saved conversations could not be read: {unread}</p>}
        {list && !list.length && <p className="muted">{query ? 'No conversation matches.' : 'No saved conversations yet: they are saved after every turn.'}</p>}
        {groups.map(([group, items]) => (
          <section key={group}>
            <div className="history-group">{group}</div>
            {items!.map((c) => (
              <HistoryItem key={c.id} c={c} query={query} current={c.id === currentId} selection={selection}
                renaming={renaming === c.id} setRenaming={setRenaming} openOff={openOff} attempt={attempt} onOpen={() => open(c.id)} exportAs={(format) => exportAs(c, format)}
                heldBy={heldElsewhere(held, c.id, currentId)} onShow={() => onShowInManager(c.id)} />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

// A saved conversation in the list: open it (or pick it, while selecting), rename, pin, export or
// delete it.
function HistoryItem({ c, query, current, selection, renaming, setRenaming, openOff, attempt, onOpen, exportAs, heldBy, onShow }: {
  c: ConversationMeta | Conversation;
  query: string;
  current: boolean;
  selection: ReturnType<typeof useHistorySelection>;
  renaming: boolean;
  setRenaming: (id: string | null) => void;
  openOff?: OpenOff;
  attempt: ReturnType<typeof useAttempt>['attempt'];
  onOpen: () => Promise<void>;
  exportAs: (format: 'md' | 'json') => Promise<void>;
  heldBy?: Holder; // open in another chat now
  onShow: () => void;
}) {
  const { selecting } = selection;
  const picked = selection.picked.has(c.id);
  const onPick = () => selection.toggle(c.id);
  const click = () => (selecting ? onPick() : heldBy === 'manager' ? onShow() : attempt(onOpen()));
  const title = selecting ? 'Select or unselect it' : heldBy ? HELD_TITLE[heldBy] : openOffTitle(openOff, 'Open and go on with it');
  return (
    <div className={`history-item${current ? ' current' : ''}${picked ? ' selected' : ''}`}>
      {selecting && <input type="checkbox" checked={picked} aria-label={`Select ${plainTitle(c.title)}`} onChange={onPick} />}
      {renaming ? (
        <input className="history-rename" defaultValue={c.title} aria-label="New title" autoFocus
          onKeyDown={(e) => {
            if (isEnter(e)) attempt(renameConversation(c.id, e.currentTarget.value), () => setRenaming(null));
            if (e.key === 'Escape') setRenaming(null);
          }}
          onBlur={(e) => attempt(renameConversation(c.id, e.currentTarget.value), () => setRenaming(null))} />
      ) : (
        <button className="history-open" onClick={click} disabled={!selecting && (heldBy ? heldBy === 'chat' : !!openOff)} title={title}>
          <span className="history-title"><TitleLinks title={c.title} /></span>
          {query.trim() && 'history' in c && <Snippet text={snippetOf(c, query, { prefix: true })} query={query} />}
          <span className="history-meta">
            {c.origin === 'manager' && <span className="history-origin" title="Started in the Agents Panel"><Icon name="agents" size={11} /> </span>}
            {[heldBy && HELD_NOTE[heldBy], agentNames(c), c.site, c.model, `${c.turns} ${c.turns === 1 ? 'message' : 'messages'}`, c.tokens !== undefined && `${shortTokens(c.tokens)} tokens`].filter(Boolean).join(' · ')}
          </span>
        </button>
      )}
      <span className="history-when">{c.pinned && <><Icon name="pin" size={11} /> </>}{when(c.updatedAt)}</span>
      <InlineConfirm label={`Confirm: delete ${plainTitle(c.title)}`} onConfirm={() => attempt(deleteConversations([c.id]))}>
        {(ask) => !selecting && (
          <span className="history-actions">
            <button className="icon-button" aria-pressed={!!c.pinned}
              title={c.pinned ? 'Unpin' : 'Pin: listed first, never deleted by the retention, and searched in full (reasoning and tool arguments too)'}
              aria-label={`${c.pinned ? 'Unpin' : 'Pin'} ${plainTitle(c.title)}`} onClick={() => attempt(setPinned(c.id, !c.pinned))}><Icon name="pin" /></button>
            <button className="icon-button" title="Rename" aria-label={`Rename ${plainTitle(c.title)}`} onClick={() => setRenaming(c.id)}><Icon name="rename" /></button>
            <button className="icon-button" title="Export as Markdown" aria-label={`Export ${plainTitle(c.title)} as Markdown`} onClick={() => attempt(exportAs('md'))}>MD</button>
            <button className="icon-button" title="Export as JSON (everything, to import it back)" aria-label={`Export ${plainTitle(c.title)} as JSON`} onClick={() => attempt(exportAs('json'))}>{'{}'}</button>
            <button className="icon-button warn" title="Delete" aria-label={`Delete ${plainTitle(c.title)}`} onClick={ask}><Icon name="close" /></button>
          </span>
        )}
      </InlineConfirm>
    </div>
  );
}

// The best matches read whole for their snippets: the others are listed without one.
const SNIPPETS = 20;

// The saved conversations listed: the best matches of `query` first (the first whole, for their
// snippets), else the index alone, latest first; again on every change to them (a turn ends, another
// panel saves).
function useHistoryList(query: string) {
  const [list, setList] = useState<(ConversationMeta | Conversation)[] | null>(null); // whole when searching
  const [unread, setUnread] = useState(''); // why the list could not be read
  const version = useConversationsVersion();
  useEffect(() => {
    let current = true;
    const load = () => (query.trim() ? searchList(query, { prefix: true, whole: SNIPPETS }) : listConversations());
    const show = async () => {
      try {
        const l = await load();
        if (!current) return;
        setList(l);
        setUnread('');
      } catch (e) {
        if (current) setUnread(errorText(e));
      }
    };
    const timer = setTimeout(() => void show(), query ? 200 : 0);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, version]);
  return { list, unread };
}

// Several conversations picked to delete them.
function useHistorySelection(list: (ConversationMeta | Conversation)[] | null) {
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // Only the listed ones count as selected: another panel may have deleted some, or a search hides them.
  const selected = (list ?? []).filter((c) => picked.has(c.id));
  const allSelected = !!list?.length && selected.length === list.length;
  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const stopSelecting = () => {
    setSelecting(false);
    setPicked(new Set());
  };
  const deleteSelected = async () => {
    await deleteConversations(selected.map((c) => c.id));
    setPicked(new Set());
  };
  return { selecting, setSelecting, picked, setPicked, selected, allSelected, toggle, stopSelecting, deleteSelected };
}
