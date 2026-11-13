// Compaction (Settings → Compaction): the turns before the latest few go to the model with their page
// blocks, tool results, screenshots, long call arguments and attached site skills and memory left out,
// and the model's long replies cut, and summarized by a model when that is not enough.
// It is kept in the history, on the first message it leaves whole (Message.compaction), so that what
// goes before it is the same on every request from then on (the server's prompt cache breaks once);
// the history itself keeps every turn whole, for the chat and the saved conversation.
import { text } from '../core/model-texts';
import { answerToolCalls } from '../core/messages';
import { fragmentShown } from '../core/repetition';
import type { CompactionParts } from '../core/compaction-parts';
import type { Compaction, Message, Part } from '../core/types';
import type { CompactionSettings } from '../storage/settings-types';
import { toWireName } from '../core/tool-registry';
import { latestPlan, planDone } from '../tools/user/shapes';
import { corrected, messagesTokens } from './budget';
import { dedupeContext, dedupeNow } from './dedupe';
import { planStepLines } from './plan-reminder';
import { COMPACTION_PLAN_SOURCE, SKILL_MENTION_SOURCE } from './sources';

// defaultWindow: the window counted on when the model's is unknown (Settings → Compaction); 0: none.
export const COMPACTION_DEFAULTS = { auto: true, threshold: 80, keepTurns: 4, summarize: true, maxWords: 400, defaultWindow: 72000 } as const;
export const ALL_PARTS: CompactionParts = { pages: true, toolResults: true, screenshots: true, replies: true, toolArgs: true, attached: true };
export const KEEP_CHARS = 400; // a page block, tool result, call's arguments or attached block this short is kept
const REPLY_HEAD = 1000; // of a long reply of the model's, what is kept
const REPLY_CHARS = 1400; // a reply this short is kept whole

export const compactionOf = (s: CompactionSettings | undefined) => ({ ...COMPACTION_DEFAULTS, ...s, trim: { ...ALL_PARTS, ...s?.trim } });

// The window compaction on its own counts on: the model's, else the one set for an unknown window
// (none when that is 0: then it does not compact on its own).
export const compactionWindow = (known: number | undefined, cfg: ReturnType<typeof compactionOf>) => known || (cfg.defaultWindow > 0 ? cfg.defaultWindow : undefined);

const note = (what: string, chars: number) => text('compaction.trimmed', { what, chars: chars.toLocaleString('en-US') });

type ToolResultPart = Extract<Part, { type: 'tool_result' }>;

// The tool each call in the messages is to, by the call's id.
export const callNames = (messages: Message[]) =>
  new Map(messages.flatMap((m) => m.parts.flatMap((p) => (p.type === 'tool_call' ? [[p.id, p.name] as const] : []))));

// A tool result's own content, and what went after it between the model's steps (memory, bookmarks),
// which stays when the result is cut: by compaction as by the shortening during a turn (context/in-run).
export function splitAttached(p: ToolResultPart): { own: string; after: string } {
  const attached = (p.attached ?? []).map((a) => `\n\n${a.text}`).join('');
  const after = attached && p.content.endsWith(attached) ? attached : '';
  return { own: p.content.slice(0, p.content.length - after.length), after };
}

// How a note names a call's result.
export const resultWhat = (name: string | undefined) => `the result of ${name ? toWireName(name) : 'a tool'}`;

