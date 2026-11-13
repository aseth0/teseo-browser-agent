// sidepanel.html?floating: the chat floating on a page, in the page widget's iframe (its "Open the
// chat here"). Its page is the tab it floats in, as the browser says (tabs.getCurrent), never what
// its URL says.
import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { onRuntime, sendRuntime, sendTab } from '../../core/runtime';
import { isExtensionPage } from '../../core/sender';
import { conversationKey, keepApart, keptHistory, knownRevision, loadConversation, noteRevision, savedSince, type Conversation } from '../../history/store';
import { heldConversations } from '../../history/held';
import { watchKey } from '../../storage/watch';
import { storageGet } from '../../storage/area';
import { serialized } from '../../storage/serial';
import { agentStore } from '../../agents/profiles';
import { hostOf } from '../../core/util';
import { chooseConversation, runningElsewhere, showsSaved, stickyAgentId, type FloatingChoice } from './sticky';
import { useOwnAgent } from './floating-agent';
import type { StaleSave } from './useHistory';
import { handoff, type HandoffTo } from '../../core/handoff';
import { ANSWERING_ELSEWHERE, CHAT_HANDOFF, FLOATING_PREFIX, FLOATING_TO_PANEL, NO_TAB, RUNNING_CHATS, STICKY_CHAT, STICKY_UNPIN, WIDGET_CHAT_STATE, type ConversationPayload, type ChatState, type FloatingChat } from '../../widget/protocol';
import { FLOATING, floatingTab, knownFloatingTab } from '../../ui/floating-frame';
import { floatOnTab } from '../../widget/float';
import { openWithAgent, type Agent } from './useAgent';
import type { SettingsUpdate } from '../../ui/useSettings';
import { useStableCallback } from '../../ui/useStableCallback';
import { closeSidePanel, openSidePanel } from '../../core/side-panel';
import { errorText } from '../../core/errors';
import { OPEN_WINDOW_PANEL } from '../../core/protocol';

// A conversation moves between the side panel and the chat floating on a page, so that it is never
// live in both (the pinned one, shown by the chat floating on several tabs, is unpinned as it goes): it goes as a handoff (CHAT_HANDOFF, its id and messages, for the chat floating on that
// tab, the tab's side panel or the window's), and the chat it leaves closes (or starts anew). Between
// turns only. Written at once, before anything awaited: a tab's side panel closes soon after.
// Its messages as the history keeps them (history/store keptHistory: no screenshots, no image data):
// storage.session holds 10 MB in all, which unlimitedStorage does not lift. One still too large throws
// at once, before anything is written or switched; a write the browser refuses rejects.
export const HANDOFF_MAX_BYTES = 8 * 1024 * 1024;
export const HANDOFF_TOO_LARGE = 'This conversation is too large to move: go on with it here.';
const handOff = (agent: Pick<Agent, 'history' | 'conversationId'>, agentId: string | undefined, to: HandoffTo = {}) => {
  const payload = handoff<ConversationPayload>({ kind: 'conversation', messages: keptHistory(agent.history), conversationId: agent.conversationId, ...(agentId && { agentId }) }, to);
  if (new TextEncoder().encode(JSON.stringify(payload)).length > HANDOFF_MAX_BYTES) throw new Error(HANDOFF_TOO_LARGE);
  return browser.storage.session.set({ [CHAT_HANDOFF]: payload });
};
// What the chat says when its conversation could not move: too large, or a write the browser refused.
export const moveError = (e: unknown) => (e instanceof Error && e.message === HANDOFF_TOO_LARGE ? HANDOFF_TOO_LARGE : `Could not move it: ${errorText(e)}`);

