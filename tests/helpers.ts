import { modelView } from '../src/context/compaction';
import type { LoopContext, LoopHooks, LoopModel, LoopOptions, LoopTools, RunToolContext } from '../src/core/agent-loop';
import type { ToolRegistry } from '../src/core/tool-registry';
import type { ChatEvent, ChatRequest, LLMProvider } from '../src/core/types';
import type { Settings } from '../src/storage/settings';
import { measureCall } from '../src/context/usage';

// Builds a Response whose SSE body is split into arbitrary chunks.
export function sseResponse(events: string[], chunkSize = 7): Response {
  const text = events.join('');
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < text.length; i += chunkSize) c.enqueue(enc.encode(text.slice(i, i + chunkSize)));
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

export async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

// The settings a tool's context carries (ToolContext.settings) where a test needs none of them.
export const TOOL_SETTINGS = { providers: [] } as unknown as Settings;

// What the background gives the agent loop to compact and measure its requests.
export const measured = { view: modelView, measure: measureCall };

// The agent loop's options for a test: model "m" of `provider`, the tools of `registry`, measured, and
// what `more` sets on top of that in each group.
type More = { model?: Partial<LoopModel>; context?: Partial<LoopContext>; tools?: Partial<Omit<LoopTools, 'context'>> & { context?: Partial<RunToolContext> }; hooks?: LoopHooks; maxSteps?: number; startedAt?: number };
export const loop = (provider: LLMProvider, registry: ToolRegistry, more: More = {}): LoopOptions => ({
  ...more,
  model: { provider, name: 'm', ...more.model },
  context: { ...measured, ...more.context },
  tools: { registry, ...more.tools, context: { settings: TOOL_SETTINGS, ...more.tools?.context } },
});

// A provider that replays a script, one response per request (then a plain stop), keeping a copy of
// each request as it was sent.
export function scripted(steps: ChatEvent[][]): LLMProvider & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  return {
    requests,
    listModels: async () => [],
    async *chat(req) {
      requests.push(structuredClone(req));
      yield* steps[requests.length - 1] ?? [{ type: 'done', stopReason: 'stop' }];
    },
  };
}
