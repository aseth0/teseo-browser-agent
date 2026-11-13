// The history as the chat shows it, a turn at a time, and what is worked out of its messages (no React).
import { bookmarkAutoOf, MEMORY_SOURCE, memoryIndexOf, memoryMatchOf, PLAN_REMINDER_SOURCE } from '../../context/sources';
import { shownText } from '../../core/messages';
import { cutsIn, stripMarks } from '../../core/model-texts';
import type { Message, MessageMeta, Part } from '../../core/types';
import { fmtTokens, seconds, shortTokens } from '../Usage';

export type ToolResultPart = Extract<Part, { type: 'tool_result' }>;

// Tool results arrive in a later message; index them by call id to show them inside their call.
export function toolResultsById(history: Message[]): Map<string, ToolResultPart> {
  const map = new Map<string, ToolResultPart>();
  for (const m of history) for (const p of m.parts) if (p.type === 'tool_result') map.set(p.toolCallId, p);
  return map;
}

// A message shown in pieces (its answer apart, its texts between its steps) is a copy with some of
// its parts: the message of the history each piece comes from.
// The same parts of the same message give the same piece each time the chat is shown: its view is
// memoized by the message it shows (ui/chat/MessageView), and keyed by it.
const wholeOf = new WeakMap<Message, Message>();
const piecesOf = new WeakMap<Message, Message[]>();
const pieceOf = (m: Message, parts: Part[]): Message => {
  const made = piecesOf.get(m) ?? [];
  const same = made.find((piece) => piece.parts.length === parts.length && piece.parts.every((p, i) => p === parts[i]));
  if (same) return same;
  const piece = { ...m, parts };
  wholeOf.set(piece, wholeOf.get(m) ?? m);
  piecesOf.set(m, [...made, piece]);
  return piece;
};
export const whole = (m: Message) => wholeOf.get(m) ?? m;

export interface Turn {
  user?: Message;
  messages: Message[]; // the model's messages and tool results, as they came
  steps: Message[]; // those before its answer
  answer?: Message; // the text of its last message, when it ended the turn without calling tools
}

// The history in turns: each from one of your messages to the next.
export function turnsOf(history: Message[]): Turn[] {
  const turns: Turn[] = [];
  for (const m of history) {
    if (m.role === 'user') turns.push({ user: m, messages: [], steps: [] });
    else {
      if (!turns.length) turns.push({ messages: [], steps: [] });
      turns.at(-1)!.messages.push(m);
    }
  }
  for (const turn of turns) {
    turn.steps = turn.messages;
    const last = turn.messages.at(-1);
    if (last?.role !== 'assistant' || last.parts.some((p) => p.type === 'tool_call')) continue;
    const answer = last.parts.filter((p) => p.type === 'text');
    if (!answer.some((p) => p.type === 'text' && p.text.trim())) continue;
    turn.answer = pieceOf(last, answer);
    const before = last.parts.filter((p) => p.type !== 'text');
    turn.steps = before.length ? [...turn.messages.slice(0, -1), pieceOf(last, before)] : turn.messages.slice(0, -1);
  }
  return turns;
}

// The memory items of a site attached to a message (memory/prompt memorySiteItems): by site, their texts.
export function memoryAttached(message: Message): { host: string; items: string[] }[] {
  return message.parts.flatMap((p) =>
    p.type === 'text' && p.context === 'memory' && p.source?.startsWith(MEMORY_SOURCE) ? [{ host: p.source.slice(MEMORY_SOURCE.length), items: memoryItemsIn(p.text) }] : [],
  );
}

// The memory items of a site that went by title (memory/prompt memorySiteItems), by site.
export const memoryIndexAttached = (message: Message) => message.parts.flatMap((p) => (p.type === 'text' ? (memoryIndexOf(p.source) ?? []) : []));

// The texts of the memory items in a site's block, one per "- [id] text" line (memory.item).
const memoryItemsIn = (block: string) => stripMarks(block).split('\n').flatMap((l) => l.match(/^- \[[^\]]+\] (.*)$/)?.slice(1) ?? []);

// The titles of the memory items a part matched on its own (its source says them; an older one, read
// from its block).
const matchedTitles = (source: string | undefined, block: string) => {
  const matched = memoryMatchOf(source);
  return !matched ? [] : matched.titles.length ? matched.titles : memoryItemsIn(block);
};