// From the floating chat, asked by the background once "Open in the side panel" on the widget's bar
// opened the side panel (background/float-to-panel), or could not: its conversation goes to it, between
// turns only (`movable`). Opened, the widget closes this chat; not, the conversation waits for the
// panel and this chat goes on with a new one. One that could not be handed (too large, or refused)
// stays here, as it is, and `error` says why.
export async function moveToPanel(agent: Pick<Agent, 'history' | 'conversationId' | 'reset'>, agentId: string | undefined, req: { to: HandoffTo; opened: boolean }, movable: boolean): Promise<{ moved: boolean; error?: string }> {
  if (!movable) return { moved: false };
  try {
    await handOff(agent, agentId, req.to);
  } catch (e) {
    console.error('[floating]', e);
    return { moved: false, error: moveError(e) };
  }
  // Live in the side panel now: no longer pinned (only if it still is), each tab back to its own.
  unpin(agent.conversationId);
  if (!req.opened) agent.reset();
  return { moved: true };
}

// The background's asks (FLOATING_TO_PANEL) for the tab it floats on. `onWaiting`: the conversation
// went to wait for a side panel the browser did not open; `onFailed`: it could not be handed, and why. `movable` is a parameter, not a condition at
// the call site: a hook cannot be called conditionally, and the background is answered either way.
export function useMoveToPanel(agent: Agent, agentId: string | undefined, movable: boolean, onWaiting: () => void, onFailed: (error: string) => void): void {
  const move = useStableCallback(async (req: { to: HandoffTo; opened: boolean }) => {
    const { moved, error } = await moveToPanel(agent, agentId, req, movable);
    if (moved && !req.opened) onWaiting();
    if (error) onFailed(error);
    return { moved };
  });
  useEffect(() => {
    if (!FLOATING) return;
    return onRuntime(FLOATING_TO_PANEL, (msg, sender) => (isExtensionPage(sender) && msg.tab === knownFloatingTab()?.id ? move(msg) : undefined));
  }, [move]);
}

// The side panel's "Float on this page": the conversation goes to its page's widget and this chat
// starts anew; what to say, if anything. One that could not be handed stays here, as it is.
export async function floatOnPage(agent: Agent, agentId: string | undefined, tabId: number | undefined, windowId: number | undefined): Promise<string | undefined> {
  try {
    if (tabId === undefined || !(await moveToPage(agent, agentId, tabId))) return 'No page widget on this page';
  } catch (e) {
    console.error('[side panel]', e);
    return moveError(e);
  }
  agent.reset();
  if (windowId === undefined || !(await closeSidePanel(windowId))) return 'Moved: it goes on floating on its page';
  return undefined;
}

// From the side panel, to the tab it works on: whether that page has the widget to float it in. One
// that could not be handed (too large, or refused) throws, nothing of it left written.
export async function moveToPage(agent: Agent, agentId: string | undefined, tabId: number): Promise<boolean> {
  const key = FLOATING_PREFIX + tabId;
  try {
    await browser.storage.session.set({ [key]: (agent.history.length ? { conversationId: agent.conversationId } : {}) satisfies FloatingChat });
    await handOff(agent, agentId, { tab: tabId });
  } catch (e) {
    await browser.storage.session.remove([key, CHAT_HANDOFF]).catch(() => undefined);
    throw e;
  }
  if (await floatOnTab(tabId)) return true; // the bubble shown again where it was hidden on the site
  await browser.storage.session.remove([key, CHAT_HANDOFF]);
  return false;
}

// The chat's pin, from the side panel, inside the click: the conversation goes to the panel of the
// other mode (core/side-panel), opened now; this one closes once the background turns its mode off.
// On: the window's panel, on the tab it worked on. Off: that tab's own panel, the tab shown. Between
// turns only. Resolves with what went wrong, if anything: a conversation too large to move is told
// before anything switches (the pin stays as it was); a write the browser refuses is known only once
// switched (awaiting it first would lose the click's gesture, which opening the panel needs).
export async function movePanel(agent: Agent, agentId: string | undefined, tab: { id: number; windowId: number }, follows: boolean, update: SettingsUpdate): Promise<string | undefined> {
  try {
    const handing = agent.history.length ? handOff(agent, agentId, follows ? {} : { panelTab: tab.id }) : undefined;
    update({ panelFollows: follows });
    const opened = follows ? sendRuntime({ type: OPEN_WINDOW_PANEL, tabId: tab.id, windowId: tab.windowId }) : openSidePanel(tab, false);
    if (!follows) await browser.tabs.update(tab.id, { active: true }); // where its panel shows
    await Promise.all([handing, opened]);
    return undefined;
  } catch (e) {
    console.error('[side panel]', e);
    return moveError(e);
  }
}

