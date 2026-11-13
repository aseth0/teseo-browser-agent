// The requests behind a conversation: where each call to the model went out and what it carried
// (every message tagged as resent or new), and what came back. Shared by Prompt preview's "Preview
// conversation" (a simulated chat) and the side panel's "Layers" view (the real one): the calls
// themselves here, their sections in CallSection, and the chat they hang under in ChatWithCalls.
import { pieceLabel } from '../../context/pieces';
import { compactedView, stoppedNote } from '../../context/compaction';
import { estimatedInput, estimateRequest } from '../../context/usage';
import { text, TEXT_DEFS } from '../../core/model-texts';
import type { AutoAttachCheck, Message, ToolSpec } from '../../core/types';
import { historyAutoOf } from '../../context/sources';
import { toOpenAIMessages, toOpenAITools, type WireMessage } from '../../providers/wire';
import type { RequestViewOf } from '../../context/request-view';

export interface Call {
  title: string;
  why: string;
  history: Message[]; // what this call sends after the system message
  at: number; // in the chat, the call goes out after this many messages
}

// A user message of the tools' images (providers/wire), not one of yours.
const isToolImages = (w: WireMessage) => Array.isArray(w.content) && w.content[0]?.type === 'text' && w.content[0].text === text('result.images_caption');

export interface CallView extends Call {
  total: number;
  clean: WireMessage[];
  marked: WireMessage[]; // the same messages with the origin marks, when there are any
  pieces: (Pieces | undefined)[]; // for each of your messages in `marked`: what you typed and each block attached
  resent: number; // how many of its messages the previous call already sent
  body: unknown; // the request body
}

export interface Piece {
  label: string;
  text: string; // with the origin marks
}

// A message's pieces, and when nothing was attached to it, why (as far as it is known).
export interface Pieces {
  list: Piece[];
  nothingAttached?: string;
  autoAttach?: string; // what the auto-attach found, when it attached nothing
}

const NOTHING_ATTACHED: Record<'off' | 'unreadable' | 'unknown', string> = {
  off: 'Nothing attached: "Page" was off, and no site skill, template or mention applied.',
  unreadable: 'Nothing attached: the tab could not be read, and no site skill, template or mention applied.',
  unknown: 'Nothing attached: no page block, site skill, template or mention.',
};

// Your messages' pieces (context/pieces), lined up with the request's messages: the user messages
// with text are yours, in order (images go in user messages of their own).
function piecesByMessage(history: Message[], wire: WireMessage[]): (Pieces | undefined)[] {
  const yours = history.flatMap((m, i) => (m.role === 'user' ? [i] : []));
  let next = 0;
  return wire.map((w) => {
    if (w.role !== 'user' || isToolImages(w)) return undefined;
    const at = yours[next++];
    if (at === undefined) return undefined;
    const m = history[at]!;
    // After a turn you stopped, the note the model gets before your message (context/compaction).
    const before = history[at - 1];
    const note = before?.stopped && stoppedNote(before);
    const stopped = note ? [{ label: TEXT_DEFS[note].label, text: text(note) }] : [];
    const list = [...stopped, ...m.parts.flatMap((p) =>
      p.type === 'text' && p.text.trim() ? [{ label: pieceLabel(p), text: p.text }]
      : p.type === 'image' ? [{ label: 'Your image', text: p.data ? `[${p.mediaType}, ${Math.round((p.data.length * 3) / 4 / 1024)} KB]` : text('user.image_not_kept') }]
      : [])];
    const attached = m.parts.some((p) => p.type === 'text' && p.context);
    const autoAttached = m.parts.some((p) => p.type === 'text' && historyAutoOf(p.source));
    return {
      list,
      ...(!attached && { nothingAttached: NOTHING_ATTACHED[m.pageSkipped ?? 'unknown'] }),
      ...(m.autoAttach && !autoAttached && { autoAttach: autoAttachNote(m.autoAttach) }),
    };
  });
}

const autoAttachNote = ({ threshold, scope, best }: AutoAttachCheck) =>
  best
    ? `Auto-attach: the best ${scope === 'pinned' ? 'pinned ' : ''}match, "${best.title}", covers ${best.match}% of your message (it needs ${threshold}%).`
    : `Auto-attach: no ${scope === 'pinned' ? 'pinned ' : 'saved '}conversation has any of your message's words.`;

