// A request as the model gets it while the word blacklist applies, and its answer as the extension
// gets it back (word-blacklist/core): every text of the request masked (the system prompt with its
// note, your messages, the history, tool calls and results, the tools' descriptions), the images
// replaced by a note when they are hidden; and in the answer, the text, the reasoning and the tool
// calls' arguments restored, before anything shows or runs them. The history stays as it was:
// masked again, the same way, on every request.
import type { ChatEvent, ChatRequest, JSONSchema, Message, Part, ToolSpec } from '../core/types';
import { isObject } from '../core/util';
import { deepStrings, type Blacklist } from './core';

export interface MaskOptions {
  hideImages: boolean;
  systemNote: string; // after the system prompt (core/model-texts 'system.word_blacklist')
  imageNote: string; // in place of each image hidden ('user.image_hidden')
}

export function maskRequest(req: ChatRequest, bl: Blacklist, opts: MaskOptions): ChatRequest {
  const system = [req.system ? bl.mask(req.system) : '', opts.systemNote].filter(Boolean).join('\n\n');
  return {
    ...req,
    system,
    messages: req.messages.map((m) => maskMessage(m, bl, opts)),
    ...(req.tools && { tools: req.tools.map((t) => maskTool(t, bl)) }),
  };
}

function maskMessage(m: Message, bl: Blacklist, { hideImages, imageNote }: MaskOptions): Message {
  const parts = m.parts.map((p): Part => {
    switch (p.type) {
      case 'text':
      case 'reasoning':
        return { ...p, text: bl.mask(p.text) };
      case 'tool_call':
        return { ...p, args: bl.maskDeep(p.args) };
      case 'tool_result': {
        const hidden = hideImages && p.images?.length;
        const content = bl.mask(p.content);
        return { ...p, content: hidden ? [content, imageNote].filter(Boolean).join('\n') : content, ...(hidden && { images: undefined }) };
      }
      case 'image':
        return hideImages ? { type: 'text', text: imageNote } : p;
    }
  });
  return { ...m, parts };
}

// Its description, and the texts of its parameters (not the schema's own words: types, formats).
const SCHEMA_WORDS = new Set(['type', 'format', 'pattern', '$ref', '$schema', 'required']);
const maskSchema = (v: JSONSchema, bl: Blacklist): JSONSchema =>
  Object.fromEntries(
    Object.entries(v).map(([k, x]) => [
      k,
      SCHEMA_WORDS.has(k) ? x
      : k === 'properties' && isObject(x) ? Object.fromEntries(Object.entries(x).map(([name, s]) => [name, isObject(s) ? maskSchema(s, bl) : s]))
      : isObject(x) ? maskSchema(x, bl)
      : Array.isArray(x) ? x.map((y: unknown) => (isObject(y) ? maskSchema(y, bl) : deepStrings(y, bl.mask)))
      : deepStrings(x, bl.mask),
    ]),
  );
const maskTool = (t: ToolSpec, bl: Blacklist): ToolSpec => ({ ...t, description: bl.mask(t.description), inputSchema: maskSchema(t.inputSchema, bl) });

// The answer with the placeholders put back: a streamed text or reasoning held back only while its
// end may be the start of one; a tool call's arguments once whole, before the tool runs.
export async function* restoreEvents(events: AsyncIterable<ChatEvent>, bl: Blacklist): AsyncGenerator<ChatEvent> {
  const text = bl.streamRestorer();
  const reasoning = bl.streamRestorer();
  // What one of them still holds, given before anything else comes (the order stays).
  function* flush(which: 'text' | 'reasoning'): Generator<ChatEvent> {
    const rest = (which === 'text' ? text : reasoning).end();
    if (rest) yield which === 'text' ? { type: 'text-delta', text: rest } : { type: 'reasoning-delta', text: rest };
  }
  for await (const e of events) {
    if (e.type === 'text-delta' || e.type === 'reasoning-delta') {
      yield* flush(e.type === 'text-delta' ? 'reasoning' : 'text');
      const given = (e.type === 'text-delta' ? text : reasoning).push(e.text);
      if (given) yield { ...e, text: given };
      continue;
    }
    yield* flush('reasoning');
    yield* flush('text');
    yield e.type === 'tool-call' ? { ...e, args: bl.restoreDeep(e.args) } : e;
  }
  yield* flush('reasoning');
  yield* flush('text');
}