// The conversation it shows: its tab's own, kept for it (storage.session, FLOATING_PREFIX), so that it
// goes on when the page reloads or moves on and the widget opens it again (the first time, a new one);
// or, while one is pinned (STICKY_CHAT, the bar's pin), that one, on every tab but in incognito windows,
// with its own agent: the site's (floating-agent). Pinned or unpinned meanwhile, it changes to it
// between turns; its own is not overwritten by the pinned one, so unpinning brings it back. Leaving the
// pinned one here (New, the history, a handoff) leaves the pin on for the other tabs: here the pin
// shows off, and the conversation now shown is this tab's own.
// Several chats show the pinned conversation, one runs a turn at a time: before a run (`claim`) it
// takes the conversation's run lock and checks it shows the conversation as saved; a turn running in
// another chat (RUNNING_CHATS) makes it wait (`elsewhere`), and once that turn ended, its tab shown, it
// shows the conversation as saved. Its saves are checked (history/store `checked`): one refused
// (`onStale`) shows the saved one instead. `onOpenSaved`: a saved conversation was opened here.
export interface FloatingConversation {
  sticky: boolean; // it shows the pinned conversation
  stickable: boolean; // the pin can follow this chat (not in an incognito window)
  elsewhere?: { tabId: number; title?: string }; // the chat that runs a turn of it now
  autoOff: boolean; // nothing goes on its own (a met tab watch): pinned, its tab hidden or it runs elsewhere
  claim: () => Promise<string | undefined>; // before a run: why it cannot go now, if so
  unclaim: () => void; // the run claimed did not start
  onStale: (conv: StaleSave) => void;
  keptApart?: string; // a turn kept apart, as its save was refused: said in the chat
  showElsewhere: () => void; // the tab that runs it, shown
}
const RUN_LOCK = 'browser-agent:run:';
export const CHANGED_ELSEWHERE = 'Not sent: this conversation changed in another tab. It shows now as it is there.';
const KEPT_APART = 'This turn could not be saved over what another tab saved meanwhile: it is kept apart, as a conversation of its own in the history.';
const NOT_KEPT = 'This turn could not be saved over what another tab saved meanwhile, nor kept apart';
export const NOT_SENT_ELSEWHERE = `Not sent: ${ANSWERING_ELSEWHERE.charAt(0).toLowerCase()}${ANSWERING_ELSEWHERE.slice(1)}.`;

