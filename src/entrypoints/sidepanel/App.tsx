import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { floatingChatAvailable } from '../../core/build';
import { createPortal } from 'react-dom';
import type { DisplayValues } from '../../core/display-defs';
import type { ChatView } from '../../storage/settings-types';
import { ChatViewContext, DisplayContext } from '../../ui/ChatMessages';
import { useAppearance } from '../../ui/appearance';
import { openOptions } from '../../ui/open-options';
import { openFullChat, openManager } from '../../browser/open-manager';
import { useSampleChat } from '../../ui/ConversationPreview';
import { SAMPLE_PAGE } from '../../ui/sample-page';
import { agentLabel, type AgentProfile } from '../../agents/profiles';
import { useSiteAgent } from './AgentPicker';
import { Chat, type QueuedMessage } from './Chat';
import { HistoryPanel } from './HistoryPanel';
import { BookmarksPanel } from './BookmarksPanel';
import { MemoryPanel } from './MemoryPanel';
import { openWithAgent, previewAgent, useAgent, type Agent } from './useAgent';
import { useHistory, type StaleSave } from './useHistory';
import { useTemporary, type Temporary } from './useTemporary';
import { floatOnPage, movePanel, NOT_SENT_ELSEWHERE, useFloatingConversation, useFloatingState, useMoveToPanel } from './floating';
import type { RunGate } from './useSendPipeline';
import { ANSWERING_ELSEWHERE, NO_TAB } from '../../widget/protocol';
import { FLOATING, FULL, MANAGER, PREVIEW } from '../../ui/floating-frame';
import { WINDOW_PANEL, useChatPage, type PageTarget } from './usePageTarget';
import { useSettings } from '../../ui/useSettings';
import { SettingsContext, useSettingsContext } from '../../ui/settings-context';
import { useStableCallback } from '../../ui/useStableCallback';
import { Icon } from '../../ui/chat-icons';
import { OverflowBar } from '../../ui/OverflowBar';
import { TextSizeMenu } from './TextSizeMenu';
import { WatchesMenu, type OpenOff } from './WatchesMenu';
import { HANDOFF_MS } from '../../core/handoff';
import { CHAT_HANDOFF, isConversationPayload } from '../../widget/protocol';
import { useHandoff } from './useHandoff';
import { usePanelPresence } from './usePanelPresence';
import { chatChrome } from './modes';
import { FloatingScope, useOwnAgent } from './floating-agent';
import { ManagerScope, useManagerConversation, useManagerStatus } from './manager-chat';
import { heldConversations, heldElsewhere } from '../../history/held';
import { useHoldConversation } from '../../ui/useHeld';
import { panelsPerTab } from '../../core/side-panel';
import { forgetRevision, loadConversation, noteRevision, type Conversation } from '../../history/store';
import { displayValues, historyOn, memoryOn, panelFollowsOn } from '../../storage/settings-select';

const NO_CHAT_VIEW: ChatView = {}; // one object, so the chat does not re-render for a new {}

// PREVIEW: the panel as Settings → Appearance shows it, with an example conversation on an invented
// page; nothing is sent.
const CHROME = chatChrome({ floating: FLOATING, manager: MANAGER, full: FULL, preview: PREVIEW });

type Overlay = 'history' | 'memory' | 'bookmarks' | undefined;

// Where the chat puts its own buttons in the top bar, one place each (so each can go behind ⋯).
type TopbarSlots = Partial<Record<'pin' | 'record' | 'temporary' | 'move' | 'watches' | 'autoInject', HTMLElement | null>>;

