// What a compaction did (context/compaction), in words: for the chat's divider and mark, and the Layers view.
import type { Compaction } from '../../core/types';

// What a compaction did, in a line: the turns, the messages of the latest trimmed too, the
// conversation's tokens before and after, whether summarized, and how short of its target it fell.
export function compactionLabel(c: Compaction): string {
  const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  const what = [c.turns && `${c.turns} ${c.turns === 1 ? 'turn' : 'turns'}`, c.inner && `${c.inner} older ${c.inner === 1 ? 'message' : 'messages'} in its turn`].filter(Boolean).join(' + ');
  return `${what} · ~${k(c.before)} → ~${k(c.after)} tokens${c.summary ? ' · summarized' : ''}${c.short ? ` · still ${c.short.percent}%` : ''}`;
}

// Why a compaction fell short of its target, in a sentence.
export const compactionShort = ({ short }: Compaction) =>
  short && `It got the context to ${short.percent}% of the window, not under its target of ${short.target}%: the system prompt and the tools alone take ${short.fixed}%.`;

// What a compaction without a summary leaves out of the turns it covers.
export const compactionLeftOut = ({ trimmed: t }: Compaction) =>
  [t.pages && 'page blocks', t.toolResults && 'tool results', t.screenshots && 'screenshots'].filter(Boolean).join(', ');
export const leftOutSentence = (c: Compaction) => `Left out of them: ${compactionLeftOut(c) || 'nothing'}.`;

// The mark's tooltip: why it fell short, and the instructions its summary was given (chat.compact).
export const compactionMarkTitle = (c: Compaction) => [compactionShort(c), c.instructions && `Instructions: "${c.instructions}"`].filter(Boolean).join('\n') || undefined;
