// Messages between the side panel and the service worker (chrome.runtime Port "agent").
import type { AutoInjectKind } from '../context/auto-inject';
import type { LoopEvent } from './agent-loop';
import type { Decision } from '../policy/engine';
import type { KeptText } from './kept-results';
import type { ContextItem } from './messages';
import type { WatchSettings } from '../watches/store';
import type { SettingsEdit } from '../storage/settings-edit';
import type { CaptureKind } from '../capture/protocol';
import type { PanelMessage, PanelRow } from '../manager/protocol';
import type { AccessRequest, ActionDetail, AutoAttachCheck, JSONSchema, Message, Part, SystemMemory, ThinkingLevel, Tool, UserReply, UserRequest, WindowSource } from './types';

export const PORT_NAME = 'agent';

// One-off request (runtime.sendMessage) for the tool catalog shown in the panel:
// { type: LIST_TOOLS, tabId? } → { tools } | { error }. With a tabId it includes the tools that page
// offers (WebMCP).
export const LIST_TOOLS = 'browser-agent:list-tools';
interface ListToolsRequest {
  type: typeof LIST_TOOLS;
  tabId?: number;
}
// From the extension's pages: { type: SUMMARIZE, providerId, model, transcript, maxWords } →
// { summary } | { error }: earlier turns summarized for a compaction (context/compaction).
export const SUMMARIZE = 'browser-agent:summarize';
export interface SummarizeRequest {
  type: typeof SUMMARIZE;
  providerId: string;
  model: string;
  transcript: string;
  maxWords: number;
  masked?: boolean; // the conversation went through the word blacklist (word-blacklist/gate): the summary does too
  instructions?: string; // for this summary (chat.compact): after the request's own rules
}
export type ListToolsReply = { tools: ToolInfo[] } | { error: string };
export type SummarizeReply = { summary: string } | { error: string };
// Broadcast by the background when the catalog has more tools (an MCP server finished connecting).
export const TOOLS_CHANGED = 'browser-agent:tools-changed';

// From the panel: a tab watch started by the user, or cancelled (background/watches).
export const WATCH_START = 'browser-agent:watch-start';
export const WATCH_CANCEL = 'browser-agent:watch-cancel';

// From a tab's own side panel, inside the click on the chat's pin: the window's panel opens in its place
// (core/side-panel openWindowPanel) → { opened }.
export const OPEN_WINDOW_PANEL = 'browser-agent:open-window-panel';
// From the window's side panel where the browser hosts it in a tab (Vivaldi), inside the click on Float
// on this page: the background closes it (core/side-panel closeWindowPanel) → { closed }.
export const CLOSE_WINDOW_PANEL = 'browser-agent:close-window-panel';
// The window's side panel where the browser hosts it in a tab (Vivaldi), on its own port to the
// background (background/panel-windows): whether it shows, once connected and whenever that changes.
export const WINDOW_PANEL_PORT = 'window-panel';
export interface WindowPanelState {
  windowId: number;
  shown: boolean;
}
// Broadcast by a worker that has just started: those panels connect again (until then it knows none).
export const PANEL_HELLO = 'browser-agent:panel-hello';
// From the toolbar popup, before any click: whether the window's side panel shows → { shown }.
export const PANEL_SHOWN = 'browser-agent:panel-shown';

// The tabs the DevTools engine or a recording has the debugger attached to (devtools/cdp): asked by a chat
// ({ type } → { tabs }), and broadcast by the background on every attach and detach ({ type, tabs }).
export const DEVTOOLS_STATUS = 'browser-agent:devtools-status';