// The real chat, saved in the history (unless temporary); the history, memory and bookmarks panels
// open over it.
function LiveChat(props: { overlay: Overlay; onCloseOverlay: () => void; onOpenMemory: () => void; topbar: TopbarSlots }) {
  const { settings, update } = useSettingsContext();
  const agent = useAgent();
  const temporary = useTemporary(agent);
  const [tabGone, setTabGone] = useState(false); // the tab the conversation worked on was closed
  const page = useChatPage(agent.conversationId, agent.busy, () => setTabGone(true));
  useNoteFor(tabGone, () => setTabGone(false));
  const saving = historyOn(settings);
  // Floating, the pinned conversation's saves are checked: a save refused (another chat saved it since)
  // goes to the floating chat (useFloatingConversation), which keeps the turn and shows the saved one.
  const sticky = useRef<{ id?: string; onStale?: (conv: StaleSave) => void }>({});
  const checks = useMemo(() => ({ checked: (id: string) => FLOATING && id === sticky.current.id, onStale: (conv: StaleSave) => sticky.current.onStale?.(conv) }), []);
  const unsaved = useHistory(agent, settings, page, update, temporary.isTemporary, checks);
  const [siteAgent, setSiteAgent] = useState<AgentProfile>(); // the agent the chat just changed to on reaching its site
  useSiteAgent(page.url, agent.busy || agent.compacting, settings, update, setSiteAgent);
  useNoteFor(!!siteAgent, () => setSiteAgent(undefined));
  // Floating: the pinned conversation, while one is (the widget's bar), else its tab's own.
  const floating = useFloatingConversation(agent, temporary.off, temporary.on || !saving);
  sticky.current = { id: floating.sticky ? agent.conversationId : undefined, onStale: floating.onStale };
  // Floating: its conversation goes to the side panel from the widget's bar, between turns; where the
  // browser did not open the panel, it waits there and this chat starts anew.
  const movable = !agent.busy && !agent.compacting && !temporary.on;
  useFloatingState(agent, movable, floating.sticky, floating.stickable && movable && saving && agent.history.length > 0 && !floating.elsewhere);
  const runGate = useMemo<RunGate>(() => ({ off: floating.elsewhere ? NOT_SENT_ELSEWHERE : undefined, autoOff: floating.autoOff, claim: floating.claim, unclaim: floating.unclaim }),
    [floating.elsewhere, floating.autoOff, floating.claim, floating.unclaim]);
  const [waiting, setWaiting] = useState(false);
  const [moveFailed, setMoveFailed] = useState(''); // why its conversation could not go to the side panel
  useMoveToPanel(agent, settings.activeAgentId, movable, () => setWaiting(true), setMoveFailed);
  useNoteFor(waiting, () => setWaiting(false));
  useNoteFor(!!moveFailed, () => setMoveFailed(''));
  useManagerStatus(agent, page);
  // The conversation shown is held while shown: no other chat opens it meanwhile (history/held).
  useHoldConversation(MANAGER ? 'manager' : FLOATING ? 'floating' : 'chat', agent.conversationId);
  // From the page widget, a new conversation as the action's agent: its answer to go on with ("Open
  // in the chat"), or the message of an action that opens the chat, sent at once (by the chat, once
  // that agent is chosen).
  const [queued, setQueued] = useState<QueuedMessage>();
  const own = useOwnAgent();
  useHandoff(CHAT_HANDOFF, isConversationPayload, { waitMs: HANDOFF_MS, idle: !agent.busy && !agent.compacting, tag: 'chat-handoff' }, ({ at, payload: h }) => {
    if (h.conversationId) temporary.off(); // moved back from the floating chat: a saved one
    if (h.conversationId) forgetRevision(h.conversationId); // its revision unknown here (history/store `checked`)
    // Floating, it leaves the pinned one, if shown: with the settings' agent (useFloatingConversation), the action's set there.
    own.setOwnAgent(null);
    openWithAgent(agent, { id: h.conversationId ?? crypto.randomUUID(), history: h.messages, agentId: h.agentId }, own.outer.settings, own.outer.update);
    if (h.send) setQueued({ at, text: h.send, shown: h.shown, agentId: h.agentId });
  });
  // A saved conversation, to go on with it, with the agent it was with.
  const openConversation = (conv: Conversation) => {
    temporary.off(); // a saved one goes on saved
    noteRevision(conv); // as loaded: a later save checked against it goes over it only (history/store `checked`)
    openWithAgent(agent, conv, settings, update);
  };
  const openSaved = (id: string) =>
    void heldConversations().then(async (held) => {
      if (heldElsewhere(held, id, agent.conversationId)) return; // open in another chat: it goes on there
      const conv = await loadConversation(id);
      if (conv) openConversation(conv);
    });
  // In the Agents Panel, the saved conversation its row goes on with, with the row's agent.
  useManagerConversation((conv) => {
    temporary.off();
    noteRevision(conv);
    agent.open(conv.id, conv.history);
  });
  // Why none opens now, if so: as "New", not while a turn runs (opening would stop it).
  const openOff: OpenOff | undefined = agent.compacting ? 'compacting' : agent.busy ? 'busy' : undefined;
  return (
    <div className="chat-area">
      {props.topbar.watches && createPortal(<WatchesMenu currentId={agent.conversationId} onOpen={openSaved} openOff={openOff} />, props.topbar.watches)}
      {saving && props.topbar.temporary && createPortal(<TemporaryButton agent={agent} temporary={temporary} />, props.topbar.temporary)}
      {props.topbar.move && floatingChatAvailable() && createPortal(<MoveButton agent={agent} agentId={settings.activeAgentId} tabId={page.tabId} windowId={page.windowId} temporary={temporary.on} />, props.topbar.move)}
      {props.topbar.pin && createPortal(<PinButton agent={agent} agentId={settings.activeAgentId} page={page} temporary={temporary.on} />, props.topbar.pin)}
      {saving && temporary.on && <div className="temporary-note" role="status">Temporary conversation: it is not saved in the history.</div>}
      {tabGone && <div className="temporary-note" role="status">The tab this chat worked on was closed: now on {page.title || page.url || 'no tab'}.</div>}
      {siteAgent && <div className="temporary-note" role="status">Switched to {agentLabel(siteAgent)} (this site's agent).</div>}
      {waiting && <div className="temporary-note" role="status">Moved: open the side panel to go on with it.</div>}
      {floating.keptApart && <div className="temporary-note error-text" role="alert">{floating.keptApart}</div>}
      {floating.elsewhere && (
        <div className="temporary-note" role="status">
          {ANSWERING_ELSEWHERE}{floating.elsewhere.title ? ` (${floating.elsewhere.title})` : ''}: this chat shows that turn once it ends.{' '}
          {floating.elsewhere.tabId !== NO_TAB && <button className="link-button" onClick={floating.showElsewhere}>Show that tab</button>}
        </div>
      )}
      {moveFailed && <div className="temporary-note error-text" role="alert">{moveFailed}</div>}
      {unsaved && <div className="temporary-note error-text" role="alert">{unsaved}</div>}
      <Chat agent={agent} page={page} queued={queued} runGate={FLOATING ? runGate : undefined} onOpenMemory={props.onOpenMemory} topbar={props.topbar.record} autoInjectTo={props.topbar.autoInject} voice={CHROME.voice} />
      {props.overlay === 'bookmarks' && <BookmarksPanel page={page} onClose={props.onCloseOverlay} />}
      {props.overlay === 'memory' && <MemoryPanel agentId={settings.activeAgentId} url={page.url} onClose={props.onCloseOverlay} />}
      {props.overlay === 'history' && (
        <HistoryPanel currentId={agent.conversationId} openOff={openOff} onClose={props.onCloseOverlay}
          onOpen={(conv) => {
            openConversation(conv);
            props.onCloseOverlay();
          }} />
      )}
    </div>
  );
}

// The hourglass: temporary conversations on or off, each time starting a new one (between turns).
function TemporaryButton({ agent, temporary }: { agent: Agent; temporary: Temporary }) {
  const title = temporary.on
    ? 'Temporary conversation: not saved in the history. Click to turn it off (starts a new conversation)'
    : 'Temporary conversation: not saved in the history (starts a new one)';
  return (
    <button className="icon-button" disabled={agent.busy || agent.compacting} onClick={temporary.toggle} title={title} aria-label="Temporary conversation" aria-pressed={temporary.on}>
      <Icon name="temporary" size={16} />
    </button>
  );
}

const NOTE_MS = 5000; // how long the button's note stays

// A note shown a moment, then `hide`.
function useNoteFor(shown: boolean, hide: () => void) {
  const hideNow = useStableCallback(hide);
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(hideNow, NOTE_MS);
    return () => clearTimeout(t);
  }, [shown, hideNow]);
}

