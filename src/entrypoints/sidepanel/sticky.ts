// The pinned conversation of the chat floating on pages (widget/protocol STICKY_CHAT): while one is
// pinned, the chat floating on every tab shows it instead of its own; one tab runs a turn at a time,
// the others wait, and each shows the turns run elsewhere once its tab is shown again. What each
// floating chat decides, apart from React (sidepanel/floating useFloatingConversation).
import { agentOfSite, type AgentProfile } from '../../agents/profiles';
import type { Conversation } from '../../history/store';
import type { Holder } from '../../history/held';
import { isStickyChat, type RunningChats } from '../../widget/protocol';

// What the chat floating on a tab shows: the pinned conversation (`sticky`), else its own (none: a new
// one). A pinned one no longer in the history (deleted, or the history cleared), or open in a chat that
// is not floating on a page (the side panel, a tab, the Agents Panel), is to be unpinned (`unpin`), and
// the tab's own shown instead. Its own no longer in the history, once the chat is open (`dropOwn`): a
// new one instead, and the tab's key forgotten; on opening, its first turn may still run away from
// it (the page reloaded), and it is opened by its id. Its own shown already stays as it is.
export interface FloatingChoice {
  id?: string;
  conv?: Conversation; // saved: go on with it; none: a new one, or one whose first turn is not saved yet
  sticky: boolean;
  unpin?: string; // the pinned conversation to unpin
  dropOwn?: true;
}

export interface ChoiceSources {
  load: (id: string) => Promise<Conversation | undefined>;
  heldBy: (id: string) => Promise<Holder | undefined>; // the chat that holds it, first the Agents Panel, then a chat not floating
  opening: boolean; // the chat opens now (else the pin changed while it is open)
  shownId?: string; // the conversation the chat shows now
}

export async function chooseConversation(own: string | undefined, pinned: unknown, { load, heldBy, opening, shownId }: ChoiceSources): Promise<FloatingChoice> {
  let unpin: string | undefined;
  if (isStickyChat(pinned)) {
    const id = pinned.conversationId;
    const holder = await heldBy(id);
    const conv = holder === 'manager' || holder === 'chat' ? undefined : await load(id);
    if (conv) return { id, conv, sticky: true };
    unpin = id;
  }
  const away = unpin && { unpin };
  if (!own || own === unpin) return { sticky: false, ...away, ...(own && { dropOwn: true as const }) };
  // Its own shown already (one not saved: a temporary one, or its first turn): kept as it is. One
  // deleted is no longer shown (the chat started a new one: useHistory).
  if (!opening && own === shownId) return { id: own, sticky: false, ...away };
  const conv = await load(own);
  if (!conv && !opening) return { sticky: false, ...away, dropOwn: true };
  return { id: own, conv, sticky: false, ...away };
}

// The pinned conversation's id, as read from storage.session (anything else: none).
export const stickyIdOf = (v: unknown): string | undefined => (isStickyChat(v) ? v.conversationId : undefined);

// The tab whose chat runs that conversation now, when it is not this chat (the chat floating on
// `tabId`): this chat waits for it, and does not send. NO_TAB: a chat with no tab of its own.
export function runningElsewhere(running: unknown, conversationId: string, tabId: number | undefined): number | undefined {
  if (!running || typeof running !== 'object') return undefined;
  const where = (running as RunningChats)[conversationId];
  return typeof where === 'number' && where !== tabId ? where : undefined;
}

// The agent the pinned conversation goes on with on a page: that site's (the first agent switched on
// that has it), else the one it last talked to (none: Browser).
export const stickyAgentId = (agents: AgentProfile[], host: string, lastAgentId: string | undefined): string | undefined =>
  (host ? agentOfSite(agents, host)?.id : undefined) ?? lastAgentId;

// Whether the chat shows the pinned conversation as saved now (`saved`, by revision: history/store), in
// place of what it shows: saved by another chat since this one last loaded or saved it (`known`), its
// tab shown (a hidden one waits for it), no turn running here, and none elsewhere (shown once it ended).
export function showsSaved(chat: { shownId: string; stickyId?: string; hidden: boolean; idle: boolean; elsewhere: boolean; known?: number; saved?: Pick<Conversation, 'revision'> }): boolean {
  const { shownId, stickyId, hidden, idle, elsewhere, known, saved } = chat;
  return shownId === stickyId && !hidden && idle && !elsewhere && !!saved && known !== undefined && (saved.revision ?? 0) !== known;
}