// The messages with what `parts` says left out, each with a note of what it was.
export function trimMessages(messages: Message[], parts: CompactionParts): Message[] {
  const names = callNames(messages);
  const trim = (p: Part, role: Message['role']): Part => {
    if (p.type === 'text' && p.context === 'page' && parts.pages && p.text.length > KEEP_CHARS) return { ...p, text: note('page content', p.text.length) };
    // Site skills and memory: what goes once per conversation goes again with your next message while it
    // applies, as it is judged on what the model still sees whole (seenWhole).
    if (p.type === 'text' && (p.context === 'skill' || p.context === 'memory') && parts.attached && p.text.length > KEEP_CHARS) return { ...p, text: note(attachedWhat(p), p.text.length) };
    if (p.type === 'text' && !p.context && role === 'assistant' && parts.replies && p.text.length > REPLY_CHARS) {
      return { ...p, text: `${p.text.slice(0, REPLY_HEAD)}\n${note('the rest of this reply', p.text.length - REPLY_HEAD)}` };
    }
    if (p.type === 'tool_call' && parts.toolArgs) {
      const args = JSON.stringify(p.args ?? {}).length;
      return args > KEEP_CHARS ? { ...p, args: { left_out: note('the arguments of this call', args) } } : p;
    }
    // Your images go with the screenshots.
    if (p.type === 'image' && p.data && parts.screenshots) return { type: 'text', context: 'page', text: note('an image', p.data.length) };
    if (p.type !== 'tool_result') return p;
    const shots = parts.screenshots ? (p.images ?? []) : [];
    // What went after it between the model's steps (memory, bookmarks) stays, as with a message: only
    // the tool's own result is cut.
    const { own, after } = splitAttached(p);
    const long = parts.toolResults && own.length > KEEP_CHARS;
    if (!shots.length && !long) return p;
    const content = long ? note(resultWhat(names.get(p.toolCallId)), own.length) + after : p.content;
    if (!shots.length) return { ...p, content };
    // A screenshot's size is that of the image as it is sent (base64).
    const { images: _images, ...rest } = p;
    return { ...rest, content: [content, ...shots.map((i) => note('a screenshot', i.data.length))].join('\n') };
  };
  return messages.map((m) => ({ ...m, parts: m.parts.map((p) => trim(p, m.role)) }));
}

const attachedWhat = (p: Extract<Part, { type: 'text' }>) =>
  p.context === 'memory' ? 'memory items'
  : p.source?.startsWith(SKILL_MENTION_SOURCE) ? `the skill ${p.source.slice(SKILL_MENTION_SOURCE.length)}`
  : p.source ? `the site skill ${p.source}` : 'a site skill';

const summaryPart = (turns: number, summary: string): Part => ({ type: 'text', context: 'summary', source: 'compaction', text: text('compaction.summary', { turns: String(turns), summary }) });

// The latest plan, with steps to do, when what goes to the model (`out`) no longer has it: from the
// whole history, so it holds through every compaction. On the message the last compaction is on.
function withPlanKept(out: Message[], history: Message[]): Message[] {
  const plan = latestPlan(history);
  if (!plan || plan.dismissed || planDone(plan.steps) || latestPlan(out)?.id === plan.id) return out;
  const at = out.findLastIndex((m) => m.compaction);
  const part: Part = { type: 'text', context: 'summary', source: COMPACTION_PLAN_SOURCE, text: text('compaction.plan', { plan_steps: planStepLines(plan.steps) }) };
  const [first, ...rest] = out[at]!.parts;
  const parts = first?.type === 'text' && first.context === 'summary' ? [first, part, ...rest] : [part, ...out[at]!.parts];
  return out.map((m, i) => (i === at ? { ...m, parts } : m));
}

// The messages as they go to the model: before each compaction, the turns trimmed, or its summary in
// their place (with the message it is on); the later ones, as they are; the plan they took, if any.
export function compactedView(messages: Message[]): { messages: Message[]; summarized: boolean } {
  if (!messages.some((m) => m.compaction)) return { messages, summarized: false };
  let out: Message[] = [];
  let summarized = false;
  // The messages a compaction keeps but trims too (its `inner`): from where, how many, what.
  let inner: { from: number; count: number; parts: CompactionParts } | undefined;
  const trimInner = () => {
    if (!inner) return;
    const { from, count, parts } = inner;
    const trimmed = trimMessages(out, parts); // all of them, for the tools' names
    out = out.map((m, j) => (j >= from && j < from + count ? trimmed[j]! : m));
    inner = undefined;
  };
  for (const m of messages) {
    if (!m.compaction) {
      out.push(m);
      continue;
    }
    trimInner();
    const c = m.compaction;
    if (c.summary) {
      out = [{ ...m, parts: [summaryPart(c.turns, c.summary), ...m.parts] }];
      summarized = true;
    } else out = [...trimMessages(out, c.trimmed), m];
    if (c.inner) inner = { from: out.length - 1, count: c.inner, parts: c.trimmed };
  }
  trimInner();
  return { messages: withPlanKept(out, messages), summarized };
}