const TEMPORARY_STAYS = 'A temporary conversation stays here: the other chat would save it';

// The chat's pin (core/side-panel), between turns. On: this is the window's side panel, which follows
// you from tab to tab and keeps working on its conversation's tab. Off: each tab has its own. Either
// way the conversation moves to the panel of the other mode, on the tab it works on.
function PinButton({ agent, agentId, page, temporary }: { agent: Agent; agentId?: string; page: PageTarget; temporary: boolean }) {
  const { settings, update } = useSettingsContext();
  const perTab = usePanelsPerTab();
  // Where tabs have no panel of their own, the pin stays on (left off by a build that offered it there).
  const off = !panelFollowsOn(settings);
  const [note, setNote] = useState(''); // why the conversation could not move
  useNoteFor(!!note, () => setNote(''));
  useEffect(() => {
    if (perTab === false && off) update({ panelFollows: true });
  }, [perTab, off, update]);
  const on = WINDOW_PANEL;
  const tab = page.tabId !== undefined && page.windowId !== undefined ? { id: page.tabId, windowId: page.windowId } : undefined;
  const stays = temporary && agent.history.length > 0;
  const title = stays ? TEMPORARY_STAYS : on ? 'Follow me across tabs (keeps working on its tab)' : 'Stay on this tab';
  if (!perTab) return null;
  const toggle = () => tab && void movePanel(agent, agentId, tab, !on, update).then((error) => error && setNote(error));
  return (
    <>
      {note && <span className="topbar-note error-text" role="alert">{note}</span>}
      <button className="icon-button" disabled={agent.busy || agent.compacting || stays || !tab} onClick={toggle} title={title} aria-label="Follow me across tabs" aria-pressed={on}>
        <Icon name="pin" size={16} />
      </button>
    </>
  );
}

