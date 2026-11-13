// Messages between the page widget (content script) and the background (runtime.sendMessage). The
// widget only learns the actions' names and the lines to show; the background checks every request
// against the page the message really comes from.
import type { ActionInput, OutputLine, WidgetAction } from './actions';
import { isHandoff, type Handoff, type HandoffTo } from '../core/handoff';
import type { ActionDetail, Message } from '../core/types';
import type { HastNode } from '../markdown/tree';
import type { StepTrace } from './steps';
import type { Decision } from '../policy/engine';

// { type: WIDGET_ACTIONS } → WidgetActionsReply: the actions of the sender's page.
export const WIDGET_ACTIONS = 'browser-agent:widget-actions';
// Running an action: a port of this name, then { type: WIDGET_RUN, id, input }; the background sends
// the model's answer as it comes (WidgetRunDelta) and last the WidgetRunReply. From the extension's
// pages (Settings → Actions' Try) it may carry the action being edited instead of an id. Closing the
// port stops it.
export const WIDGET_RUN = 'browser-agent:widget-run';
// { type: WIDGET_OPEN_CHAT, chat?, action?, floating? } → { opened: boolean }: a click on the bubble, on a card's
// "Open in the chat", or on an action that opens the chat, opens the side panel when the browser takes
// that click as the user's gesture. With `chat` (a WidgetOutputs' id), the panel then goes on with that
// request and its answer; with `action` (its id and what it takes and reads), it sends its message.
// With `floating` (the chat floats on that tab), they go to that chat instead, no side panel opened.
export const WIDGET_OPEN_CHAT = 'browser-agent:widget-open-chat';
export interface OpenChatAction {
  id: string;
  input: string;
  reads?: Record<string, string>;
}

// { type: WIDGET_FLOATING, open } → {}: the chat floats on the sender's tab, or no longer
// (storage.session FLOATING_PREFIX + tab id: { conversationId? }, the conversation it shows, written
// by the floating chat itself, so that it goes on after the page reloads).
export const WIDGET_FLOATING = 'browser-agent:widget-floating';
export const FLOATING_PREFIX = 'floating:';
export interface FloatingChat {
  conversationId?: string;
}
// To the widget of a tab, from the extension: { type: WIDGET_FLOAT, toggle? } → { floated: boolean }
// floats the chat there (again, to show the conversation its FLOATING_PREFIX key names now), or with
// `toggle` (the keyboard shortcut) folds it when shown.
export const WIDGET_FLOAT = 'browser-agent:widget-float';
// { type: WIDGET_REPAINT } from the floating chat, every second while a card waits and the browser
// does not see the chat whole: the page repaints until a moment after the last one. A page that is
// not painted does not let the browser look again (useSeen), and Allow would stay off.
export const WIDGET_REPAINT = 'browser-agent:widget-repaint';
// { type: WIDGET_HIDE, hidden } from the background, around a screenshot of the page (capture/run): the
// bubble and the floating chat off the page meanwhile, answered once painted so. Not kept for the site.
export const WIDGET_HIDE = 'browser-agent:widget-hide';
export const FLOAT_COMMAND = 'float-chat';
// { type: WIDGET_CHAT_STATE, state, movable, sticky?, stickable? } from the floating chat to its page's
// widget, as it changes: the bubble shows it while the chat is folded (working, waiting for the user,
// answered and not seen); `movable`: its conversation can go to the side panel now (between turns, not
// a temporary one); `sticky`: it shows the pinned conversation (the bar's pin on); `stickable`: its
// conversation can be pinned now (saved in the history, between turns).
export const WIDGET_CHAT_STATE = 'browser-agent:widget-chat-state';
// { type: WIDGET_STICKY, on } → { sticky: boolean }: the pin on the floating chat's bar. On: the
// conversation the chat floating on the sender's tab shows (its FLOATING_PREFIX key), when saved,
// becomes the pinned one; off: none is. Answered with whether one is pinned now.
export const WIDGET_STICKY = 'browser-agent:widget-sticky';
// { type: STICKY_UNPIN, conversationId } → {}: from a floating chat (an extension page), that
// conversation is no longer to be pinned (deleted, moved to the side panel, or open there): unpinned
// only if it is still the one pinned.
export const STICKY_UNPIN = 'browser-agent:sticky-unpin';
// storage.session: the pinned conversation (StickyChat). While set, the chat floating on every tab
// (but in incognito windows) shows it instead of its own (FLOATING_PREFIX), which each tab keeps for
// when it is unpinned. Written by the background only (WIDGET_STICKY, STICKY_UNPIN; removed once that
// conversation is deleted). The side panel never reads it.
export const STICKY_CHAT = 'stickyChat';
export interface StickyChat {
  conversationId: string;
}
export const isStickyChat = (v: unknown): v is StickyChat => !!v && typeof v === 'object' && typeof (v as StickyChat).conversationId === 'string' && !!(v as StickyChat).conversationId;
// storage.session: the conversations a run goes on for now, each with the tab of the chat floating
// there that runs it (NO_TAB: a chat with no tab of its own, the side panel's), written by the
// background's sessions (background/session). A chat showing a conversation another one runs waits.
export const RUNNING_CHATS = 'runningChats';
export const NO_TAB = -1;
export type RunningChats = Record<string, number>;
// A run refused, or a message not sent, while another chat runs the same conversation.
export const ANSWERING_ELSEWHERE = 'This conversation is answering in another tab';
export const RUNS_ELSEWHERE = `${ANSWERING_ELSEWHERE}: wait for that turn to end.`;
// { type: WIDGET_TO_PANEL } → { opened, moved }: "Open in the side panel" on the floating chat's bar. The
// background opens the side panel inside the click and asks the chat floating on the sender's tab for
// its conversation: { type: FLOATING_TO_PANEL, tab, to, opened } → { moved } (background/float-to-panel).
// Opened and moved, the widget closes the floating chat.
export const WIDGET_TO_PANEL = 'browser-agent:widget-to-panel';
// { type: WIDGET_PLACE, site, patch } → the place now: from the widget, its place on its site changed,
// made by the background inside the places' lock (widget/places), only when `site` is the sender's own
// page's (widgetSite); else no answer.
export const WIDGET_PLACE = 'browser-agent:widget-place';
export const FLOATING_TO_PANEL = 'browser-agent:floating-to-panel';
export type ChatState = 'idle' | 'working' | 'waiting';

