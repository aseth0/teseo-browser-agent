import { cutDetail, type LimitId } from '../core/limits';
import { cutNote, stripMarks, text } from '../core/model-texts';
import { imageSize } from '../core/image';
import type { ContextBlock, ImagePayload, Message, Part } from '../core/types';
import { unknownCase } from '../core/util';

// Cheap approximation by script, good enough for budgeting (corrected per model from what servers
// report: context/token-ratio): about 4 characters a token in Latin text, numbers, symbols and code; 1
// a character in Chinese, Japanese and Korean; 2 in the other scripts (Cyrillic, Greek, Arabic, Hebrew,
// the Indian ones, Thai).
export const CHARS_PER_TOKEN = 4;
const WIDE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff\uff66-\uff9f]/g; // one token a character
const DENSE = /[\u0370-\u052f\u0590-\u07bf\u0900-\u0dff\u0e00-\u0e7f]/g; // two characters a token
const count = (s: string, re: RegExp) => s.match(re)?.length ?? 0;
// Unrounded, so that many short pieces add up (context/usage estimateSources).
export function tokenWeight(s: string): number {
  if (!/[^\u0000-\u024f]/.test(s)) return s.length / CHARS_PER_TOKEN; // Latin only: the common case
  const wide = count(s, WIDE);
  const dense = count(s, DENSE);
  return (s.length - wide - dense) / CHARS_PER_TOKEN + dense / 2 + wide;
}
export const estimateTokens = (s: string) => Math.ceil(tokenWeight(s));

// Estimated tokens as corrected for a model (context/token-ratio: what its server reports / the estimate).
export const corrected = (tokens: number, ratio: number | undefined) => (ratio ? Math.round(tokens * ratio) : tokens);

// Rough cost of an image for the model, by its size (width × height / 750, between OpenAI's and
// Anthropic's counts), within these; providers differ widely. One whose size cannot be read: IMAGE_TOKENS.
export const IMAGE_TOKENS = 1500;
const IMAGE_RANGE = [85, 1600] as const;
export function imageTokens(image: ImagePayload): number {
  const size = imageSize(image.data);
  return size ? Math.min(IMAGE_RANGE[1], Math.max(IMAGE_RANGE[0], Math.ceil((size.width * size.height) / 750))) : IMAGE_TOKENS;
}
// A block is cut only with at least this much room left; the cut leaves a few characters for its note.
export const MIN_USEFUL_TOKENS = 150;
const NOTE_ROOM_CHARS = 20;

// Estimated tokens of messages as they are (context/compaction weighs what it saves with it), with the
// reasoning the wire sends back (sentReasoning).
export const messagesTokens = (ms: Message[]) => {
  const lastUser = ms.findLastIndex((m) => m.role === 'user');
  return ms.reduce((n, m, i) => n + m.parts.reduce((k, p) => k + partTokens(p), 0) + estimateTokens(sentReasoning(m, i, lastUser)), 0);
};

// The reasoning of a message that the request sends back, as providers/wire toOpenAIMessages does: an
// answer's since your last message (`lastUser`, its index), when it has text or tool calls to send;
// older answers go without theirs. Weighed even for a server that rejected the field, a little more
// than it gets.
export function sentReasoning(m: Message, i: number, lastUser: number): string {
  if (m.role !== 'assistant' || i <= lastUser) return '';
  if (!m.parts.some((p) => p.type === 'tool_call' || (p.type === 'text' && p.text))) return '';
  return stripMarks(m.parts.map((p) => (p.type === 'reasoning' ? p.text : '')).join(''));
}

export function partTokens(p: Part): number {
  switch (p.type) {
    case 'text':
      return estimateTokens(p.text);
    case 'tool_call':
      return estimateTokens(p.name + JSON.stringify(p.args ?? {}));
    case 'tool_result':
      return estimateTokens(p.content) + (p.images ?? []).reduce((n, i) => n + imageTokens(i), 0);
    case 'reasoning':
      return 0; // sent back only within its turn: weighed by message (sentReasoning)
    case 'image':
      return p.data ? imageTokens(p) : estimateTokens(text('user.image_not_kept'));
    default:
      unknownCase(p); // a newer build's part is not sent: it weighs nothing
      return 0;
  }
}

export function block(kind: ContextBlock['kind'], priority: number, content: string): ContextBlock {
  return { kind, priority, content, tokensEstimate: estimateTokens(content) };
}

// How many characters of `s`, from its start, weigh at most `tokens` (by script: tokenWeight).
function fittingChars(s: string, tokens: number): number {
  let [lo, hi] = [0, s.length];
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (tokenWeight(s.slice(0, mid)) <= tokens) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// Fits blocks by priority until the budget runs out; the first one that does not
// fit is truncated if there is reasonable room left, the rest are dropped. With `leftOut`, a
// dropped block leaves that line instead, so its absence is said; with `limit`, the cut and the
// dropped blocks carry a note of that limit for the views (each block called by `name`).
export function fitBlocks(
  blocks: ContextBlock[],
  budgetTokens: number,
  minUseful = MIN_USEFUL_TOKENS,
  opts: { limit?: LimitId; name?: (b: ContextBlock) => string; leftOut?: (b: ContextBlock) => string } = {},
): ContextBlock[] {
  const out: ContextBlock[] = [];
  const total = blocks.reduce((n, b) => n + b.tokensEstimate, 0);
  const nameOf = (b: ContextBlock) => opts.name?.(b) ?? b.kind;
  const note = (what: string) => (opts.limit ? cutNote(`${cutDetail(opts.limit, total, budgetTokens)} · ${what}`) : '');
  let left = budgetTokens;
  for (const b of [...blocks].sort((a, b) => b.priority - a.priority)) {
    if (!b.content) continue;
    if (b.tokensEstimate <= left) {
      out.push(b);
      left -= b.tokensEstimate;
    } else if (left >= minUseful) {
      const content = b.content.slice(0, fittingChars(b.content, left - NOTE_ROOM_CHARS / CHARS_PER_TOKEN)) + note(`${nameOf(b)} cut`) + text('result.truncated');
      out.push({ ...b, content, tokensEstimate: estimateTokens(content) });
      left = 0;
    } else if (opts.leftOut) {
      const content = note(`${nameOf(b)} left out`) + opts.leftOut(b);
      out.push({ ...b, content, tokensEstimate: estimateTokens(content) });
    }
  }
  return out;
}
