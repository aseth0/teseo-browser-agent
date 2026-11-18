// Stable core contracts. The AgentLoop only knows these interfaces:
// no concrete providers, websites or servers. See docs/ARCHITECTURE.md.

import type { CompactionParts } from './compaction-parts';
import type { Origin } from './origin-marks';

export type JSONSchema = Record<string, unknown>;

// ---------- Messages (neutral format; each provider translates it) ----------

export interface ImagePayload {
  mediaType: string;
  data: string; // base64 without the data: prefix
}

// The image as a data: URL, to show it or send it.
export const dataUrlOf = (i: ImagePayload) => `data:${i.mediaType};base64,${i.data}`;

export type ContextKind = 'page' | 'skill' | 'tool' | 'memory' | 'summary';

// A text the chat sends as a user message: with how the chat shows it (Part shown) and who wrote it (Part from).
export interface SentText {
  text: string;
  shown?: string;
  from?: 'panel';
}

export type Part =
  // context marks text injected by the extension (page context, site skills), hidden in the UI.
  // shown: what the chat shows in its place, never sent (a page action's message: its values from the
  // page without the untrusted blocks the model gets them in).
  // from: 'panel', not yours: a notice from an agent of the Agents Panel this chat started (manager/notices),
  // drawn as a line, not as your message; the model gets it as a user message all the same.
  | ({ type: 'text'; context?: ContextKind; source?: string } & SentText)
  // Model reasoning ("chain of thought"), shown in the UI; sent back to the model only while it works
  // on your last message (providers/wire).
  | { type: 'reasoning'; text: string }
  // dismissed: user.plan's, the user took that plan away (never sent to the model)
  | { type: 'tool_call'; id: string; name: string; args: unknown; dismissed?: boolean }
  // userComment: what the user wrote when allowing or denying the call (also inside content).
  // trace: a sub-agent's run, for the user only (agents.ask)
  // tab: the tab a call named (its tabId), as it was when it ran, for the chat (never sent to the model)
  // attached: what went after it on its own, between the model's steps (context/step-attach; also inside content)
  // devtools: it ran on the DevTools engine (the chat marks it)
  | { type: 'tool_result'; toolCallId: string; content: string; isError?: boolean; images?: ImagePayload[]; userComment?: string; trace?: SubTrace; tab?: TabSeen; devtools?: true; attached?: { kind: ContextKind; text: string; source?: string }[] }
  // An image you attached to your message; `data` empty once saved (saved conversations keep no images).
  | ({ type: 'image' } & ImagePayload);

// What a sub-agent did for one agents.ask call (its reasoning, tool calls and answer): kept with the
// call's result for the user to see, never sent to the model.
export interface SubTrace {
  agent: string; // its label, as shown
  messages: Message[];
  steps?: boolean; // a script tool's steps (tools/custom/script-tool), not an agent's run: no task message first
}

export interface TabSeen {
  id: number;
  title: string;
  url?: string;
}

export interface Message {
  role: 'user' | 'assistant' | 'tool';
  parts: Part[];
  meta?: MessageMeta; // assistant messages: how the call that produced it went (never sent to the model)
  pageSkipped?: 'off' | 'unreadable'; // your messages: why the page was not attached (for the views)
  autoAttach?: AutoAttachCheck; // your messages: what the auto-attach of saved conversations found (for the views)
  toolMatch?: ToolMatch; // your messages: which tool groups it matched and which were offered (tools/match; for the views, and later turns)
  stopped?: boolean; // the last message of a turn the user stopped (the model is told on the next one)
  interrupted?: boolean; // with `stopped`: stopped by a message sent at once (sidepanel/send-queue), not by Stop
  cut?: string; // the last message of a turn cut as it kept repeating this (core/repetition; the model is told on the next one)
  agent?: string; // your messages: the agent it went to (Settings → Agents), by id; none: Browser (for the views)
  compaction?: Compaction; // your messages: everything before goes to the model compacted (context/compaction)
  systemMemory?: SystemMemory; // your messages: the memory part of the system prompt from this turn on (memory/prompt keepMemory)
  masked?: boolean; // assistant messages: the request went through the word blacklist; the rest of the conversation does too (word-blacklist/gate)
  phases?: TurnPhase[]; // your messages: the phases of the turns it started, with their timings (core/phases; for Layers, never sent)
}