// storage.session: the model answers the widget showed, to open in the chat (by id, the last few),
// and the one a chat is to open (CHAT_HANDOFF), a handoff (core/handoff) taken by it once read, when
// no turn runs there.
export const WIDGET_CHATS = 'widgetChats';
export const CHAT_HANDOFF = 'widgetChat';
export interface ConversationPayload {
  kind: 'conversation';
  messages: Message[]; // a conversation to go on with ("Open in the chat", or moved from the other chat)
  conversationId?: string; // moved from the other chat: the same one; none: a new one
  send?: string; // or a message to send at once, in a new one (an action that opens the chat)
  shown?: string; // how the chat shows that message (Part shown)
  agentId?: string; // the agent the action belongs to; none: Default
}
export type ChatHandoff = Handoff<ConversationPayload>;
export type { HandoffTo } from '../core/handoff';
export { handoffTo } from '../core/handoff';
// One read back from storage.session, which another version of the extension may have written:
// its shape checked, not its messages'.
export function isConversationPayload(v: unknown): v is ConversationPayload {
  if (!v || typeof v !== 'object') return false;
  const h = v as Record<string, unknown>;
  const optional = (key: string) => h[key] === undefined || typeof h[key] === 'string';
  return h.kind === 'conversation' && Array.isArray(h.messages) && optional('conversationId') && optional('send') && optional('shown') && optional('agentId');
}
export const isChatHandoff = (v: unknown): v is ChatHandoff => isHandoff(v, isConversationPayload);
// The keyboard shortcut's command (manifest commands), and its message to a tab: show or hide the
// widget on this site.
export const WIDGET_COMMAND = 'toggle-page-widget';
export const WIDGET_TOGGLE = 'browser-agent:widget-toggle';

// The one-off messages above (runtime.sendMessage to the background, tabs.sendMessage to a widget),
// and what each is answered with (core/runtime).
export type WidgetMessage =
  | { type: typeof WIDGET_ACTIONS }
  | { type: typeof WIDGET_OPEN_CHAT; chat?: string; action?: OpenChatAction; floating?: boolean }
  | { type: typeof WIDGET_FLOATING; open: boolean }
  | { type: typeof WIDGET_FLOAT; toggle?: boolean }
  | { type: typeof WIDGET_REPAINT }
  | { type: typeof WIDGET_HIDE; hidden: boolean }
  | { type: typeof WIDGET_CHAT_STATE; state: ChatState; movable: boolean; sticky?: boolean; stickable?: boolean }
  | { type: typeof WIDGET_STICKY; on: boolean }
  | { type: typeof STICKY_UNPIN; conversationId: string }
  | { type: typeof WIDGET_TO_PANEL }
  | { type: typeof WIDGET_PLACE; site: string; patch: WidgetPlace }
  | { type: typeof FLOATING_TO_PANEL; tab: number; to: HandoffTo; opened: boolean }
  | { type: typeof WIDGET_TOGGLE };