// Whether this browser gives each tab its own side panel (core/side-panel), once known.
function usePanelsPerTab(): boolean | undefined {
  const [perTab, setPerTab] = useState<boolean>();
  useEffect(() => {
    panelsPerTab().then(setPerTab, (e: unknown) => console.error('[side panel]', e));
  }, []);
  return perTab;
}

// The conversation moved from the side panel to the chat floating on its page (floating.ts), between
// turns, only where the page widget is (never where the chat cannot float: core/build floatingChat); the panel then closes (where it cannot, it starts anew). Says
// so a moment. A temporary one stays: the other chat would save it. Back to the side panel from the
// floating chat's own bar (widget/ui/floating-chat).
function MoveButton({ agent, agentId, tabId, windowId, temporary }: { agent: Agent; agentId?: string; tabId?: number; windowId?: number; temporary: boolean }) {
  const [note, setNote] = useState('');
  useNoteFor(!!note, () => setNote(''));
  const move = async () => {
    const said = await floatOnPage(agent, agentId, tabId, windowId);
    if (said) setNote(said);
  };
  return (
    <>
      {note && <span className="topbar-note" role="status">{note}</span>}
      <button className="icon-button" disabled={agent.busy || agent.compacting || temporary} onClick={() => void move()} title={temporary ? TEMPORARY_STAYS : 'Float on this page (where the page widget is)'} aria-label="Float on this page"><Icon name="float" size={16} /></button>
    </>
  );
}

// In the agent manager, and full-screen in a tab, the chat's agent and model are its own (manager-chat);
// floating on a page, its agent while it shows the pinned conversation (floating-agent).
const ChatScope = ({ children }: { children: ReactNode }) =>
  MANAGER || FULL ? <ManagerScope>{children}</ManagerScope> : FLOATING ? <FloatingScope>{children}</FloatingScope> : children;

const PREVIEW_PAGE: PageTarget = { url: SAMPLE_PAGE.url, title: SAMPLE_PAGE.title, access: 'ok', grant: async () => {} };

function PreviewChat() {
  const { history, lastUsage } = useSampleChat(useSettingsContext().settings);
  const agent = useMemo(() => previewAgent(history, { last: lastUsage, calls: 3, input: 0, output: 0 }), [history, lastUsage]);
  return <Chat agent={agent} page={PREVIEW_PAGE} />;
}