// One phase of a turn (core/phases): what the agent did, when it began (Date.now()) and how long it
// took; none while it goes (or a turn cut short before it ended). `parent`: the phase it is part of.
export interface TurnPhase {
  id: string;
  kind: PhaseKind;
  label: string;
  detail?: string;
  at: number;
  ms?: number;
  parent?: string;
}
export type PhaseKind = 'compact' | 'start' | 'setup' | 'tools' | 'context' | 'call' | 'wait' | 'reasoning' | 'answer' | 'tool' | 'confirm' | 'agent' | 'attach' | 'other';

// The memory part of the system prompt as a conversation keeps it, so the prompt stays the same on
// every turn (the server's prompt cache): its text, what it was built with (`key`: built again when that
// changes) and the items it covers as they were then. What changed since goes with your messages.
export interface SystemMemory {
  key: string;
  text: string;
  items: { id: string; at: number; pinned: boolean }[]; // at: the item's updatedAt
}

// How the turns before a message go to the model from then on: their page blocks, tool results and
// screenshots left out (as `trimmed` says), or replaced by a summary. The history keeps them whole.
export interface Compaction {
  at: number; // when
  turns: number; // the turns it covers (none: it only trims the turn it is on)
  trimmed: CompactionParts;
  summary?: string;
  inner?: number; // of the messages it keeps (its own first), how many go trimmed too: all but the latest few
  before: number; // estimated tokens of the conversation's messages, as they went before it
  after: number; // and as they go now
  ranAfter?: number; // how many messages the chat had when it ran: the chat marks that moment after them
  instructions?: string; // for its summary, from the model's chat.compact call
  short?: { percent: number; target: number; fixed: number }; // it could not reach its target: where it got, the target and what the system prompt and tools take (% of the window)
}
// The best saved conversation the auto-attach found for a message, against its threshold.
export interface AutoAttachCheck {
  threshold: number; // %
  scope: 'pinned' | 'all';
  best?: { title: string; match: number }; // %
}

// Which groups of tools a message matched (Settings → Tools → Matching, tools/match), and what each
// got: for the views (the turn's phases) and the next turns (a group offered once stays offered).
// outcome: 'matched' (by this message), 'unsure' (offered: nothing stood out, Only matching; does not stay),
// 'used' (one of its tools was called in the conversation), 'earlier' (offered for an earlier message), 'loaded' (by
// tools.load), 'mentioned' (one of its tools is, $tool): offered; 'held': left for tools.load (Only
// matching); 'unmatched': offered, not recommended (Recommended). tools: those of the group the
// message matches by words, best first (the group goes by the best one). mode: the group's own (a
// server's choice in Settings → MCP servers, else the setting's); none (an older record): `mode`.
export interface ToolMatch {
  mode: 'all' | 'recommend' | 'matching'; // Settings → Tools → Matching's
  threshold: number; // % of the message's words
  groups: { id: string; label: string; mode?: 'recommend' | 'matching'; match: number; meaning?: number; tools?: string[]; outcome: 'matched' | 'unsure' | 'used' | 'earlier' | 'loaded' | 'mentioned' | 'held' | 'unmatched' }[]; // match, meaning: %; best first
  always: string[]; // the groups never filtered that were offered (browser, user, memory, agents…)
  byWords?: boolean; // meaning was asked for but the embeddings provider did not answer
  wordsOnly?: boolean; // matched by words only (no embeddings model, meaning left out, or too few tools indexed)
  wordsNeeded?: { matching: number; recommend: number }; // the match by words (%) a group needed for this message, per mode
  meaningNeeded?: { matching: number; recommend: number }; // the cosine (%) a group's closest tool needed for this message, per mode
  unsure?: boolean; // neither words nor meaning pointed at any tool: Only matching offered its groups ('unsure')
}