export const contentOf = (m: WireMessage) =>
  Array.isArray(m.content) ? m.content.map((p) => (p.type === 'text' ? p.text : '[image]')).join('\n')
  : m.content ?? (m.tool_calls ?? []).map((c) => `calls ${c.function.name} ${c.function.arguments}`).join('\n');

// The requests as they were (or would be) sent. `view`: what a request carries of its conversation,
// as the run builds it (context/request-view requestView). `marked` holds the same conversation with
// the origin marks (built inside withMarkedValues, or a real one the background marked), for the
// colors; without it, the marks the history itself carries are shown.
export interface CallOptions {
  system: string;
  specs: ToolSpec[];
  head: Record<string, unknown>;
  view: RequestViewOf;
  marked?: { system: string; calls: Call[] };
}

// A call's messages on the wire, as the model gets them.
function wireOf(view: RequestViewOf, system: string | undefined, history: Message[], options: { keepMarks?: boolean } = {}): WireMessage[] {
  const v = view(system, history);
  return toOpenAIMessages(v.system, v.messages, options);
}

const compactions = (history: Message[]) => history.filter((m) => m.compaction).length;

// One set of options for every call, or each call's own (the chat's, when the agent changed).
export function toCallViews(calls: Call[], options: CallOptions | ((call: Call) => CallOptions)): CallView[] {
  let before: { system: string; clean: WireMessage[] } | undefined; // the call before, as it went
  return calls.map((call, i) => {
    const opts = typeof options === 'function' ? options(call) : options;
    const tools = toOpenAITools(opts.specs);
    const shown = opts.marked ?? { system: opts.system, calls };
    const view = opts.view(opts.system, call.history);
    const clean = toOpenAIMessages(view.system, view.messages);
    const marked = wireOf(opts.view, shown.system, shown.calls[i]!.history, { keepMarks: true });
    // The call before's messages with this call's system prompt: those it sent, unless the agent changed.
    const sentBefore = () => (before?.system === opts.system ? before.clean.length : wireOf(opts.view, opts.system, calls[i - 1]!.history).length);
    const resent = i === 0 || compactions(call.history) !== compactions(calls[i - 1]!.history) ? 0 : sentBefore();
    before = { system: opts.system, clean };
    return {
      ...call,
      total: estimatedInput(estimateRequest(view.system, opts.specs, view.messages)),
      clean,
      marked,
      // Lined up with the messages as they went (compacted: the summary is a piece of the first).
      pieces: piecesByMessage(compactedView(shown.calls[i]!.history).messages, marked),
      // Compacted since the call before: none of its messages went the same.
      resent,
      body: { ...opts.head, messages: clean, tools },
    };
  });
}

// The calls of a real conversation: one after each of your messages and after each round of
// tool results, as long as the model answered (or is answering) it.
export function callsOf(history: Message[]): Call[] {
  const calls: Call[] = [];
  history.forEach((m, i) => {
    if ((m.role !== 'user' && m.role !== 'tool') || history[i + 1]?.role === m.role) return;
    const n = calls.length + 1;
    const why =
      m.role === 'user'
        ? 'Your message, with the page block and site skills attached, after everything before it.'
        : 'The tools ran: their results are sent with everything before them.';
    calls.push({ title: `Call ${n} · ${m.role === 'user' ? 'your message' : 'after the tools ran'}`, why, history: asSent(history.slice(0, i + 1)), at: i + 1 });
  });
  return calls;
}

// A call's messages as it sent them: without the compactions that ran after it went (one saved
// before `ranAfter` existed stays, as when it ran is unknown).
const asSent = (history: Message[]): Message[] =>
  history.map((m) => {
    if (!m.compaction?.ranAfter || m.compaction.ranAfter < history.length) return m;
    const { compaction: _later, ...sent } = m;
    return sent;
  });

// Which bubble a call hangs under: your message it sent; else (after the tools ran) the answer that
// asked for those tools, since tool results have no bubble of their own.
export function bubbleOf(chat: Message[], call: Call): number {
  const last = call.at - 1;
  if (chat[last]?.role === 'user') return last;
  const asked = chat.findLastIndex((m, i) => i < last && m.role === 'assistant');
  return asked < 0 ? last : asked;
}

// The answer to a call: the first message of the model after it.
export const answerTo = (chat: Message[], call: Call) => chat.slice(call.at).find((m) => m.role === 'assistant');