// `unsaved`: what it shows is not saved in the history (a temporary conversation, or the history off):
// a pin made elsewhere leaves it as it is, until the user leaves it.
export function useFloatingConversation(agent: Agent, onOpenSaved: () => void, unsaved: boolean): FloatingConversation {
  const { setOwnAgent, outer } = useOwnAgent();
  // Its tab, once known: kept as state, so the conversation said before it was known is kept for it then.
  const [tab, setTab] = useState<{ id: number; incognito: boolean }>();
  const [stickyId, setStickyId] = useState<string>();
  const running = useRef<unknown>(undefined);
  const [elsewhereTab, setElsewhereTab] = useState<number>();
  const [elsewhereTitle, setElsewhereTitle] = useState<string>();
  const [hidden, setHidden] = useState(() => document.hidden);
  const pendingPin = useRef(false); // the pin changed during a turn: followed once it ends
  const refused = useRef<StaleSave | undefined>(undefined); // the last save refused: kept apart, the saved one shown, once the turn ends
  const [keptApart, setKeptApart] = useState<string>();
  const apartId = useRef<string | undefined>(undefined); // one copy per turn: a refusal mid-turn, then at its end, under one id
  const firstId = useRef(agent.conversationId); // the conversation it opened with: another one is a handoff's
  const release = useRef<(() => void) | undefined>(undefined); // the run lock, while held
  const letGoRun = () => {
    release.current?.();
    release.current = undefined;
  };
  const shownSticky = !!stickyId && agent.conversationId === stickyId;
  const idle = !agent.busy && !agent.compacting;
  const tabId = tab?.id;

  // What it shows, as chosen (sticky chooseConversation). `opening`: only into a chat still empty (a
  // handoff may have come first). With its own agent for a pinned one, else the settings'.
  const show = useStableCallback(async (choice: FloatingChoice, opening: boolean) => {
    if (choice.unpin) unpin(choice.unpin);
    if (choice.dropOwn && tabId !== undefined) void browser.storage.session.remove(FLOATING_PREFIX + tabId).catch(() => undefined);
    // Opening: only into the chat as it opened (a handoff may have come first, its message still to send).
    const stays = () => agent.busy || agent.compacting || (opening && (agent.history.length > 0 || agent.conversationId !== firstId.current));
    if (stays()) return;
    if (!opening && choice.sticky && unsaved && agent.history.length > 0 && choice.id !== agent.conversationId) return; // never saved: it would be gone
    if (!choice.sticky) setOwnAgent(null);
    if (!choice.id) return void (agent.history.length && agent.reset());
    if (!choice.conv) return void (choice.id !== agent.conversationId && agent.open(choice.id, [])); // its first turn not saved yet
    const conv = choice.conv;
    if (choice.sticky) {
      const agentId = await siteAgentFor(conv.agentId);
      if (stays()) return;
      setOwnAgent(agentId);
    }
    noteRevision(conv);
    if (conv.id === agent.conversationId) return; // shown already (pinned here, or its own unpinned)
    onOpenSaved();
    // Its own on opening, with its agent (the settings', as before); unpinned, as it is: each tab writing
    // the settings' agent would leave it to the last one.
    if (opening && !choice.sticky) openWithAgent(agent, conv, outer.settings, outer.update);
    else agent.open(conv.id, conv.history);
  });
  // The pinned one and its own, read now; `opening`: the chat opens.
  const choose = useStableCallback(async (opening: boolean) => {
    const current = tab ?? (await floatingTab().then((t) => t && t.id !== undefined ? { id: t.id, incognito: t.incognito } : undefined));
    if (!current) return;
    const key = FLOATING_PREFIX + current.id;
    const got = await browser.storage.session.get([key, STICKY_CHAT]);
    const pinned = current.incognito ? undefined : got[STICKY_CHAT];
    const choice = await chooseConversation((got[key] as FloatingChat | undefined)?.conversationId, pinned, {
      load: savedNow, // after the saves asked for: never older than what this chat saved last
      heldBy: async (id) => (await heldConversations()).get(id),
      opening,
      shownId: agent.conversationId,
    });
    if (!tab) setTab(current);
    setStickyId(choice.sticky ? choice.id : undefined);
    await show(choice, opening);
  });
  const follow = useStableCallback(async () => {
    if (agent.busy || agent.compacting) return void (pendingPin.current = true);
    pendingPin.current = false;
    await choose(false);
  });
  const logged = (p: Promise<unknown>) => void p.catch((e: unknown) => console.error('[floating]', e));
  // Opened: the pinned one, else its own; then as the pin changes. A turn of a conversation running
  // elsewhere, as the background says; its tab shown or hidden.
  const onRunning = useStableCallback((value: unknown) => {
    running.current = value;
    setElsewhereTab(runningElsewhere(value, agent.conversationId, tabId));
  });
  useEffect(() => {
    if (!FLOATING) return;
    logged(choose(true));
    logged(storageGet<unknown>('session', RUNNING_CHATS).then(onRunning));
    const offRunning = watchKey('session', RUNNING_CHATS, ({ newValue }) => onRunning(newValue));
    const offPin = watchKey('session', STICKY_CHAT, () => logged(follow()));
    const onShown = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onShown);
    return () => {
      offRunning();
      offPin();
      document.removeEventListener('visibilitychange', onShown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on opening
  }, []);
  useEffect(() => onRunning(running.current), [agent.conversationId, tabId, onRunning]);
  useEffect(() => {
    if (elsewhereTab === undefined || elsewhereTab === NO_TAB) return setElsewhereTitle(undefined);
    let current = true;
    void browser.tabs.get(elsewhereTab).then((t) => current && setElsewhereTitle(t.title), () => undefined);
    return () => void (current = false);
  }, [elsewhereTab]);
  const elsewhere = elsewhereTab !== undefined;
  // Left the pinned one here: the settings' agent again.
  const wasSticky = useRef(shownSticky);
  useEffect(() => {
    if (wasSticky.current && !shownSticky) setOwnAgent(null);
    wasSticky.current = shownSticky;
  }, [shownSticky, setOwnAgent]);

  // The saved one shown in place of what it shows, when another chat saved it since (sticky showsSaved).
  const showSaved = useStableCallback((saved: Conversation | undefined) => {
    const id = agent.conversationId;
    if (!saved || saved.id !== id || !showsSaved({ shownId: id, stickyId, hidden: document.hidden, idle: !agent.busy && !agent.compacting, elsewhere, known: knownRevision(id), saved })) return;
    noteRevision(saved);
    agent.open(id, saved.history);
  });
  const reload = useStableCallback(async () => {
    if (!shownSticky) return;
    showSaved(await savedNow(agent.conversationId));
  });
  // Saved elsewhere (its value comes with the change: nothing read again); shown again; that turn ended.
  useEffect(() => {
    if (!FLOATING || !shownSticky) return;
    return watchKey('local', conversationKey(agent.conversationId), ({ newValue }) => showSaved(newValue as Conversation | undefined));
  }, [shownSticky, agent.conversationId, showSaved]);
  useEffect(() => {
    if (shownSticky && !hidden && !elsewhere) logged(reload());
  }, [shownSticky, hidden, elsewhere, reload]);
  // A turn ended: the run lock let go. Idle again (a turn, or a compaction, ended): the pin followed, the
  // saved one shown if a save was refused meanwhile.
  const wasBusy = useRef(agent.busy);
  useEffect(() => {
    if (wasBusy.current && !agent.busy) letGoRun();
    if (!wasBusy.current && agent.busy) apartId.current = undefined; // a new turn: kept apart anew, if so
    wasBusy.current = agent.busy;
  }, [agent.busy]); // letGoRun reads refs only
  // A save refused (another chat saved it since): once the turn ends, the turn is kept apart (a
  // conversation of its own in the history, said in the chat), and the saved one shown.
  const keepRefused = useStableCallback(() => {
    const conv = refused.current;
    refused.current = undefined;
    if (!conv) return;
    const id = (apartId.current ??= crypto.randomUUID());
    logged(keepApart(conv, id).then(async () => {
      setKeptApart(KEPT_APART);
      const saved = await savedNow(conv.id);
      if (!saved || agent.busy || agent.compacting || agent.conversationId !== conv.id) return;
      noteRevision(saved);
      agent.open(conv.id, saved.history);
    }, (e: unknown) => setKeptApart(`${NOT_KEPT}: ${errorText(e)}`))); // not kept: the turn stays on screen
  });
  const onStale = useStableCallback((conv: StaleSave) => {
    refused.current = conv; // the latest: the turn as it ended
    if (idle) keepRefused();
  });
  const whenIdle = useStableCallback(() => {
    if (pendingPin.current) logged(follow());
    if (refused.current) keepRefused();
  });
  useEffect(() => {
    if (FLOATING && idle) whenIdle();
  }, [idle, whenIdle]);
  // Before a run of the pinned one: its run lock (none while another chat runs it), and the
  // conversation as saved, read after the saves already asked for (another chat's last turn).
  const claim = useStableCallback(async (): Promise<string | undefined> => {
    if (!FLOATING || !shownSticky) return undefined;
    if (elsewhere) return NOT_SENT_ELSEWHERE;
    const id = agent.conversationId;
    // Its own lock, still held from the turn that just ended (a queued message goes at once): kept.
    const held = release.current;
    release.current = undefined;
    const letGo = held ?? (await takeRunLock(id));
    if (!letGo) return NOT_SENT_ELSEWHERE;
    const saved = await savedNow(id);
    if (savedSince(id, saved)) {
      letGo();
      if (saved) noteRevision(saved);
      if (saved && !agent.busy && agent.conversationId === id) agent.open(id, saved.history);
      return CHANGED_ELSEWHERE;
    }
    release.current = letGo;
    return undefined;
  });
  const unclaim = useStableCallback(() => {
    if (!agent.busy) letGoRun();
  });
  const showElsewhere = useStableCallback(() => {
    if (elsewhereTab === undefined || elsewhereTab === NO_TAB) return;
    logged(browser.tabs.update(elsewhereTab, { active: true }).then(async (t) => {
      if (t?.windowId !== undefined) await browser.windows.update(t.windowId, { focused: true });
    }));
  });

  // Its own, kept for its tab: not the pinned one shown instead.
  const said = agent.history.length > 0;
  useEffect(() => {
    if (!FLOATING || tabId === undefined || !said || shownSticky) return;
    void browser.storage.session.set({ [FLOATING_PREFIX + tabId]: { conversationId: agent.conversationId } satisfies FloatingChat }).catch(() => undefined);
  }, [agent.conversationId, said, tabId, shownSticky]);
  return {
    sticky: shownSticky,
    stickable: !!tab && !tab.incognito,
    ...(elsewhereTab !== undefined && { elsewhere: { tabId: elsewhereTab, ...(elsewhereTitle && { title: elsewhereTitle }) } }),
    autoOff: shownSticky && (hidden || elsewhere),
    ...(keptApart && { keptApart }),
    claim, unclaim, onStale, showElsewhere,
  };
}

// That conversation no longer pinned, if it still is (the background unpins it: STICKY_UNPIN).
const unpin = (conversationId: string) =>
  void Promise.resolve().then(() => sendRuntime({ type: STICKY_UNPIN, conversationId })).catch((e: unknown) => console.error('[floating]', e));

// The conversation as saved once the saves already asked for are done (history/store, one at a time).
const savedNow = (id: string) => serialized('history')(() => loadConversation(id));

// The run lock of a conversation, when free: how to let it go (held until then, or until the page goes).
function takeRunLock(id: string): Promise<(() => void) | undefined> {
  const locks = globalThis.navigator?.locks;
  if (!locks) return Promise.resolve(() => {});
  return new Promise((resolve) => {
    void locks.request(RUN_LOCK + id, { ifAvailable: true }, (lock) => {
      if (!lock) return resolve(undefined);
      return new Promise<void>((letGo) => resolve(() => letGo()));
    }).catch(() => resolve(undefined));
  });
}

// The agent of the site of the page this chat floats on now (it may have moved on), else `last`.
async function siteAgentFor(last: string | undefined): Promise<string | undefined> {
  const [tab, agents] = await Promise.all([browser.tabs.getCurrent(), agentStore.load()]);
  return stickyAgentId(agents, hostOf(tab?.url), last);
}

// What the chat is doing, told to its page's widget as it changes (also once it opens there again,
// after a reload), for the bubble to show it while the chat is folded; and whether its conversation can
// go to the side panel now, for the bar's button.
// `sticky`: it shows the pinned conversation; `stickable`: the one it shows can be pinned now.
export function useFloatingState(agent: Agent, movable: boolean, sticky: boolean, stickable: boolean): void {
  const state: ChatState = agent.confirmations.length ? 'waiting' : agent.busy ? 'working' : 'idle';
  useEffect(() => {
    if (!FLOATING) return;
    void floatingTab().then((tab) => (tab?.id === undefined ? undefined : sendTab(tab.id, { type: WIDGET_CHAT_STATE, state, movable, sticky, stickable }))).catch(() => undefined);
  }, [state, movable, sticky, stickable]);
}