// One model call: its tokens (as reported by the server, else estimated) and how long it took.
export interface MessageMeta {
  input: number;
  output: number;
  reported: boolean;
  reasoning?: number; // of `output`, the reasoning (sent back only within its turn), when the server reports it apart
  cached?: number; // of `input`, what the server's prompt cache served, when it says
  ms: number; // the whole call
  firstTokenMs?: number; // until the first text, reasoning or tool call arrived
  sinceStartMs: number; // from when the run began (your message was sent) to the end of this call
}

// ---------- 1. LLM providers ----------

export interface ModelInfo {
  id: string;
  contextWindow?: number; // tokens, when the server publishes it
}

export interface ToolSpec {
  name: string; // "wire" name (already sanitized for the API)
  description: string;
  inputSchema: JSONSchema;
}

// How much the model reasons before answering (providers/thinking turns it into request fields).
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high';

export interface ChatRequest {
  model: string;
  system?: string;
  messages: Message[];
  tools?: ToolSpec[];
  maxTokens?: number;
  thinking?: ThinkingLevel; // none: the server's default
  toolChoice?: string; // a tool's wire name, or 'required' (any tool): the model must call it; 'none': it may call none
  json?: boolean; // the answer must be a JSON object (response_format), where the server supports it
}

export type ChatEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'reasoning-end' } // closes the current reasoning block
  | { type: 'tool-call'; id: string; name: string; args: unknown }
  | { type: 'usage'; inputTokens: number; outputTokens: number; reasoningTokens?: number; cachedTokens?: number } // as reported by the server (reasoning: of the output, cached: of the input, when it says)
  | { type: 'notice'; text: string } // something the user should know, e.g. a setting the server ignored
  | { type: 'done'; stopReason: string };

// A model's context window as a server says it: its own (`server`), or the most the model takes
// while the server may run it with less (`model-max`: Ollama without num_ctx).
export interface FoundContextWindow {
  tokens: number;
  source: 'server' | 'model-max';
}

// Where the window a run fits its requests in comes from (context/window runWindow): set for the model,
// learned from a server's "too long" error, published by the server, set for the provider, the model's
// most, or Settings → Compaction's for an unknown window ('default': a guess, so the run shortens less on it).
export type WindowSource = 'model-settings' | 'error' | 'server' | 'settings' | 'model-max' | 'default';

export interface LLMProvider {
  listModels(): Promise<ModelInfo[]>;
  contextWindow?(model: string, models?: ModelInfo[]): Promise<FoundContextWindow | undefined>;
  chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent>;
}

// ---------- 2. Tools ----------

export type ToolResult =
  // userComment: what the user answered, for the chat (tools that ask the user); data: the answer as
  // a value, for what shows it without the model (the page widget), never sent to the model
  // elements: the page's elements as they are in `text` (an action's result), which later requests of
  // the turn may leave out (context/in-run); never kept
  | { type: 'text'; text: string; isError?: boolean; userComment?: string; data?: unknown; trace?: SubTrace; elements?: string }
  // note: said with the image (browser.screenshot on the engine: how many fields it masked)
  | ({ type: 'image'; note?: string } & ImagePayload)
  | { type: 'json'; value: unknown };

// A permission the user can grant from the panel (e.g. reading a website) that a tool needs.
export interface AccessRequest {
  origin: string; // what to request, e.g. the match pattern "https://example.com/*"
  site: string; // for people: "example.com"
  title: string; // what it is for: the page title
  reason?: string; // shown instead of "wants to read the tab": e.g. the LLM provider's site
}

// Thrown by a provider whose model cannot call tools (the server rejects a request with them): the
// loop goes on without tools.
export class ToolsUnsupportedError extends Error {}

// Thrown by a tool that lacks such a permission: the loop asks the user and runs it again.
export class AccessRequiredError extends Error {
  constructor(
    readonly access: AccessRequest,
    message: string,
  ) {
    super(message);
  }
}

// Whether a call may run (the policy sees every call): refused (the reason, shown to the model) or
// allowed; and the comment the user wrote when answering, if any (a refusal's reason already
// includes it).
export interface Authorization {
  refused?: string;
  comment?: string;
  args?: unknown; // the call's arguments as the user edited them on the card, to run with
  edited?: EditedValue[]; // what they changed, for the model
  approvedHost?: string; // the tab's site the call was judged by: it acts only while the tab is still on it
  seen?: CallSeen; // what the policy saw, for the action log
}