// From the toolbar popup, inside the click: a screenshot of the tab into the chat (background/capture-host),
// the side panel opened first when it is to get it → { started }.
export const CAPTURE = 'browser-agent:capture';
// From the page, once a section dragged on it is captured (capture/page askToOpenChat), inside the gesture
// the drag left: the side panel opened for it → { opened } (or it took the capture already).
export const CAPTURE_OPEN_CHAT = 'browser-agent:capture-open-chat';
// A key set in Settings → Shortcuts, pressed in a page (entrypoints/page-keys) or in one of the
// extension's own pages: its command run as its browser shortcut runs it (background/shortcuts).
export const PAGE_KEY = 'browser-agent:page-key';
// From a chat's history, for a conversation open in the Agents Panel: the page that has it shows its row
// and comes to the front → { shown } (no page answers: none has it).
export const SHOW_IN_MANAGER = 'browser-agent:show-in-manager';
// From the background, for the Agents Panel's tools (agents/panel), to the page that has the chat's row
// (`parent`); no page answers: none has it.
// Start an agent in a new row under it, on a new tab at `url`, given `message` → { row } or { tooMany }.
export const PANEL_START = 'browser-agent:panel-start';
// How the rows it started are (all, or `rows`) → { rows }.
export const PANEL_ROWS = 'browser-agent:panel-rows';
// Give one of them `message` as its next message → { when } or { noRow: its rows }; a stopped one goes on
// on its tab first, or → { stopped: its row's title } when it cannot.
export const PANEL_SEND = 'browser-agent:panel-send';
// From the extension's pages, inside the click that changed a setting: the change, stored by the
// background on the settings as stored (storage/settings updateSettings) with the page's stamp, so
// that it is stored even when the page closes right after → { ok } | { error }. It carries the keys
// and headers changed: only the background takes it, and nothing logs it.
export const SETTINGS_EDIT = 'browser-agent:settings-edit';

// The one-off messages above, and what each is answered with (core/runtime).
export type CoreMessage =
  | ListToolsRequest
  | SummarizeRequest
  | { type: typeof TOOLS_CHANGED }
  | { type: typeof WATCH_START; settings: WatchSettings }
  | { type: typeof WATCH_CANCEL; id: string }
  | { type: typeof OPEN_WINDOW_PANEL; tabId: number; windowId: number }
  | { type: typeof CLOSE_WINDOW_PANEL; windowId: number }
  | { type: typeof PANEL_HELLO }
  | { type: typeof PANEL_SHOWN; windowId: number }
  | { type: typeof DEVTOOLS_STATUS; tabs?: number[] }
  | { type: typeof CAPTURE; kind: CaptureKind; tabId: number; windowId: number }
  | { type: typeof CAPTURE_OPEN_CHAT }
  | { type: typeof PAGE_KEY; command: string }
  | { type: typeof SETTINGS_EDIT; edit: SettingsEdit; stamp: string }
  | { type: typeof SHOW_IN_MANAGER; conversationId: string }
  | { type: typeof PANEL_START; parent: string; agentId?: string; agentName: string; message: PanelMessage; url: string; max: number }
  | { type: typeof PANEL_ROWS; parent: string; rows?: string[] }
  | { type: typeof PANEL_SEND; parent: string; row: string; message: PanelMessage };
export interface CoreReplies {
  [LIST_TOOLS]: ListToolsReply;
  [SUMMARIZE]: SummarizeReply;
  [TOOLS_CHANGED]: void;
  [WATCH_START]: { ok: true } | { error: string };
  [WATCH_CANCEL]: void;
  [OPEN_WINDOW_PANEL]: { opened: boolean };
  [CLOSE_WINDOW_PANEL]: { closed: boolean };
  [PANEL_HELLO]: void;
  [PANEL_SHOWN]: { shown: boolean };
  [DEVTOOLS_STATUS]: { tabs: number[] };
  [CAPTURE]: { started: boolean };
  [SHOW_IN_MANAGER]: { shown: boolean };
  [PANEL_START]: { row: string } | { tooMany: number };
  [PANEL_ROWS]: { rows: PanelRow[] };
  [PANEL_SEND]: { when: 'now' | 'later' } | { noRow: string[] } | { stopped: string };
  [CAPTURE_OPEN_CHAT]: { opened: boolean };
  [PAGE_KEY]: void;
  [SETTINGS_EDIT]: { ok: true } | { error: string };
}

export interface ToolInfo {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  source: Tool['source'];
  group?: string;
  effect: Tool['effect'];
  repeatable?: boolean;
  via?: Tool['via'];
}