// The memory items a message matched, attached on their own (memory/prompt memoryAutoItems).
export function memoryAutoAttached(message: Message): string[] {
  return message.parts.flatMap((p) => (p.type === 'text' && p.context === 'memory' ? matchedTitles(p.source, p.text) : []));
}

// What went after a tool's result on its own, between the model's steps (context/step-attach, plan-reminder): the
// memory items' titles, the bookmarks (their title, match and address) and the plan reminder.
export function stepAttached(result: ToolResultPart): { memory: string[]; bookmarks: { id: string; title: string; match: number; url?: string }[]; plan: string[] } {
  const attached = result.attached ?? [];
  return {
    memory: attached.flatMap((a) => (a.kind === 'memory' ? matchedTitles(a.source, a.text) : [])),
    bookmarks: attached.flatMap((a) => bookmarkAutoOf(a.source) ?? []),
    plan: attached.flatMap((a) => (a.source === PLAN_REMINDER_SOURCE ? [a.text] : [])),
  };
}

// An address the chat may link (a bookmark's): http(s) only, as a URL; any other (javascript:, file:…),
// or none that parses, undefined.
export function webUrlOf(url: string | undefined): URL | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : undefined;
  } catch {
    return undefined;
  }
}

// What you typed, without what the extension attached to it.
export const typedText = (m: Message) => m.parts.map((p) => (p.type === 'text' && !p.context ? shownText(p) : '')).filter(Boolean).join('\n');

// Tokens in and out over the turn's model calls, and how long the turn took.
export function turnStats(messages: Message[]): { label: string; detail: string } | undefined {
  const calls = messages.flatMap((m) => (m.meta ? [m.meta] : []));
  if (!calls.length) return undefined;
  const sum = (f: (c: MessageMeta) => number) => calls.reduce((a, c) => a + f(c), 0);
  const approx = calls.every((c) => c.reported) ? '' : '~';
  const ms = calls.at(-1)!.sinceStartMs;
  const label = `↑ ${approx}${shortTokens(sum((c) => c.input))} · ↓ ${approx}${shortTokens(sum((c) => c.output))} · ${seconds(ms)}`;
  const lines = calls.map((c, i) => {
    const first = c.firstTokenMs === undefined ? '' : ` · first token ${seconds(c.firstTokenMs)}`;
    return `Call ${i + 1}: ${fmtTokens(c.input)} in · ${fmtTokens(c.output)} out · ${seconds(c.ms)}${first}${c.reported ? '' : ' (estimated)'}`;
  });
  const head = `${calls.length === 1 ? '1 model call' : `${calls.length} model calls`}, ${seconds(ms)} from sending your message (reading the page and running tools included).`;
  return { label, detail: [head, ...lines, approx && '~ estimated: the server did not report usage.'].filter(Boolean).join('\n') };
}

// A turn's steps as shown grouped: what the model writes along the way stays in view, and each
// stretch of reasoning and tool calls between those texts is one collapsed block.
type Segment = { kind: 'text'; message: Message } | { kind: 'steps'; messages: Message[] };

export function segmentsOf(steps: Message[]): Segment[] {
  const out: Segment[] = [];
  let block: Message[] = [];
  const flush = () => {
    if (block.length) out.push({ kind: 'steps', messages: block });
    block = [];
  };
  for (const m of steps) {
    if (m.role !== 'assistant') {
      block.push(m); // tool results: shown inside their call
      continue;
    }
    let parts: Part[] = [];
    for (const p of m.parts) {
      if (p.type !== 'text' || !p.text.trim()) {
        parts.push(p);
        continue;
      }
      if (parts.length) block.push(pieceOf(m, parts));
      parts = [];
      flush();
      out.push({ kind: 'text', message: pieceOf(m, [p]) });
    }
    if (parts.length) block.push(pieceOf(m, parts));
  }
  flush();
  return out;
}

// What was cut to a size limit in the last turn: your message's context and the tool results since.
export function turnCuts(history: Message[]): string[] {
  const from = history.findLastIndex((m) => m.role === 'user');
  return history.slice(Math.max(0, from)).flatMap((m) =>
    m.parts.flatMap((p) => (p.type === 'text' ? cutsIn(p.text) : p.type === 'tool_result' ? cutsIn(p.content) : [])),
  );
}