// A field the user edited on the card: its label, and a line diff from the model's value to theirs.
export interface EditedValue {
  label: string;
  diff: string;
}

// What the policy saw of a call, for the action log (logs/actions): its summary and site when it
// looked at them, and the user's answer when the card was shown.
export interface CallSeen {
  summary?: string;
  host?: string;
  asked?: 'allow' | 'always' | 'session' | 'deny';
}

// What a run knows of one of its calls (core/tool-exec, widget/run), for the action log (logs/actions).
export interface ToolCallLog {
  tool: string;
  at: number;
  ms: number;
  seen?: CallSeen;
  refused?: string;
  error?: string;
  size?: number;
}

// What a write tool is about to do, for the confirmation card: a one-line summary, and the fields
// worth reading before allowing it (code, such as a template's or the arguments, shown as such).
export interface ActionDescription {
  summary: string;
  url?: string; // the URL it affects when it is not the current tab's
  details?: ActionDetail[];
}
export interface ActionDetail {
  label: string;
  value: string;
  code?: boolean;
  key?: string; // what matches it with the same field of the saved item, when not its label (tools/reviewed-save withChanges)
  diff?: boolean; // the value is a line diff (tools/line-diff): each line marked added, removed or kept
  // The user may edit it on the card: the argument it sets (a dotted path), its whole proposed value
  // (a list, one per line), and whether it is a list or a long text.
  edit?: { field: string; value: string; lines?: 'list' | 'text' };
  editOnly?: boolean; // shown only while editing (a field the item leaves empty)
}

// The settings a run goes with (ToolContext.settings): the extension's Settings, merged in by
// storage/settings-types, so that core names no outer module.
export interface RunSettings {} // filled by declaration merging

export interface ToolContext {
  tabId?: number; // tab the panel considers "the page"
  signal: AbortSignal;
  settings: RunSettings; // as the run started with them (background/settings settingsNow), read once for it
  conversationId?: string; // the panel's conversation (history tools leave it out)
  skills?: string[]; // the skills an agent (Settings → Agents) was given; none: the enabled ones
  templates?: string[]; // the site templates an agent was given, for the templates tools; none: every one
  agentId?: string; // the agent running (Settings → Agents); none: Browser
  callId?: string; // the tool call being run (a sub-agent's events name it)
  // The site of the tab the policy (or the user) allowed this call on (Authorization): a tool that
  // acts on that tab checks the tab is still on it right before acting.
  approvedHost?: string;
  // Asks the user in the panel and waits (tools/user); the signal closes the question unanswered.
  interact?: (req: UserRequest, signal?: AbortSignal) => Promise<UserReply>;
  // For a tool that runs others (a script tool's tool(), script/steps): runs one as the model's calls
  // run (the policy, the user's confirmation), and gives its answer with its structured data.
  callTool?: (name: string, args: unknown) => Promise<{ content: string; isError?: boolean; data?: unknown }>;
  // Shows the user each of its steps as it goes, under its call (as a sub-agent's), named `label`.
  emit?: (label: string, message: Message) => void;
}

// A question for the user, as the model writes it (user.ask).
export interface AskQuestion {
  question: string;
  header?: string; // a short label for it
  type: 'choice' | 'multi' | 'text'; // one option, several, or a free answer
  options?: { label: string; description?: string }[];
  placeholder?: string;
}

// What a tool asks the user in the panel: questions, or to pick an element on the page (the card
// only says so and lets the user cancel; the page does the picking).
// Or to sign in on a page a tool reads (web.read), in its background tab: done (answers), or not.
export type UserRequest = { kind: 'ask'; questions: AskQuestion[] } | { kind: 'pick'; prompt: string } | { kind: 'sign-in'; url: string; tabId: number };

// The answers, one list per question (the options chosen, or the text written), or none.
export type UserReply = { answers: string[][] } | { dismissed: true };

