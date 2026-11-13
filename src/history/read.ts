// Saved conversations as the model reads them (history.search, history.read and # mentions): a
// transcript of what was written, inside an untrusted block, since it may quote web pages. Ids are
// the first characters of a conversation's id; mentions use its title as a slug.
import { markValue, stripMarks, text, truncate } from '../core/model-texts';
import { slugOf } from '../core/sources';
import { isoDate } from '../core/util';
import { firstMatch, type MatchOptions } from '../search/bm25';
import { listConversations, loadConversation, searchableText, type Conversation, type ConversationMeta } from './store';
import { searchConversations } from './search';

const SHORT_ID = 8;
const shortId = (id: string) => id.slice(0, SHORT_ID);

// What was written, marked as coming from a saved conversation (its old marks out).
const clean = (s: string) => markValue(stripMarks(s).trim(), 'history');

// What was written, line by line; with `full`, also the tool results and the attached context.
export function transcriptOf(conv: Pick<Conversation, 'history'>, full = false): string {
  const toolNames = new Map(conv.history.flatMap((m) => m.parts.flatMap((p) => (p.type === 'tool_call' ? [[p.id, p.name] as const] : []))));
  const lines: string[] = [];
  for (const m of conv.history) {
    for (const p of m.parts) {
      if (p.type === 'text' && p.text.trim()) {
        if (p.context) {
          if (full) lines.push(text('history.line_tool_result', { tool: 'attached context', result: clean(p.text) }));
        } else lines.push(text(m.role === 'user' ? 'history.line_user' : 'history.line_assistant', { text: clean(p.text) }));
      }
      if (p.type === 'tool_result' && full) lines.push(text('history.line_tool_result', { tool: toolNames.get(p.toolCallId) ?? 'tool', result: clean(p.content) }));
    }
    const calls = m.parts.flatMap((p) => (p.type === 'tool_call' ? [p.name] : []));
    if (calls.length) lines.push(text('history.line_tools', { tools: calls.join(', ') }));
  }
  return lines.join('\n');
}

// The conversation in its untrusted block, marked as a saved conversation for Layers; attached to a
// message, its transcript is cut to Settings → Limits.
export function readBlock(conv: Conversation, full = false, attached = false): string {
  const transcript = transcriptOf(conv, full);
  return text('result.history_read', {
    id: shortId(conv.id),
    title: conv.title,
    date: isoDate(conv.createdAt),
    site: conv.site ?? '',
    transcript: attached ? truncate(transcript, 'historyAttach') : transcript,
  });
}

// Around the first of the query's words found, in one line.
export function snippetOf(conv: Conversation, query: string, options?: MatchOptions): string {
  const body = searchableText(conv).replace(/\s+/g, ' ');
  const at = Math.max(0, firstMatch(body, query, options));
  return body.slice(Math.max(0, at - 60), at + 100).trim();
}

// history.search: the best matches first (search/bm25), without the conversation it is asked from.
export async function searchResult(query: string, limit: number, currentId?: string): Promise<string> {
  const matches = query.trim() ? await searchConversations(query, { except: currentId, limit }) : [];
  if (!matches.length) return text('result.history_no_match', { query });
  const results = matches.map((c) =>
    text('result.history_result_line', {
      id: shortId(c.id),
      title: c.title,
      date: isoDate(c.updatedAt),
      site: c.site ?? '—',
      turns: String(c.turns),
      snippet: markValue(snippetOf(c, query), 'history'),
    }),
  );
  return text('result.history_results', { count: String(matches.length), query, results: results.join('\n') });
}

// A conversation by its id or the start of it, at least as long as the ids listed (an empty or
// shorter one would just pick the latest).
export async function findConversation(id: string): Promise<Conversation | undefined> {
  const start = id.trim();
  if (start.length < SHORT_ID) return undefined;
  const meta = (await listConversations()).find((c) => c.id.startsWith(start));
  return meta && loadConversation(meta.id);
}

// A # mention's conversation: the latest whose title gives that slug, other than the current one.
export async function conversationBySlug(slug: string, currentId?: string): Promise<ConversationMeta | undefined> {
  return (await listConversations()).find((c) => c.id !== currentId && slugOf(c.title) === slug);
}
