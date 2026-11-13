// The assistant message as it streams in (core/agent-loop).
import { cutAt, findLoop } from './repetition';
import type { ChatEvent, Part } from './types';

const CHECK_EVERY = 64; // characters streamed between two looks for a loop (core/repetition)

// The part a delta goes on: the text or reasoning being streamed.
type OpenPart = Extract<Part, { type: 'text' | 'reasoning' }>;

// Builds the assistant message preserving the order in which blocks were streamed.
export class PartsBuilder {
  readonly parts: Part[] = [];
  private open: OpenPart | null = null;
  private unchecked = 0; // characters streamed since the last look for a loop

  // usedIds: tool call ids already in the conversation. Many servers number calls per response
  // (call_0, call_1...), so ids repeat across turns; results are matched by id, so make them unique.
  constructor(private usedIds: Set<string>) {}

  private uniqueId(id: string): string {
    let unique = id || 'call';
    for (let n = 2; this.usedIds.has(unique); n++) unique = `${id || 'call'}_${n}`;
    this.usedIds.add(unique);
    return unique;
  }

  add(evt: ChatEvent): void {
    switch (evt.type) {
      case 'text-delta':
        this.append('text', evt.text);
        break;
      case 'reasoning-delta':
        this.append('reasoning', evt.text);
        break;
      case 'reasoning-end':
        this.open = null;
        break;
      case 'tool-call':
        this.parts.push({ type: 'tool_call', id: this.uniqueId(evt.id), name: evt.name, args: evt.args });
        this.open = null;
        break;
    }
  }

  // After a delta: what the text or reasoning being written keeps repeating, when it is caught in a
  // loop (core/repetition), cut there.
  loopAfter(added: number): string | undefined {
    if (!this.open || (this.unchecked += added) < CHECK_EVERY) return undefined;
    this.unchecked = 0;
    const loop = findLoop(this.open.text);
    if (!loop) return undefined;
    this.open.text = cutAt(this.open.text, loop);
    return loop.fragment;
  }

  // To the text or reasoning being written, or to a new one when the other kind (or a call) came last.
  private append(type: OpenPart['type'], text: string) {
    if (this.open?.type !== type) {
      const part: OpenPart = { type, text: '' };
      this.parts.push(part);
      this.open = part;
    }
    this.open.text += text;
  }
}