export interface Tool {
  name: string; // namespaced: "browser.click", "mcp.github.create_issue"
  description: string;
  inputSchema: JSONSchema;
  source: 'browser' | 'mcp' | 'webmcp' | 'skill' | 'template' | 'user' | 'history' | 'memory' | 'bookmarks' | 'web' | 'custom' | 'agent' | 'speech';
  // Fills the placeholders of its description (yours, Settings → Tools, or its own) for this run:
  // agents.ask lists the agents it may ask.
  fillDescription?: (description: string) => string;
  // Its description is a text of its own (a tool trimmed until its group is loaded, tools/load), not
  // the tool's: a description you changed for the tool does not replace it.
  ownText?: boolean;
  // The group it is listed under, like the websites of site templates: "webmcp:<host>" for the
  // tools a page offers, "mcp:<server>", "custom:<group>"; none: its source's (see toolGroup).
  group?: string;
  effect: 'read' | 'write' | 'interact'; // write ⇒ must be authorized (site policy or user confirmation); interact: asks the user
  // A write whose result may be had again by calling it again (web.read: it opens a site, and reads
  // the same again), for the in-turn savings (context/in-run); its effect still says how it is authorized.
  repeatable?: boolean;
  via?: 'devtools'; // runs on the DevTools engine (tools/browser/engine-tools): marked so in Settings, the tools menu and the chat
  // Confirmed every time, without a site policy: always, or for the calls a function says (e.g.
  // reading a saved conversation in full).
  alwaysAsk?: boolean | ((args: unknown) => boolean);
  policyHost?: string; // the policy that applies instead of the tab's site ("mcp:<server>")
  // Touches no site the call chooses (web.search: the user's search engine): an agent may use it
  // anywhere, as the tools of a siteless source.
  siteless?: boolean;
  // The tab a call names (its tabId argument), for tools that take one; none: the panel's tab. The
  // policy judges the call by that tab's site, and a read on another tab is confirmed like an action.
  tabOf?(args: unknown): number | undefined;
  // What to do for a required argument a call left out, by its name: said with the missing-argument
  // reply (browser.type's ref: read the page first).
  missingHints?: Record<string, string>;
  // Human-readable summary of a call, plus the URL it affects when it is not the current tab's.
  describe?(args: unknown, ctx: ToolContext): Promise<ActionDescription>;
  // The arguments with the values the user edited on the card (ActionDetail.edit, by field); throws
  // what keeps them from being saved (tools/reviewed-save).
  withEdits?(args: unknown, edits: Record<string, string>, ctx: ToolContext): Promise<unknown>;
  run(args: unknown, ctx: ToolContext): Promise<ToolResult>;
}

// ---------- 3. Context blocks ----------

export interface ContextBlock {
  kind: 'page-meta' | 'readable' | 'a11y-tree' | 'structured-data' | 'selection' | 'screenshot' | 'custom';
  priority: number;
  content: string;
  tokensEstimate: number;
}

// ---------- Usage (estimated in context/usage) ----------

export interface ContextBreakdown {
  system: number;
  tools: number; // tool definitions sent with the request
  conversation: number; // user and assistant messages
  pageContext: number; // <untrusted_page_content> attached to user messages
  skills: number; // <site_skill> blocks attached to user messages
  toolResults: number;
}

// Where the text of a request comes from: the origins Layers colors (the marks in the text), and
// for unmarked text, the place it is in.
export type UsageSource =
  | Origin
  | 'system' // the system prompt's own text
  | 'tools' // tool definitions
  | 'wrappers' // the extension's text around what it attaches to your message
  | 'answers' // the model's answers and tool calls
  | 'results'; // tool results without a mark (actions, errors)

export type SourceBreakdown = Partial<Record<UsageSource, number>>;

// Context accounting for one model call: what the request is made of (estimated)
// and what the server reported, when it does.
export interface CallUsage {
  breakdown: ContextBreakdown; // estimated input
  sources?: SourceBreakdown; // the same input by where its text comes from
  estimatedOutput: number;
  estimatedReasoning?: number; // of estimatedOutput, the reasoning: sent back only within its turn
  estimatedImages?: number; // of the estimated input, the images (their cost differs widely by provider)
  toolNames?: string[]; // the tools it offered, by wire name: the context meter weighs them by group
  // reasoning: of the output, when the server says; cached: of the input, what the server's prompt cache served
  reported?: { input: number; output: number; reasoning?: number; cached?: number };
}
