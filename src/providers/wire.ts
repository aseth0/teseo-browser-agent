// The request as /chat/completions takes it: the tools and the messages on the wire. Apart from the
// provider (providers/openai-compat) so that the UI, which shows them, does not load it.
import { dataUrlOf, type Message, type ToolSpec } from '../core/types';
import { stripMarks, text } from '../core/model-texts';

export function toOpenAITools(tools: ToolSpec[]): unknown[] {
  return tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
}

// A message as /chat/completions takes it (parts: a user message with images).
type WirePart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export interface WireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | WirePart[] | null;
  tool_call_id?: string;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  reasoning?: string; // an answer's reasoning, sent back since your last message
}

// The request's messages on the wire, translated as they are: the caller gives them as the model
// gets them (context/compaction's modelView: compacted, with the notes it adds). The reasoning of the
// answers since your last message goes back with them (`reasoning`): a model that thinks between its
// tool calls (Qwen3) keeps on from it, and calls tools with empty arguments without it. Older answers go
// without theirs, which the models' templates drop; and all of them, with `reasoning` false (a server
// that rejected the field: providers/openai-compat).
// Without the origin marks (core/model-texts) unless `keepMarks`, for the Layers view's colors.
export function toOpenAIMessages(
  system: string | undefined,
  messages: Message[],
  { keepMarks = false, reasoning = true }: { keepMarks?: boolean; reasoning?: boolean } = {},
): WireMessage[] {
  const clean = keepMarks ? (s: string) => s : stripMarks;
  const out: WireMessage[] = [];
  if (system) out.push({ role: 'system', content: clean(system) });
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  for (const [i, m] of messages.entries()) {
    if (m.role === 'tool') {
      const images: WirePart[] = [];
      for (const p of m.parts) {
        if (p.type !== 'tool_result') continue;
        out.push({ role: 'tool', tool_call_id: p.toolCallId, content: clean(p.content) });
        for (const i of p.images ?? []) images.push({ type: 'image_url', image_url: { url: dataUrlOf(i) } });
      }
      // The OpenAI "tool" role does not accept images: they go in a separate user message.
      if (images.length) out.push({ role: 'user', content: [{ type: 'text', text: text('result.images_caption') }, ...images] });
      continue;
    }
    const texts = m.parts.filter((p) => p.type === 'text');
    const calls = m.parts.filter((p) => p.type === 'tool_call');
    if (m.role === 'assistant') {
      // Nothing to send (a turn stopped while the model was only thinking): the servers reject an
      // assistant message without content or tool calls.
      if (!calls.length && !texts.some((p) => p.text)) continue;
      const thought = reasoning && i > lastUser ? m.parts.map((p) => (p.type === 'reasoning' ? p.text : '')).join('') : '';
      out.push({
        role: 'assistant',
        content: clean(texts.map((p) => p.text).join('')) || null,
        ...(calls.length && {
          tool_calls: calls.map((c) => ({
            id: c.id,
            type: 'function' as const,
            // Arguments compaction left out carry its note, marked as any text.
            function: { name: c.name, arguments: clean(JSON.stringify(c.args ?? {})) },
          })),
        }),
        ...(thought && { reasoning: clean(thought) }),
      });
    } else {
      const content = clean(texts.map((p) => p.text).join('\n'));
      // Your images after your text (one not kept in a saved conversation: a note in its place).
      const images = m.parts.flatMap((p) => (p.type === 'image' ? [p] : []));
      out.push({
        role: 'user',
        content: images.length
          ? [{ type: 'text', text: [content, ...images.filter((p) => !p.data).map(() => text('user.image_not_kept'))].filter(Boolean).join('\n') },
            ...images.filter((p) => p.data).map((p) => ({ type: 'image_url' as const, image_url: { url: dataUrlOf(p) } }))]
          : content,
      });
    }
  }
  return out;
}
