// The agent manager: several agents at once, each a chat (the side panel's app in an iframe,
// sidepanel.html?tab=…&manager) working on its own tab with its own agent and model. The list says
// who works on what and who waits for you; the chat of the row selected shows beside it. The others stay
// loaded, hidden: removing a chat's iframe would stop or detach its run. Its History lists the saved
// conversations: one goes on in a new row, on a tab chosen for it; one open in a row shows that row.
// Closing the page ends every chat; its rows come back stopped when it opens again (manager/saved), and
// one goes on once clicked: on its tab, or on one chosen for it when that tab is gone or taken. The
// agent of a row the user started may start others under it (agents/panel, usePanelRequests).
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { MANAGER_HIDDEN, MANAGER_STATUS, MANAGER_STOP, MANAGER_STOPPED, chatUrl, type ChatToManager, type ManagerToChat } from '../../manager/protocol';
import { isBusy, mustWarn, rowOfConversation, rowOfSource, rowsReducer, takenTabs, treeOf, type Row } from '../../manager/rows';
import { canResumeOn } from '../../manager/saved';
import { bestEffort } from '../../core/errors';
import { heldConversations } from '../../history/held';
import type { ConversationMeta } from '../../history/store';
import { goToTab } from '../../manager/tabs';
import { SHOW_IN_MANAGER } from '../../core/protocol';
import { onRuntime } from '../../core/runtime';
import { isExtensionPage } from '../../core/sender';
import { SettingsContext } from '../../ui/settings-context';
import { HistoryPanel } from '../sidepanel/HistoryPanel';
import { useAppearance } from '../../ui/appearance';
import { useSettings } from '../../ui/useSettings';
import { AgentRow } from './AgentRow';
import { NewAgentDialog } from './NewAgentDialog';
import { useSplit } from './useSplit';
import { useSavedRows } from './useSavedRows';
import { usePanelRequests } from './usePanelRequests';
import { Icon } from '../../ui/chat-icons';
import { useStableCallback } from '../../ui/useStableCallback';

const TICK_MS = 1000; // a working row's time goes on by this
const STOP_WAIT_MS = 3000; // a chat that does not answer MANAGER_STOP (its turn saved first) is removed anyway

// A saved conversation to go on with (the dialog's), and the stopped row it resumes, if any.
type Continuing = Pick<ConversationMeta, 'id' | 'title' | 'agentId'> & { row?: string };

const toChat = (frame: HTMLIFrameElement | undefined, message: ManagerToChat) => frame?.contentWindow?.postMessage(message, location.origin);

