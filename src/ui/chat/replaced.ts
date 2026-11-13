// What the word blacklist replaced in what went to the model (word-blacklist/core), for the chat: a
// pill on your message and on a tool's result, listing by where it was each term and its placeholder.
// Only for what went masked: what the next answer of the model came from (Message.masked).
import { createContext } from 'react';
import { bookmarkAutoOf, fileOf, historyAutoOf, MEMORY_SOURCE } from '../../context/sources';
import type { Message, Part } from '../../core/types';
import type { Blacklist } from '../../word-blacklist/core';
import type { AutoGroup } from './AttachedChips';

type TextPart = Extract<Part, { type: 'text' }>;

export interface ReplacedView {
  blacklist?: Blacklist; // the terms as saved now
  masked: ReadonlySet<Message | Part>; // the messages, and their parts, that went masked
}
export const ReplacedContext = createContext<ReplacedView>({ masked: new Set() });

// Every message the model got masked: those before an answer of a masked request, up to the one before.
export function maskedItems(history: Message[]): Set<Message | Part> {
  const out = new Set<Message | Part>();
  let next = false; // the next answer after it is masked
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]!;
    if (m.role === 'assistant') next = !!m.masked;
    else if (next) {
      out.add(m);
      for (const p of m.parts) out.add(p);
    }
  }
  return out;
}

// Where a part of your message comes from, as the pill says it.
function zoneOf(p: TextPart): string {
  const file = fileOf(p.source);
  if (file) return `File ${file}`;
  if (historyAutoOf(p.source) || p.source?.startsWith('history')) return 'Saved conversation';
  if (bookmarkAutoOf(p.source)) return 'Bookmark';
  if (p.context === 'skill') return 'Site skill';
  if (p.context === 'memory' || p.source?.startsWith(MEMORY_SOURCE)) return 'Memory';
  if (p.context === 'tool') return 'Tool result';
  return p.context ? 'Page' : 'Your message';
}

const group = (entries: { text: string }[]): AutoGroup | undefined =>
  entries.length ? { key: 'blacklist', icon: 'blacklist', label: 'Terms replaced before sending', entries } : undefined;

const lines = (bl: Blacklist, zone: string, text: string) => bl.replaced(text).map((e) => ({ text: `${zone}: ${e.term} → ${e.replacement}` }));

export function replacedInMessage({ blacklist, masked }: ReplacedView, message: Message): AutoGroup | undefined {
  if (!blacklist || !masked.has(message)) return undefined;
  const entries = message.parts.flatMap((p) => (p.type === 'text' ? lines(blacklist, zoneOf(p), p.text) : []));
  return group([...new Map(entries.map((e) => [e.text, e])).values()]);
}

export function replacedInResult({ blacklist, masked }: ReplacedView, result: Extract<Part, { type: 'tool_result' }>): AutoGroup | undefined {
  if (!blacklist || !masked.has(result)) return undefined;
  return group(lines(blacklist, 'Tool result', result.content));
}
