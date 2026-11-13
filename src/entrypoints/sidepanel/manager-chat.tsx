// A chat of the agent manager's page (sidepanel.html?tab=…&manager): its agent and model are its own,
// never the settings' (the side panel's, and every other chat's). The agent comes from its URL (chosen
// in the page) and changes with the chat's picker or "Make tool"; the model starts as the agent's (or
// the settings' when the agent has none) and changes with the chat's model picker. Each run carries
// them (useSendPipeline), as it carries the side panel's.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Settings } from '../../storage/settings';
import { activeTarget } from '../../storage/settings-select';
import type { Message, SentText } from '../../core/types';
import { DEFAULT_MAX_STEPS, limit } from '../../core/limits';
import { loadConversation, onConversationsChanged, titleOf, type Conversation } from '../../history/store';
import { useStableCallback } from '../../ui/useStableCallback';
import { agentLabel } from '../../agents/profiles';
import { lastAnswer } from '../../agents/ask';
import { browserAsAgent } from '../../agents/builtins';
import { FULL, MANAGER, MANAGER_AGENT, MANAGER_CONVERSATION } from '../../ui/floating-frame';
import { bestEffort } from '../../core/errors';
import { heldConversations } from '../../history/held';
import { MANAGER_SAY, MANAGER_STATUS, MANAGER_STOP, MANAGER_STOPPED, type ChatToManager, type ManagerStatus, type PanelMessage } from '../../manager/protocol';
import { useActiveAgent } from './AgentPicker';
import type { Agent } from './useAgent';
import type { PageTarget } from './usePageTarget';
import { SettingsContext, useSettingsContext, type SettingsValue } from '../../ui/settings-context';
import { applySettingsChange, type SettingsChange } from '../../ui/useSettings';

export interface OwnModel {
  providerId: string;
  model: string;
}

export interface ManagerChoice {
  agentId?: string; // none: Default
  model?: OwnModel; // none: the agent's, or the settings'
}

// The chat's model, when chosen in it, and how it chooses one (none outside the agent manager).
export const OwnModelContext = createContext<{ model?: OwnModel; pick: (providerId: string, model: string) => void } | null>(null);

// The chat's agent (none: Browser) and the provider and model it talks to: the agent's, or in the agent
// manager the chat's own once chosen. `talkedTo`: the agent as the history and the agent manager name it.
export function useChatTarget(settings: Settings) {
  const { agents, agent: profile } = useActiveAgent(settings);
  const own = useContext(OwnModelContext);
  const { provider, model } = activeTarget(settings, own?.model ?? profile);
  const talkedTo = { ...(profile && { id: profile.id }), name: agentLabel(profile ?? browserAsAgent(settings)) };
  return { agents, profile, own, provider, model, talkedTo };
}

// The settings as the chat sees them: with its own agent.
const overlaySettings = (s: Settings, choice: ManagerChoice): Settings => ({ ...s, activeAgentId: choice.agentId });

// A change the chat makes, split: its agent goes to the chat (another agent, the model of the one before
// with it), the rest to the settings, which keep their own agent. `global`: none when only the agent
// changed, or nothing.
export function splitChange(prev: Settings, choice: ManagerChoice, change: SettingsChange): { choice: ManagerChoice; global: Settings | undefined } {
  const seen = overlaySettings(prev, choice);
  const next = applySettingsChange(seen, change);
  const agentId = next.activeAgentId;
  const own: ManagerChoice = agentId === choice.agentId ? choice : { agentId };
  const unchanged = next === seen || (typeof change !== 'function' && Object.keys(change).every((k) => k === 'activeAgentId'));
  return { choice: own, global: unchanged ? undefined : { ...next, activeAgentId: prev.activeAgentId } };
}