// What the model still sees whole of what was attached, for what goes once per conversation (site
// skills, memory, auto-attach): the messages compacted, without the context parts compaction trimmed
// (a summary leaves out every message before it). The parts it leaves whole are the stored ones, so a
// part not among them was trimmed. What went after a tool's result stays, as compaction keeps it.
export function seenWhole(history: Message[]): Message[] {
  const { messages } = compactedView(history);
  if (messages === history) return history;
  const stored = new Set(history.flatMap((m) => m.parts));
  return messages.map((m) => ({ ...m, parts: m.parts.filter((p) => p.type !== 'text' || !p.context || stored.has(p)) }));
}

// The request as the model gets it, for the provider and the estimates alike: the messages
// compacted (compactedView), what they repeat of what the model still sees whole as notes
// (context/dedupe), the system prompt saying what a summary is once there is one, and
// before your message after a turn you stopped, a note that it was stopped (or interrupted by it). Tool
// calls left without results (core/messages answerToolCalls) get one.
export function modelView(system: string | undefined, history: Message[]): { system?: string; messages: Message[] } {
  const compacted = compactedView(answerToolCalls(history));
  const { summarized } = compacted;
  // What the model still sees whole earlier goes again as a note (Settings → Compaction → Don't resend).
  const messages = dedupeContext(compacted.messages, dedupeNow());
  return {
    system: summarized ? [system, text('system.compaction')].filter(Boolean).join('\n\n') : system,
    messages: messages.some((m) => m.stopped || m.cut) ? messages.map((m, i) => (m.role === 'user' ? afterCut(m, messages[i - 1]) : m)) : messages,
  };
}

// Your message after a turn you stopped, or one cut as the model kept repeating itself: the model is told first.
function afterCut(m: Message, before: Message | undefined): Message {
  const note = before?.stopped ? text(stoppedNote(before)) : before?.cut ? text('user.repetition_cut', { fragment: fragmentShown(before.cut) }) : undefined;
  return note ? { ...m, parts: [{ type: 'text', text: `${note}\n` }, ...m.parts] } : m;
}

// The note after a turn you stopped: with Stop, or by sending a message at once.
export const stoppedNote = (m: Message) => (m.interrupted ? 'user.interrupted' : 'user.stopped');

// Whether the message at `i` starts a turn: yours, after one that is not.
const startsTurn = (m: Message, i: number, all: Message[]) => m.role === 'user' && all[i - 1]?.role !== 'user';
// How many turns start before `at`.
const turnsBefore = (history: Message[], at: number) => history.slice(0, at).filter(startsTurn).length;

// Where a compaction would go: on the first message of the latest `keepTurns` turns, after the last
// compaction; none when there is nothing before it to compact.
export function compactionPoint(history: Message[], keepTurns: number): number | undefined {
  const starts = history.flatMap((m, i, all) => (startsTurn(m, i, all) ? [i] : []));
  const at = starts.at(-Math.max(1, keepTurns));
  const last = history.findLastIndex((m) => m.compaction);
  if (at === undefined || at <= 0 || at <= last) return undefined;
  return at;
}

// The turns before `at` as they go now, trimmed: what they weigh before and after, and how many turns.
export function trimmedAt(history: Message[], at: number, parts: CompactionParts) {
  const before = compactedView(history.slice(0, at)).messages;
  const trimmed = trimMessages(before, parts);
  const turns = turnsBefore(history, at);
  return { before, trimmed, turns, tokensBefore: messagesTokens(before), tokensAfter: messagesTokens(trimmed) };
}

