// What was cut of a tool result or an attached file, kept whole for tools.read_more by the id its cut
// note gives: the last KEPT_PER_CONVERSATION of each of the last KEPT_CONVERSATIONS conversations, in
// the background's memory only (gone when the service worker restarts: tools.read_more says so).
import { clip, type Clipped } from './clip';
import { limit, type LimitId } from './limits';
import { markValue, stripMarks } from './origin-marks';
import { pastEnd, withReadMore } from './truncate';

export const KEPT_PER_CONVERSATION = 20;
export const KEPT_CONVERSATIONS = 10;

// A text kept whole: what it came from (a tool's dotted name, an attached file's source), the limit it
// was cut at, and where its next part starts. `breaks`: where its parts may end, when in the second
// half of one (the starts of a PDF's pages, core/pdf-pages).
export interface KeptText {
  id: string;
  text: string;
  source: string;
  limit: LimitId;
  next: number;
  breaks?: number[];
}

const kept = new Map<string, Map<string, KeptText>>(); // by conversation ('' for a run without one), oldest first

const keptId = () => crypto.randomUUID().slice(0, 8);

export function keep(conversationId: string | undefined, entry: KeptText): void {
  const key = conversationId ?? '';
  const own = kept.get(key) ?? new Map<string, KeptText>();
  kept.delete(key); // the latest conversation goes last
  kept.set(key, own);
  own.set(entry.id, entry);
  while (own.size > KEPT_PER_CONVERSATION) own.delete(own.keys().next().value!);
  while (kept.size > KEPT_CONVERSATIONS) kept.delete(kept.keys().next().value!);
}

export const keptText = (conversationId: string | undefined, id: string) => kept.get(conversationId ?? '')?.get(id);

// `s` from `from`, at most `max`: cut at the last of its `breaks` in the second half of the part, if any.
function clipAt(s: string, max: number, from: number, breaks: number[] | undefined): Clipped {
  const c = clip(s, max, from);
  if (!c.truncated || !breaks) return c;
  const start = c.end! - c.text.length;
  const at = breaks.findLast((b) => b <= c.end! && b - start >= max / 2);
  return at === undefined ? c : { ...c, text: s.slice(start, at), end: at };
}

// `s` cut at the limit, with the note tools.read_more reads on by; when cut, the text to keep.
export function cutForReadMore(s: string, limitId: LimitId, source: string, { max = limit(limitId), breaks }: { max?: number; breaks?: number[] } = {}): { text: string; kept?: KeptText } {
  const c = clipAt(s, max, 0, breaks);
  if (!c.truncated) return { text: s };
  const id = keptId();
  return { text: withReadMore(c, limitId, id), kept: { id, text: s, source, limit: limitId, next: c.end!, ...(breaks && { breaks }) } };
}

// The same, kept for the conversation: a tool's result (core/tool-exec, custom tools' answers).
export function cutAndKeep(s: string, limitId: LimitId, { conversationId, source, max }: { conversationId?: string; source: string; max?: number }): string {
  const cut = cutForReadMore(s, limitId, source, { max });
  if (cut.kept) keep(conversationId, cut.kept);
  return cut.text;
}

// The part of a kept text from `from` (none: where the last part read ended), at most `max`, cut
// again with its note; undefined when it is no longer kept. Past the end: an error, with its length.
// The part goes as the tool's, without the marks it had: it may start inside one.
export function readKept(conversationId: string | undefined, id: string, max: number, from?: number): { part: string; source: string } | undefined {
  const entry = keptText(conversationId, id);
  if (!entry) return undefined;
  const start = from ?? entry.next;
  if (start >= entry.text.length) throw new Error(pastEnd(start, entry.text.length));
  const c = clipAt(entry.text, max, start, entry.breaks);
  entry.next = c.end ?? entry.text.length;
  return { part: withReadMore({ ...c, text: markValue(stripMarks(c.text), 'tool') }, entry.limit, id), source: entry.source };
}

// For the tests: nothing kept.
export const clearKept = () => kept.clear();