// The settings as a chat with its own agent sees them (`choice`), and how it changes them: its agent (and
// model) go to `choose`, the rest to the settings. `latest`: the choice made last, also in this tick.
export function ownAgentSettings(outer: SettingsValue, choice: ManagerChoice, latest: { readonly current: ManagerChoice | null }, choose: (c: ManagerChoice) => void): SettingsValue {
  const { save: outerSave } = outer;
  const now = () => latest.current ?? choice;
  const save = (change: SettingsChange) => {
    if (typeof change !== 'function') {
      const { activeAgentId: _agent, ...rest } = change;
      const split = splitChange(outer.settings, now(), change);
      if (split.choice !== now()) choose(split.choice);
      return split.global ? outerSave(rest) : Promise.resolve();
    }
    // Applied on the latest settings (useSettings), at once: an unchanged result is not saved.
    return outerSave((prev) => {
      const split = splitChange(prev, now(), change);
      if (split.choice !== now()) choose(split.choice);
      return split.global ?? prev;
    });
  };
  return { settings: overlaySettings(outer.settings, choice), save, update: (change) => void save(change).catch(() => undefined) };
}

// Around the chat in the agent manager, or full-screen in a tab: the settings with its own agent, and its
// own model. In a tab, it starts with the settings' agent (the side panel's).
export function ManagerScope({ children }: { children: ReactNode }) {
  const outer = useSettingsContext();
  const [choice, setChoice] = useState<ManagerChoice>(() => ({ agentId: FULL ? outer.settings.activeAgentId : MANAGER_AGENT }));
  // The latest choice, also one made in this tick: the next change builds on it.
  const latest = useRef(choice);
  const choose = useCallback((next: ManagerChoice) => {
    latest.current = next;
    setChoice(next);
  }, []);
  const value = useMemo(() => ownAgentSettings(outer, choice, latest, choose), [outer, choice, choose]);
  const model = useMemo(() => ({ model: choice.model, pick: (providerId: string, model: string) => choose({ ...latest.current, model: { providerId, model } }) }), [choice.model, choose]);
  return (
    <SettingsContext.Provider value={value}>
      <OwnModelContext.Provider value={model}>{children}</OwnModelContext.Provider>
    </SettingsContext.Provider>
  );
}

// How far the turn is: the model request it is at (the answers since your last message, and the one
// coming while it runs), and the last tool it called.
export function turnProgress(history: Message[], busy: boolean): { step: number; lastTool?: string } {
  const turn = history.slice(history.findLastIndex((m) => m.role === 'user') + 1).filter((m) => m.role === 'assistant');
  const lastTool = turn.flatMap((m) => m.parts.flatMap((p) => (p.type === 'tool_call' ? [p.name] : []))).at(-1);
  return { step: Math.min(turn.length + (busy ? 1 : 0), DEFAULT_MAX_STEPS), ...(lastTool && { lastTool }) };
}

// What the chat tells its page.
export function managerStatus(
  chat: { conversationId: string; history: Message[]; busy: boolean; waiting: boolean; given: number },
  page: Pick<PageTarget, 'tabId' | 'url' | 'title'>,
  agent: { id?: string; name: string },
  model: string,
  turnStartedAt: number | undefined,
): ManagerStatus {
  return {
    state: chat.waiting ? 'waiting' : chat.busy ? 'working' : 'idle',
    said: chat.history.length > 0,
    conversationId: chat.conversationId,
    title: titleOf(chat.history),
    tabId: page.tabId,
    url: page.url,
    pageTitle: page.title,
    ...turnProgress(chat.history, chat.busy),
    maxSteps: DEFAULT_MAX_STEPS,
    turnStartedAt,
    agentId: agent.id,
    agentName: agent.name,
    model,
    given: chat.given,
    ...(!chat.busy && { answer: lastAnswer(chat.history) }),
  };
}

// In the agent manager, a row made to go on with a saved conversation (chatUrl's `conversation`): it
// opens once loaded, unless another chat has it open by then (history/held); then the chat starts anew.
export function useManagerConversation(open: (conv: Conversation) => void): void {
  const onLoaded = useStableCallback(open);
  useEffect(() => {
    const id = MANAGER_CONVERSATION;
    if (!MANAGER || !id) return;
    let current = true;
    void bestEffort(
      (async () => {
        try {
          if ((await heldConversations()).has(id)) return;
          const conv = await loadConversation(id);
          if (conv && current) onLoaded(conv);
        } finally {
          opened(); // what the page gives it may go now: into it, not a conversation of its own
        }
      })(),
      'manager-conversation',
    );
    return () => {
      current = false;
    };
  }, [onLoaded]);
}