// The history with the compaction on the message at `at`.
export const withCompaction = (history: Message[], at: number, compaction: Compaction) => history.map((m, i) => (i === at ? { ...m, compaction } : m));

// The messages a compaction leaves whole at the end of the conversation: the latest tool round or so.
const KEEP_LAST = 4;

// What a compaction would leave, and where that puts the context against its target.
interface CompactionStep {
  at: number; // the message it goes on
  turns: number;
  inner: number;
  summarize: boolean; // a model is to summarize the turns before `at`
  before: number; // tokens of the conversation's messages now
  after: number; // and after it (a summary of maxWords, while there is none)
  short?: Compaction['short'];
}

// How to compact: toward a target (half the threshold of the window, when the window is known),
// each step only when the one before does not reach it: the turns before the latest `keepTurns`
// trimmed, then summarized; then the same keeping fewer turns whole, down to one; then, in the turn
// left, all but the last few messages trimmed too. None reaching it: the last, and by how much it
// falls short. Without a window: as `keepTurns` says, summarized only when asked for (`auto` false).
// `used`: the context's tokens now (reported, else estimated), so that what the messages do not
// account for (the system prompt and the tools) counts as fixed. `force`: a summarizing step, as the
// compaction has instructions for its summary (chat.compact), unless summaries are off.
export function compactionStep(
  history: Message[],
  cfg: ReturnType<typeof compactionOf>,
  ctx: { used: number; window?: number; canSummarize: boolean; auto: boolean; ratio?: number; force?: boolean },
): CompactionStep | undefined {
  // Estimated, as corrected for the model (context/token-ratio): `used` is what its server reported.
  const tokensOf = (ms: Message[]) => corrected(messagesTokens(ms), ctx.ratio);
  const before = tokensOf(compactedView(history).messages);
  const fixed = Math.max(0, ctx.used - before);
  const last = history.findLastIndex((m) => m.compaction);
  const placeholder = 'word '.repeat(cfg.maxWords).trim();
  const step = (at: number, inner: number, summarize: boolean): CompactionStep => {
    const turns = turnsBefore(history, at);
    const compaction: Compaction = { at: 0, turns, trimmed: cfg.trim, before, after: 0, ...(inner && { inner }), ...(summarize && { summary: placeholder }) };
    return { at, turns, inner, summarize, before, after: tokensOf(compactedView(withCompaction(history, at, compaction)).messages) };
  };
  // A step that saves nothing (what it would trim is already short, and no summary) is none: it would
  // only put a compaction in the history with nothing to show for it.
  const saves = (c: CompactionStep) => c.summarize || c.after < c.before;
  if (!ctx.window) {
    const at = compactionPoint(history, cfg.keepTurns);
    const only = at === undefined ? undefined : step(at, 0, cfg.summarize && ctx.canSummarize && (!ctx.auto || !!ctx.force));
    return only && saves(only) ? only : undefined;
  }
  const summarize = cfg.summarize && ctx.canSummarize;
  const candidates: CompactionStep[] = [];
  for (let keep = cfg.keepTurns; keep >= 1; keep--) {
    const at = compactionPoint(history, keep);
    if (at === undefined || candidates.some((c) => c.at === at)) continue;
    candidates.push(step(at, 0, false));
    if (summarize) candidates.push(step(at, 0, true));
  }
  // The turn left: from its first message (yours), all but the last few.
  const latest = history.findLastIndex(startsTurn);
  const inner = history.length - latest - KEEP_LAST;
  if (latest >= 0 && latest > last && inner > 0) candidates.push(step(latest, inner, summarize && latest > 0));
  const useful = candidates.filter(saves);
  if (!useful.length) return undefined;
  const target = (ctx.window * cfg.threshold) / 200;
  const summarizing = useful.filter((c) => c.summarize);
  const among = ctx.force && summarizing.length ? summarizing : useful;
  const chosen = among.find((c) => fixed + c.after <= target) ?? among.at(-1)!;
  return { ...chosen, ...shortOf(fixed + chosen.after, target, fixed, ctx.window) };
}