export function Manager() {
  const [settings, update, settingsError, save] = useSettings();
  const settingsValue = useMemo(() => settings && { settings, update, save }, [settings, update, save]);
  useAppearance(settings?.appearance);
  const [{ rows, selected }, dispatch] = useReducer(rowsReducer, { rows: [] });
  const [adding, setAdding] = useState(false);
  const [continuing, setContinuing] = useState<Continuing>();
  const [note, setNote] = useState(''); // why a stopped row did not go on
  const [historyOpen, setHistoryOpen] = useState(false);
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const split = useSplit();
  const now = useNow(rows.some((r) => r.status?.state === 'working'));

  // What the chats tell: only from this page's own iframes.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== location.origin) return;
      const key = rowOfSource(new Map([...frames.current].map(([k, f]) => [k, f.contentWindow])), e.source);
      const data = e.data as ChatToManager | undefined;
      if (!key || !data) return;
      if (data.type === MANAGER_STATUS) dispatch({ type: 'status', key, status: data.status });
      if (data.type === MANAGER_STOPPED) dispatch({ type: 'remove', key });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Closing the page stops every agent in it: the browser asks first while one works or waits.
  const latestRows = useRef(rows);
  useEffect(() => {
    latestRows.current = rows;
  });
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (mustWarn(latestRows.current)) e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  useSavedRows(rows, dispatch);
  usePanelRequests(rows, dispatch, frames);

  // A stopped row goes on: on its tab while it is open on the same site and no live row works on it,
  // else on one chosen for it. Not while another chat has its conversation open.
  const goOn = async (row: Row) => {
    setNote('');
    const id = row.conversationId;
    if (id && (await heldConversations()).has(id)) return setNote('Its conversation is open in another chat: go on with it there.');
    const tab = await browser.tabs.get(row.tabId).catch(() => undefined);
    if (!id || canResumeOn(row, tab, takenTabs(latestRows.current))) return dispatch({ type: 'resume', key: row.key, tabId: row.tabId, agentId: row.agentId });
    setContinuing({ id, title: row.title ?? '', agentId: row.agentId, row: row.key });
    setAdding(true);
  };
  const resume = (row: Row) => void bestEffort(goOn(row), 'manager-resume');
  // From the history: a stopped row with it goes on; any other, in a new row.
  const continueWith = (conv: ConversationMeta) => {
    setHistoryOpen(false);
    const row = rows.find((r) => r.stopped && r.conversationId === conv.id);
    if (row) return resume(row);
    setContinuing(conv);
    setAdding(true);
  };

  // Its row shown, for a conversation open in it (this page's History, or another chat's).
  const showRow = useStableCallback((conversationId: string): boolean => {
    const row = rowOfConversation(rows, conversationId);
    if (!row) return false;
    dispatch({ type: 'select', key: row.key });
    setHistoryOpen(false);
    return true;
  });
  useEffect(
    () =>
      onRuntime(SHOW_IN_MANAGER, (msg, sender) => {
        if (!isExtensionPage(sender) || !showRow(msg.conversationId)) return; // another page of the Agents Panel may have it
        return browser.tabs.getCurrent().then(async (own) => {
          if (own?.id !== undefined) await goToTab(own.id);
          return { shown: true };
        });
      }),
    [showRow],
  );

  // The chats another row's selection hides stop dictating (they stay loaded).
  useEffect(() => {
    for (const [key, frame] of frames.current) if (key !== selected) toChat(frame, { type: MANAGER_HIDDEN });
  }, [selected]);

  // A working one is stopped first (removed while it runs, its run would go on away for a while).
  const remove = (row: Row) => {
    if (!isBusy(row)) return dispatch({ type: 'remove', key: row.key });
    dispatch({ type: 'removing', key: row.key });
    toChat(frames.current.get(row.key), { type: MANAGER_STOP });
    setTimeout(() => dispatch({ type: 'remove', key: row.key }), STOP_WAIT_MS);
  };

  const chatShown = rows.some((r) => r.key === selected && !r.stopped);
  // One top row: the page's title and buttons over the list, the chat's own top bar beside them (the
  // chat goes up to the top, so its menus open from its own bar).
  return (
    <div className="manager">
      <div className="manager-side" style={{ width: split.width }}>
        <header className="manager-head">
          <h1>Agents Panel</h1>
          <button aria-pressed={historyOpen} onClick={() => setHistoryOpen((o) => !o)} title="The saved conversations: go on with one in a new row">
            <Icon name="history" /> History
          </button>
          <button className={adding && !continuing ? 'active' : 'primary'} aria-expanded={adding && !continuing}
            onClick={() => {
              if (continuing) setContinuing(undefined); // the dialog stays, for a new conversation
              else setAdding((a) => !a);
            }}>+ New agent</button>
        </header>
        {settingsError && <div className="msg error" role="alert">{settingsError}</div>}
        {note && <div className="msg" role="status">{note}</div>}
        {adding && settings && (
          <NewAgentDialog key={continuing?.id ?? 'new'} settings={settings} taken={takenTabs(rows)} conversation={continuing}
            onClose={() => {
              setAdding(false);
              setContinuing(undefined);
            }}
            onStart={(tabId, agentId) => {
              const conversationId = continuing?.id;
              if (continuing?.row) dispatch({ type: 'resume', key: continuing.row, tabId, agentId });
              else dispatch({ type: 'add', row: { key: crypto.randomUUID(), tabId, ...(agentId && { agentId }), ...(conversationId && { conversationId }) } });
              setAdding(false);
              setContinuing(undefined);
            }} />
        )}
        <div className="manager-list" role="list">
          {!rows.length && <p className="empty">No agents yet. Start one with + New agent.</p>}
          {rows.map((row, i) => (
            <AgentRow key={row.key} row={row} selected={row.key === selected} now={now} tree={treeOf(rows, i)}
              onSelect={() => (row.stopped ? resume(row) : dispatch({ type: 'select', key: row.key }))} onRemove={() => remove(row)} />
          ))}
        </div>
      </div>
      <div className="manager-divider" role="separator" aria-orientation="vertical" onPointerDown={split.onPointerDown} />
      <div className="manager-chats">
        {!chatShown && <div className="manager-chats-bar" />}
        {rows.filter((row) => !row.stopped).map((row) => (
          <iframe key={row.key} className="manager-frame" src={chatUrl(row.tabId, row.agentId, row.conversationId, { key: row.key, parent: row.parent })} hidden={row.key !== selected} allow="microphone"
            ref={(f) => {
              if (f) frames.current.set(row.key, f);
              else frames.current.delete(row.key);
            }} />
        ))}
        {historyOpen && settingsValue && (
          <SettingsContext.Provider value={settingsValue}>
            <HistoryPanel onClose={() => setHistoryOpen(false)} onShowInManager={showRow}
              onOpen={continueWith} />
          </SettingsContext.Provider>
        )}
      </div>
    </div>
  );
}

// The time now, again each second while `ticking` (a working row's time goes on).
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, [ticking]);
  return now;
}