// The messages the page gave this chat (MANAGER_SAY: an agent of the panel that started it, agents/panel),
// to send in order as soon as it can, and how many went (its status says it: the page knows from it
// when the chat has read them all). One chat per page: kept for the page. Notices (manager/notices) wake
// it at most Settings → Limits' times until the user writes again; past that, the next one waits for that.
// `opened`: the saved conversation it goes on with (MANAGER_CONVERSATION), if any, was opened (or could not be).
const given = { queue: [] as PanelMessage[], sent: 0, notices: 0, opened: false, version: 0, listeners: new Set<() => void>() };
const changed = () => {
  given.version++;
  for (const l of given.listeners) l();
};
const subscribe = (l: () => void) => {
  given.listeners.add(l);
  return () => given.listeners.delete(l);
};
if (MANAGER)
  window.addEventListener('message', (e) => {
    const data = e.data as { type?: unknown; text?: unknown; shown?: unknown; notice?: unknown } | undefined;
    if (e.origin !== location.origin || e.source !== window.parent || data?.type !== MANAGER_SAY || typeof data.text !== 'string' || typeof data.shown !== 'string') return;
    given.queue.push({ text: data.text, shown: data.shown, ...(data.notice === true && { notice: true }) });
    changed();
  });

const useGiven = () => useSyncExternalStore(subscribe, () => given.sent);

function opened(): void {
  given.opened = true;
  changed();
}

// The user sent a message of their own: notices may wake the chat again.
export function userSpoke(): void {
  if (!given.notices) return;
  given.notices = 0;
  changed();
}

// Sends the next message given, once `ready` (no turn runs, nor compaction); `send` says whether it went.
// A notice goes marked (Part from): the chat draws it as a line, and it does not count as the user writing.
export function useManagerSays(ready: boolean, send: (message: SentText) => boolean | undefined): void {
  const version = useSyncExternalStore(subscribe, () => given.version);
  useEffect(() => {
    const next = given.queue[0];
    if (!ready || next === undefined || (MANAGER_CONVERSATION && !given.opened) || (next.notice && given.notices >= limit('panelNotices'))) return;
    if (!send({ text: next.text, shown: next.shown, ...(next.notice && { from: 'panel' as const }) })) return;
    given.queue.shift();
    given.sent++;
    if (next.notice) given.notices++;
    changed();
  }, [ready, version, send]);
}

const SAVE_WAIT_MS = 2000; // how long a chat asked to stop waits for its turn to be saved

const toPage = (message: ChatToManager) => window.parent.postMessage(message, location.origin);

// In the agent manager: tells the page what the chat is doing as it changes, and stops its run when
// the page asks (before removing it). Nothing elsewhere.
export function useManagerStatus(agent: Agent, page: PageTarget): void {
  const { settings } = useSettingsContext();
  const { model, talkedTo } = useChatTarget(settings);
  // When the run started, set as it starts (not while rendering).
  const [startedAt, setStartedAt] = useState<number>();
  useEffect(() => setStartedAt(agent.busy ? Date.now() : undefined), [agent.busy]);
  const status = managerStatus(
    { conversationId: agent.conversationId, history: agent.history, busy: agent.busy, waiting: agent.confirmations.length > 0, given: useGiven() },
    page,
    talkedTo,
    model,
    startedAt,
  );
  const said = JSON.stringify(status);
  useEffect(() => {
    if (MANAGER) toPage({ type: MANAGER_STATUS, status: JSON.parse(said) as ManagerStatus });
  }, [said]);
  const { busy, stop } = agent;
  // Asked to stop while a turn ran: said once that turn is saved (useHistory saves it when it ends), or
  // after a while (not saved: history off, temporary): the page then removes the chat.
  const [stopping, setStopping] = useState(false);
  useEffect(() => {
    if (!MANAGER) return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== window.parent || (e.data as { type?: unknown })?.type !== MANAGER_STOP) return;
      if (!busy) return toPage({ type: MANAGER_STOPPED });
      stop();
      setStopping(true);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [busy, stop]);
  useEffect(() => {
    if (!stopping || busy) return;
    const done = () => {
      clearTimeout(t);
      off();
      toPage({ type: MANAGER_STOPPED });
    };
    const off = onConversationsChanged(done);
    const t = setTimeout(done, SAVE_WAIT_MS);
    return () => {
      clearTimeout(t);
      off();
    };
  }, [stopping, busy]);
}