// Where a compaction left the context, when that is over its target: in % of the window.
export const shortOf = (total: number, target: number, fixed: number, window: number) =>
  total > target ? { short: { percent: Math.round((total / window) * 100), target: Math.round((target / window) * 100), fixed: Math.round((fixed / window) * 100) } } : {};

// What Compact now tells of the part of the context compaction cannot shorten (the system prompt and the
// tools' definitions, `fixed`), against all of it (`used`): its share, and past FIXED_ADVISED of it,
// what makes room instead. Empty when unknown, and with `onlyAdvised` under FIXED_ADVISED.
const FIXED_ADVISED = 0.3;
const tokensShown = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString('en-US'));
export function fixedNote(fixed: { system: number; tools: number } | undefined, used: number, onlyAdvised = false): string {
  if (!fixed || !(used > 0)) return '';
  const share = Math.min(1, (fixed.system + fixed.tools) / used);
  if (onlyAdvised && share < FIXED_ADVISED) return '';
  const what = `${Math.round(share * 100)}% of the context is the system prompt and the tools (system ${tokensShown(fixed.system)}, tools ${tokensShown(fixed.tools)}), which compaction cannot shorten`;
  return share >= FIXED_ADVISED ? `${what}: turn off MCP servers or tools, or set servers to their tools on demand (Settings → MCP servers).` : `${what}.`;
}

// What Compact now says when it compacted nothing: why, and what the fixed part weighs.
export function nothingToCompactNote(windowKnown: boolean, keepTurns: number, fixed: string): string {
  const why = windowKnown ? 'no earlier turns, and the latest is short' : `the latest ${keepTurns} ${keepTurns === 1 ? 'turn is' : 'turns are'} kept whole`;
  return [`Nothing to compact: ${why}.`, fixed].filter(Boolean).join(' ');
}

// What Compact now says once it compacted: the conversation's tokens before and after, and that the meter
// (the last call's) shows it from the next request.
export function compactedNote(what: string, before: number, after: number, fixed: string): string {
  return [`Compacted ${what}: the conversation from about ${tokensShown(before)} to ${tokensShown(after)} tokens. The context meter shows it after the next request.`, fixed].filter(Boolean).join(' ');
}

// The conversation's messages' tokens once compacted so.
export const compactedTokens = (history: Message[], at: number, compaction: Compaction) => messagesTokens(compactedView(withCompaction(history, at, compaction)).messages);

// The model's chat.compact call in the latest turn, finished and not stopped (one waiting at the step
// limit goes on with the same turn), with no compaction made after it: the side panel compacts with
// its instructions (the last call's). None: nothing to compact for.
const COMPACT_TOOL = toWireName('chat.compact');
export function compactCall(history: Message[]): { instructions?: string } | undefined {
  const last = history.at(-1);
  if (!last || last.role !== 'assistant' || last.stopped || last.parts.some((p) => p.type === 'tool_call')) return undefined;
  const start = history.findLastIndex(startsTurn);
  const failed = new Set(history.slice(Math.max(0, start)).flatMap((m) => m.parts.flatMap((p) => (p.type === 'tool_result' && p.isError ? [p.toolCallId] : []))));
  for (let i = history.length - 1; i > start; i--) {
    const call = history[i]!.parts.findLast((p) => p.type === 'tool_call' && toWireName(p.name) === COMPACT_TOOL && !failed.has(p.id));
    if (call?.type !== 'tool_call') continue;
    if (history.some((m) => (m.compaction?.ranAfter ?? 0) > i)) return undefined;
    const { instructions } = (call.args ?? {}) as { instructions?: unknown };
    const given = typeof instructions === 'string' ? instructions.trim() : '';
    return given ? { instructions: given } : {};
  }
  return undefined;
}
