import { text } from './model-texts';
import type { LiveSegment } from './live';
import type { ContextKind, Message, Part, SystemMemory } from './types';

export interface ContextItem {
  kind: ContextKind;
  text: string;
  source?: string; // e.g. the site skill whose full instructions this is
}

// Every context part the conversation has had, as text parts: those attached to the user's messages and
// those attached after a tool's result, between the model's steps. What attaches on its own skips these.
type TextPart = Extract<Part, { type: 'text' }>;
// A text as the chat shows it (Part shown); the model always gets its text.
export const shownText = (p: TextPart) => p.shown ?? p.text;
// A notice from an agent of the Agents Panel (Part from), not a message the user wrote.
export const isPanelNotice = (m: Message) => m.role === 'user' && m.parts.some((p) => p.type === 'text' && p.from === 'panel');
// Its line, as the chat and the Markdown export show it.
export const noticeLine = (m: Message) => `↳ ${m.parts.flatMap((p) => (p.type === 'text' && p.from === 'panel' ? [shownText(p)] : [])).join(' ')}`;
export function attachedParts(history: Message[]): TextPart[] {
  return history.flatMap((m) =>
    m.parts.flatMap((p): TextPart[] =>
      p.type === 'text' ? [p] : p.type === 'tool_result' ? (p.attached ?? []).map((a) => ({ type: 'text', text: a.text, context: a.kind, ...(a.source && { source: a.source }) })) : [],
    ),
  );
}

// Appends extension-provided context (site skills, page) to the last user message as
// hidden text parts. Used by the background (for the request) and the panel (to keep the
// history append-only), so both must produce exactly the same message.
export function appendContext(history: Message[], items: ContextItem[]): Message[] {
  const last = history.at(-1);
  if (last?.role !== 'user' || !items.length) return history;
  const parts = items.map((c) => ({ type: 'text' as const, text: c.text, context: c.kind, ...(c.source && { source: c.source }) }));
  return [...history.slice(0, -1), { ...last, parts: [...last.parts, ...parts] }];
}

// The memory part of the system prompt kept from now on, on your latest message (Message.systemMemory).
// Used by the background and the panel alike, as appendContext.
export function keepSystemMemory(history: Message[], memory: SystemMemory): Message[] {
  const at = history.findLastIndex((m) => m.role === 'user');
  return at < 0 ? history : history.map((m, i) => (i === at ? { ...m, systemMemory: memory } : m));
}

// The user stopped the turn: what was being streamed stays as the model's last message, tool calls
// left without results get one (a call without its result is rejected by the servers; one that was
// running may have taken effect, so it does not say it did not run), and the last message is
// marked so the model is told on the next turn (context/compaction, modelView). `interrupted`: by a
// message sent at once, not by Stop. `ended`: the results of the calls that ended before it (core/agent-loop
// onResult), kept for their calls instead.
export function markStopped(history: Message[], streamed: LiveSegment[], interrupted = false, ended: Part[] = []): Message[] {
  const out = [...history];
  const last = out.at(-1);
  const answered = new Set(out.flatMap((m) => m.parts.flatMap((p) => (p.type === 'tool_result' ? [p.toolCallId] : []))));
  const unanswered = last?.role === 'assistant' ? last.parts.filter((p): p is Extract<Part, { type: 'tool_call' }> => p.type === 'tool_call' && !answered.has(p.id)) : [];
  if (unanswered.length) {
    const result = (id: string) => ended.find((p) => p.type === 'tool_result' && p.toolCallId === id);
    out.push({
      role: 'tool',
      parts: unanswered.map((c): Part => result(c.id) ?? { type: 'tool_result', toolCallId: c.id, content: text('result.stopped'), isError: true }),
    });
  }
  const parts = streamed.filter((s) => s.text).map((s): Part => ({ type: s.kind, text: s.text }));
  if (parts.length) out.push({ role: 'assistant', parts });
  const end = out.at(-1);
  if (end) out[out.length - 1] = { ...end, stopped: true, ...(interrupted && { interrupted }) };
  return out;
}

// Tool calls left without results anywhere in the history get one, as markStopped gives them, after the
// results their message did get: a conversation saved by an older build when the agent was lost mid-tool
// ends a turn that way, and the servers reject every later request with it. Unchanged when none is.
export function answerToolCalls(history: Message[]): Message[] {
  const answered = new Set(history.flatMap((m) => m.parts.flatMap((p) => (p.type === 'tool_result' ? [p.toolCallId] : []))));
  if (!history.some((m) => m.role === 'assistant' && m.parts.some((p) => p.type === 'tool_call' && !answered.has(p.id)))) return history;
  const out: Message[] = [];
  let pending: Extract<Part, { type: 'tool_call' }>[] = [];
  const flush = () => {
    if (pending.length) out.push({ role: 'tool', parts: pending.map((c): Part => ({ type: 'tool_result', toolCallId: c.id, content: text('result.stopped'), isError: true })) });
    pending = [];
  };
  for (const m of history) {
    if (m.role !== 'tool') flush();
    out.push(m);
    if (m.role === 'assistant') pending = m.parts.filter((p): p is Extract<Part, { type: 'tool_call' }> => p.type === 'tool_call' && !answered.has(p.id));
  }
  flush();
  return out;
}