export interface WidgetReplies {
  [WIDGET_ACTIONS]: WidgetActionsReply;
  [WIDGET_OPEN_CHAT]: { opened: boolean };
  [WIDGET_FLOATING]: Record<string, never>;
  [WIDGET_FLOAT]: { floated: boolean };
  [WIDGET_REPAINT]: void;
  [WIDGET_HIDE]: void;
  [WIDGET_CHAT_STATE]: void;
  [WIDGET_STICKY]: { sticky: boolean };
  [STICKY_UNPIN]: Record<string, never>;
  [WIDGET_TO_PANEL]: { opened: boolean; moved: boolean };
  [WIDGET_PLACE]: WidgetPlace;
  [FLOATING_TO_PANEL]: { moved: boolean };
  [WIDGET_TOGGLE]: void;
}

// The storage key of the actions (widget/store), which the widget watches too.
export const ACTIONS_KEY = 'pageActions';

// The storage key of the widget's place and state per site, written by the widget itself.
export const WIDGET_PLACES = 'pageWidgetPlaces';
export interface WidgetPlace {
  x?: number;
  y?: number;
  hidden?: boolean;
  pinned?: boolean; // the actions stay open (when the bubble's click cannot open the side panel)
  width?: number; // the card's size, as the user left it (px)
  height?: number;
  chat?: { x: number; y: number; width: number; height: number }; // the floating chat's place and size
}

export interface WidgetActionInfo {
  id: string;
  name: string;
  icon?: string;
  input: ActionInput;
  placeholder?: string;
  json?: boolean; // the model answers in JSON (several boxes): not shown as it comes
  reads?: Record<string, string>; // the values it reads from the page, by name: {{selector:…}}…
  load?: boolean; // it runs on page load
  openChat?: boolean; // it opens the chat with its message instead of a card
  readsAloud?: boolean; // its boxes of text are read aloud on their own as its card shows them (WidgetAction.speak)
  besideSelection?: boolean; // a button beside the selected text too (widget/ui/speak-selection)
}

// An action's button: its icon, or its name's first letter.
export const actionIcon = (action: { icon?: string; name: string }) => action.icon?.trim() || [...action.name.trim()][0]?.toUpperCase() || '•';

export interface WidgetActionsReply {
  actions: WidgetActionInfo[];
  always?: boolean; // the bubble stays without actions (Settings → Bubble: on every website)
  floating?: boolean; // the chat floats on this tab (reopened after the page reloads)
}

// Characters of the selection, and of each value read from the page, an action is given.
export const MAX_PAGE_VALUE = 1000;

export interface WidgetRunRequest {
  type: typeof WIDGET_RUN;
  id?: string;
  action?: WidgetAction;
  input: string;
  reads?: Record<string, string>; // what an action on page load read from it
  tabId?: number; // Settings → Actions' Try: the tab it runs on (its values read there)
}

// A box's lines; or, for the model's whole answer, its text as written.
// `chat`: the model's answer, to open in the chat. A text comes as Markdown too (`tree`, built by the
// background: the widget only turns it into elements).
export type WidgetOutputs = { outputs: { label: string; lines: OutputLine[]; text?: string; tree?: HastNode }[]; chat?: string; chatIcons?: boolean; badge?: string }; // chatIcons: the chat's buttons as icons, here and in the side panel
export type WidgetRunReply = WidgetOutputs | { error: string };
// A run's error once it was stopped (the card closed, or the time was up).
export const STOPPED = 'Stopped.';

export type WidgetRunEvent =
  | { type: 'delta'; kind: 'text' | 'reasoning'; text: string }
  | { type: 'markdown'; tree: HastNode } // the answer so far, as Markdown
  | ({ type: 'confirm'; id: string } & ActionConfirm) // a write to confirm in the card: answered with WidgetConfirmReply
  | { type: 'step'; step: StepTrace } // an action with steps: one started or ended (Settings → Actions' Try)
  | { type: 'reply'; reply: WidgetRunReply };

// A write the card asks the user about (as the chat's confirmation card shows it), and the answers.
export interface ActionConfirm {
  summary: string;
  details?: ActionDetail[];
  host: string;
}
export type CardDecision = Extract<Decision, 'allow' | 'always' | 'deny'>;

// The card's answer to a 'confirm', on the same port; closing the port is a deny.
export interface WidgetConfirmReply {
  type: 'confirm-reply';
  id: string;
  decision: CardDecision;
}