export function App() {
  const [settings, update, settingsError, save] = useSettings();
  const [overlay, setOverlay] = useState<Overlay>();
  const toggle = (o: Overlay) => setOverlay((now) => (now === o ? undefined : o));
  // The same ones on every render: the chat's actions keep them (memoized).
  const openMemory = useCallback(() => setOverlay('memory'), []);
  const closeOverlay = useCallback(() => setOverlay(undefined), []);
  // Where the chat puts its own buttons (stable callbacks: a new one each render would set them again).
  const [topbar, setTopbar] = useState<TopbarSlots>({});
  const slot = useMemo(() => {
    const set = (name: keyof TopbarSlots) => (el: HTMLElement | null) => setTopbar((s) => (s[name] === el ? s : { ...s, [name]: el }));
    return { pin: set('pin'), record: set('record'), temporary: set('temporary'), move: set('move'), watches: set('watches'), autoInject: set('autoInject') };
  }, []);
  useAppearance(settings?.appearance);
  usePanelPresence(); // whether it shows, where opening it again would close it
  const panelSettings = useMemo(() => settings && { settings, update, save }, [settings, update, save]);
  // What the chat shows (Settings → Display), the same object while it does not change: the settings
  // come anew on every change to any of them, and the chat's views would render again.
  const displayKey = JSON.stringify(displayValues(settings ?? {}));
  const display = useMemo(() => JSON.parse(displayKey) as DisplayValues, [displayKey]);
  if (!settings || !panelSettings) return settingsError ? <div className="msg error" role="alert">{settingsError}</div> : null;
  const app = (
    <div className={FULL ? 'app full' : MANAGER ? 'app in-manager' : 'app'}>
      {/* Settings stays; narrower, the others go behind ⋯ from the right. */}
      <OverflowBar className="topbar" label="top bar" hideFrom="end"
        lead={CHROME.lead ? (
          <>
            <span className="topbar-slot topbar-pin" ref={slot.pin} />
            {CHROME.agents && (
              <>
                <button className="icon-button" onClick={() => void openManager()} title="Agents Panel" aria-label="Agents Panel">
                  <Icon name="agents" size={16} />
                </button>
                <button className="icon-button" onClick={() => void openFullChat()} title="Open the chat in a tab, full screen" aria-label="Open in a tab">
                  <Icon name="fullChat" size={16} />
                </button>
              </>
            )}
            <strong>Teseo</strong>
          </>
        ) : undefined/* floating, the widget's bar says it; in the agent manager, its page; in a tab, the tab */}
        tail={
          <button className="icon-button" onClick={() => void openOptions()} title="Settings" aria-label="Settings">
            <Icon name="settings" size={16} />
          </button>
        }
        items={[
          ...(CHROME.watches ? [{ key: 'watches', push: true, node: <span className="topbar-slot" ref={slot.watches} /> }] : []),
          { key: 'text-size', push: !CHROME.watches, node: <TextSizeMenu settings={settings} onChange={update} /> },
          { key: 'record', node: <span className="topbar-slot" ref={slot.record} /> },
          { key: 'temporary', node: <span className="topbar-slot" ref={slot.temporary} /> },
          ...(CHROME.move ? [{ key: 'move', node: <span className="topbar-slot" ref={slot.move} /> }] : []),
          // The panels over the chat (memory, history, bookmarks) in one framed group, joined to what goes
          // with each message on its own (the chat's auto-inject menu, put there by the chat).
          ...(!PREVIEW ? [{ key: 'context-group', node: (
            <span className="topbar-group" role="group" aria-label="Memory, history and bookmarks">
              <span className="topbar-group-buttons">
                {memoryOn(settings) && (
                  <button className="icon-button" onClick={() => toggle('memory')} title="Memory: what the model keeps across conversations" aria-label="Memory" aria-pressed={overlay === 'memory'}>
                    <Icon name="memory" size={16} />
                  </button>
                )}
                {CHROME.history && historyOn(settings) && (
                  <button className="icon-button" onClick={() => toggle('history')} title="Conversation history" aria-label="Conversation history" aria-pressed={overlay === 'history'}>
                    <Icon name="history" size={16} />
                  </button>
                )}
                <button className="icon-button" onClick={() => toggle('bookmarks')} title="Bookmarks" aria-label="Bookmarks" aria-pressed={overlay === 'bookmarks'}>
                  <Icon name="bookmark" size={16} />
                </button>
              </span>
              <span className="topbar-slot topbar-group-tail" ref={slot.autoInject} />
            </span>
          ) }] : []),
        ]}
      />
      {settingsError && <div className="msg error" role="alert">{settingsError}</div>}
      <ChatViewContext.Provider value={settings.chatView ?? NO_CHAT_VIEW}>
        <DisplayContext.Provider value={display}>
          {PREVIEW ? (
            <PreviewChat />
          ) : (
            <ChatScope>
              <LiveChat overlay={overlay} onCloseOverlay={closeOverlay} onOpenMemory={openMemory} topbar={topbar} />
            </ChatScope>
          )}
        </DisplayContext.Provider>
      </ChatViewContext.Provider>
    </div>
  );
  return <SettingsContext.Provider value={panelSettings}>{app}</SettingsContext.Provider>;
}
