// Reasoning ("chain of thought") extraction for OpenAI-compatible servers,
// which expose it in several non-standard ways.
import type { ChatEvent } from '../core/types';

// Turns a server's reasoning fields and content into ordered chat events, closing
// each reasoning block before text (or, via end(), tool calls) follows.
export class ReasoningDecoder {
  private tags = new ThinkTagSplitter();
  private open = false;

  *push(fields: Record<string, unknown> | undefined, content: string): Generator<ChatEvent> {
    const reasoning = reasoningFromFields(fields);
    if (reasoning) yield* this.emit([{ kind: 'reasoning', text: reasoning }]);
    if (content) yield* this.emit(this.tags.feed(content));
  }

  *end(): Generator<ChatEvent> {
    yield* this.emit(this.tags.flush());
    yield* this.close();
  }

  private *emit(segments: Segment[]): Generator<ChatEvent> {
    for (const s of segments) {
      if (s.kind === 'reasoning') {
        this.open = true;
        yield { type: 'reasoning-delta', text: s.text };
      } else {
        yield* this.close();
        yield { type: 'text-delta', text: s.text };
      }
    }
  }

  private *close(): Generator<ChatEvent> {
    if (!this.open) return;
    this.open = false;
    yield { type: 'reasoning-end' };
  }
}

// Reasoning carried in dedicated delta/message fields:
//   reasoning_content  → DeepSeek, vLLM, LM Studio, Qwen
//   reasoning          → OpenRouter, Ollama, newer vLLM
//   reasoning_details  → OpenRouter (structured; only used when `reasoning` is absent,
//                        since OpenRouter sends both with the same text)
//   thinking           → some proxies
export function reasoningFromFields(d: Record<string, unknown> | undefined): string {
  if (!d) return '';
  for (const key of ['reasoning_content', 'reasoning', 'thinking']) {
    const v = d[key];
    if (typeof v === 'string' && v) return v;
  }
  const details = d.reasoning_details;
  if (Array.isArray(details)) {
    return details
      .map((x) => (typeof x?.text === 'string' ? x.text : typeof x?.summary === 'string' ? x.summary : ''))
      .join('');
  }
  return '';
}

type Segment = { kind: 'text' | 'reasoning'; text: string };

const OPEN = ['<think>', '<thought>'];
const CLOSE = ['</think>', '</thought>'];

// Splits streamed content that opens with reasoning in <think>…</think> (or <thought>) tags. A tag
// counts only at the start of the content (after whitespace): one quoted later in the answer is
// text. Tags may be cut across chunks, so a possible partial tag is held back.
export class ThinkTagSplitter {
  private state: 'start' | 'inside' | 'text' = 'start';
  private pending = '';

  feed(chunk: string): Segment[] {
    let buf = this.pending + chunk;
    this.pending = '';
    const out: Segment[] = [];
    if (this.state === 'start') {
      const lead = buf.length - buf.trimStart().length;
      const rest = buf.slice(lead);
      const open = OPEN.find((t) => rest.startsWith(t));
      if (open) {
        this.state = 'inside';
        buf = rest.slice(open.length);
      } else if (!rest || OPEN.some((t) => t.startsWith(rest))) {
        this.pending = buf; // whitespace, or what may be the start of a tag
        return out;
      } else this.state = 'text';
    }
    if (this.state === 'inside') {
      const hit = CLOSE.map((t) => ({ t, i: buf.indexOf(t) })).filter((h) => h.i >= 0).sort((a, b) => a.i - b.i)[0];
      if (!hit) {
        const keep = partialTagSuffix(buf, CLOSE);
        this.emit(out, buf.slice(0, buf.length - keep));
        this.pending = buf.slice(buf.length - keep);
        return out;
      }
      this.emit(out, buf.slice(0, hit.i));
      buf = buf.slice(hit.i + hit.t.length);
      this.state = 'text';
    }
    this.emit(out, buf);
    return out;
  }

  flush(): Segment[] {
    const out: Segment[] = [];
    this.emit(out, this.pending);
    this.pending = '';
    return out;
  }

  private emit(out: Segment[], text: string) {
    if (!text) return;
    const kind = this.state === 'inside' ? 'reasoning' : 'text';
    const last = out[out.length - 1];
    if (last?.kind === kind) last.text += text;
    else out.push({ kind, text });
  }
}

function partialTagSuffix(buf: string, tags: string[]): number {
  for (let n = Math.min(buf.length, Math.max(...tags.map((t) => t.length)) - 1); n > 0; n--) {
    const tail = buf.slice(-n);
    if (tags.some((t) => t.startsWith(tail))) return n;
  }
  return 0;
}