export type PanelToBackground =
  // tabId: the tab the panel considers "the page"; includePage: attach its context (noSelection:
  // without its selected text).
  // agentId: the agent it runs as (Settings → Agents); none: Browser.
  // contextWindow: the window the panel counts on for the model (its meter's, else Settings → Compaction's);
  // contextWindowSource: where it comes from (none: an older panel, taken as known).
  // wordBlacklist: the user turned the word blacklist on (true) or off (false) in this conversation (word-blacklist/gate).
  // kept: the files attached to the last message that were cut, whole, for tools.read_more (core/kept-results).
  // userTab: the tab the user is on, when it is not tabId (the window's side panel).
  // runId: the panel's number for this run, sent back on every event of it (RunTagged); none: an older panel.
  | { type: 'run'; runId?: number; history: Message[]; providerId: string; model: string; tabId?: number; includePage: boolean; noSelection?: boolean; thinking?: ThinkingLevel; conversationId?: string; agentId?: string; skip?: AutoInjectKind[]; contextWindow?: number; contextWindowSource?: WindowSource; wordBlacklist?: boolean; kept?: KeptText[]; userTab?: { tabId: number; title?: string; url?: string }; panelRow?: string } // panelRow: the Agents Panel's row the user started, whose chat runs (agents/panel)
  | { type: 'stop' }
  // Sent periodically while a run is active: each message resets the MV3 service worker's
  // ~30 s idle timer, which otherwise kills it while waiting for a confirmation or a slow model.
  | { type: 'keepalive' }
  | { type: 'confirm-reply'; id: string; decision: Decision; comment?: string; edits?: Record<string, string> } // edits: the values edited on the card, by field
  | { type: 'access-reply'; id: string; granted: boolean }
  | { type: 'user-reply'; id: string; reply: UserReply }
  | { type: 'more-steps-reply'; id: string; more: boolean }
  // The user took this plan away while a run goes (its user.plan call's id).
  | { type: 'plan-dismissed'; id: string }
  // The chat opened this conversation: a run of it going on away (the floating chat's page reloaded)
  // comes back to it, with 'resume'.
  | { type: 'attach'; conversationId: string }
  // Whether the chat shows now, as it opens its port and each time that changes (background/session-alerts).
  | ({ type: 'view' } & ChatView);

// Whether a chat shows: its page visible (and, floating, not folded); the window it is in; whether it is
// one of the Agents Panel's chats (its questions alert as that panel's agent waiting).
export interface ChatView {
  shown: boolean;
  windowId?: number;
  agentsPanel?: boolean;
}

// An event as the port carries it: with the number of the run it belongs to (its 'run' message's runId),
// so the panel drops those of a run it has left. None: an older worker, or a run sent without one.
export type RunTagged = BackgroundToPanel & { runId?: number };

export type BackgroundToPanel =
  | LoopEvent
  // Context (site skills, page) attached to the last user message. The panel stores it in the
  // history so later requests resend the exact same message (append-only history).
  | { type: 'context'; items: ContextItem[] }
  // The memory part of the system prompt from this turn on, kept in your latest message
  // (core/messages keepSystemMemory) so later turns send the same system prompt.
  | { type: 'system-memory'; memory: SystemMemory }
  // What the agent is doing before the model answers (e.g. "Reading ::todoist/today…").
  | { type: 'status'; text: string }
  // What the auto-attach of saved conversations found for the last user message (for the views).
  | { type: 'auto-attach'; check: AutoAttachCheck }
  // A write action waits for the user's decision (answered with 'confirm-reply').
  // problem and edited: asked again, the values the user edited could not be saved (policy/engine).
  | { type: 'confirm'; id: string; summary: string; details?: ActionDetail[]; host: string; agent?: string; problem?: string; edited?: Record<string, string> } // agent: who asks, when not Browser
  // A tool needs a permission only the user can grant from the panel (answered with 'access-reply').
  | ({ type: 'access'; id: string } & AccessRequest)
  // A tool asks the user (tools/user), answered with 'user-reply'; or the question is over without
  // an answer from the panel (e.g. the element was picked on the page).
  | { type: 'user-request'; id: string; request: UserRequest }
  | { type: 'user-closed'; id: string }
  // A sub-agent ran out of steps (agents.ask): go on with as many again? (answered with 'more-steps-reply').
  | { type: 'more-steps'; id: string; agent: string; steps: number }
  // What a sub-agent is doing for an agents.ask call (callId), as it does it (agents/ask).
  | { type: 'sub'; callId: string; agent: string; event: LoopEvent }
  // Taken over (attach): a plan taken away in the chat that left, among what was sent since.
  | { type: 'plan-dismissed'; id: string }
  // A tool call's result as it ended (core/agent-loop onResult), before the step's results message:
  // kept by the panel for a Stop meanwhile (core/messages markStopped).
  | { type: 'tool-result'; result: Part }
  // Taken over (attach): the history the run started from; what it sent since follows, as it did.
  | { type: 'resume'; history: Message[] };
