// A single adapter for everything that speaks /chat/completions:
// OpenAI, Groq, OpenRouter, Mistral, Ollama (/v1), LM Studio, vLLM, LiteLLM...
import { limit } from '../core/limits';
import { ToolsUnsupportedError, type ChatEvent, type ChatRequest, type FoundContextWindow, type LLMProvider, type ModelInfo } from '../core/types';
import { contextWindowOf, ollamaWindow } from './context-window';
import { buildHeaders } from './headers';
import { ReasoningDecoder } from './reasoning';
import { parseSSE } from './sse';
import { namesField, resolveThinkingParam, thinkingBody, thinkingRejected, type ThinkingParam } from './thinking';
import { completionToolCalls, ToolCallAccumulator, type WireToolCall } from './tool-calls';
import { assertOk } from './util';
import { Watchdog } from './watchdog';
import { toOpenAIMessages, toOpenAITools } from './wire';

interface OpenAICompatConfig {
  baseURL: string; // e.g. https://api.groq.com/openai/v1
  apiKey?: string;
  extraHeaders?: Record<string, string>;
  // Merged into every request body, e.g. {"reasoning_effort": "high"} or {"include_reasoning": true}.
  extraBody?: Record<string, unknown>;
  thinkingParam?: ThinkingParam; // how a thinking level is sent (see providers/thinking)
}

// A chunk of the stream: what the code reads of it, every field as the server may leave it out.
interface StreamChunk {
  error?: { message?: string };
  usage?: WireUsage;
  choices?: {
    delta?: Record<string, unknown> & {
      content?: unknown;
      tool_calls?: WireToolCall[];
    };
    finish_reason?: string | null;
  }[];
}

// A chunk of the stream, as JSON.parse gives it; undefined when it is not JSON.
function parsedChunk(data: string): StreamChunk | undefined {
  try {
    return JSON.parse(data) as StreamChunk;
  } catch {
    return undefined;
  }
}

// What servers answer a model that cannot call tools (Ollama, vLLM without a tool parser, OpenRouter
// with no endpoint for it); not any 400 that mentions a tool, like a bad schema.
const TOOLS_UNSUPPORTED = /does not support (tools|function calling)|(tools?|function calling|tool use) (is )?not supported|support tool use|enable-auto-tool-choice/i;

export class OpenAICompatProvider implements LLMProvider {
  constructor(private cfg: OpenAICompatConfig) {}

  private headers(): Record<string, string> {
    return buildHeaders(this.cfg.apiKey, this.cfg.extraHeaders);
  }

  private url(path: string) {
    return this.cfg.baseURL.replace(/\/+$/, '') + path;
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await fetch(this.url('/models'), { headers: this.headers() });
    await assertOk(res, 'listModels');
    const json = (await res.json()) as { data?: ({ id: string } & Record<string, unknown>)[] };
    return (json.data ?? []).map((m) => ({ id: m.id, contextWindow: contextWindowOf(m) })).sort((a, b) => a.id.localeCompare(b.id));
  }

  // A model's context window: as /models publishes it (`models`, when already read); else as a
  // LiteLLM gateway does (/model/info), or Ollama (/api/show: its num_ctx, else the model's most).
  async contextWindow(model: string, models?: ModelInfo[]): Promise<FoundContextWindow | undefined> {
    const listed = (models ?? (await this.listModels().catch(() => []))).find((m) => m.id === model)?.contextWindow;
    if (listed) return { tokens: listed, source: 'server' };
    const json = async (res: Response) => (res.ok ? ((await res.json().catch(() => undefined)) as Record<string, unknown> | undefined) : undefined);
    const litellm = await fetch(this.url('/model/info'), { headers: this.headers() }).then(json, () => undefined);
    const info = (litellm?.data as { model_name?: string; model_info?: { max_input_tokens?: unknown } }[] | undefined)?.find((d) => d.model_name === model)?.model_info;
    if (typeof info?.max_input_tokens === 'number' && info.max_input_tokens > 0) return { tokens: info.max_input_tokens, source: 'server' };
    const origin = new URL(this.cfg.baseURL).origin; // Ollama's own API is beside its /v1
    const shown = await fetch(`${origin}/api/show`, { method: 'POST', headers: this.headers(), body: JSON.stringify({ model }) }).then(json, () => undefined);
    return shown ? ollamaWindow(shown) : undefined;
  }

  // Asks for token usage in the stream (stream_options.include_usage) and sends the thinking
  // level, the tool the model must call, a JSON answer and the reasoning of the answers since your
  // last message; servers or models that reject any of them are remembered and asked again without it.
  // `notices` collects what the user should know about it. Each request is given up when no answer
  // starts in time (Settings → Limits).
  private async post(req: ChatRequest, wd: Watchdog, notices: string[]): Promise<Response> {
    const withUsage = !NO_USAGE_OPTION.has(this.cfg.baseURL);
    const onServer = `${this.cfg.baseURL}|${req.model}`; // what the NO_* sets keep, by server and model
    const thinking =
      req.thinking && !NO_THINKING.has(onServer) ? thinkingBody(resolveThinkingParam(this.cfg.thinkingParam, this.cfg.baseURL), req.thinking) : {};
    // A server that rejects tool_choice gets no tools where the model may call none.
    const tools = req.tools?.length && !(req.toolChoice === 'none' && NO_TOOL_CHOICE.has(onServer)) ? req.tools : undefined;
    const choice = req.toolChoice && tools && !NO_TOOL_CHOICE.has(onServer) ? toolChoiceBody(req.toolChoice) : undefined;
    const json = req.json && !NO_JSON_FORMAT.has(onServer);
    const messages = toOpenAIMessages(req.system, req.messages, { reasoning: !NO_REASONING.has(onServer) });
    const wait = limit('modelFirstByte');
    wd.arm(wait * 1000, `chat: no answer from the model in ${wait} s`);
    const res = await wd.guard(fetch(this.url('/chat/completions'), {
      method: 'POST',
      headers: this.headers(),
      signal: wd.signal,
      body: JSON.stringify({
        model: req.model,
        stream: true,
        ...(withUsage && { stream_options: { include_usage: true } }),
        messages,
        ...(req.maxTokens && { max_tokens: req.maxTokens }),
        ...(tools && { tools: toOpenAITools(tools) }),
        ...(choice && { tool_choice: choice }),
        ...(json && { response_format: { type: 'json_object' } }),
        ...this.cfg.extraBody,
        ...thinking,
      }),
    }));
    if (res.status === 400 || res.status === 422) {
      const text = await wd.guard(res.clone().text());
      if (withUsage && /stream_options|include_usage/i.test(text)) {
        NO_USAGE_OPTION.add(this.cfg.baseURL);
        return this.post(req, wd, notices);
      }
      if (choice && /tool_choice/i.test(text)) {
        NO_TOOL_CHOICE.add(onServer);
        if (req.toolChoice !== 'none') notices.push(`${req.model} does not accept forcing a tool: the mentioned tool was only asked for.`);
        return this.post(req, wd, notices);
      }
      if (json && /response_format|json_object/i.test(text)) {
        NO_JSON_FORMAT.add(onServer); // the prompt asks for the JSON too
        return this.post(req, wd, notices);
      }
      // Before the thinking setting, whose test would take this error for its own.
      if (messages.some((m) => m.reasoning) && REASONING_REJECTED.test(text) && namesField(text, 'reasoning')) {
        NO_REASONING.add(onServer);
        return this.post(req, wd, notices);
      }
      if (Object.keys(thinking).length && thinkingRejected(text, thinking)) {
        NO_THINKING.add(onServer);
        notices.push(`${req.model} does not accept the thinking setting: sent without it.`);
        return this.post(req, wd, notices);
      }
    }
    return res;
  }

  async *chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent> {
    const wd = new Watchdog(signal);
    try {
      yield* this.answer(req, wd);
    } finally {
      wd.dispose();
    }
  }

  private async *answer(req: ChatRequest, wd: Watchdog): AsyncIterable<ChatEvent> {
    const notices: string[] = [];
    let res = await this.post(req, wd, notices);
    // A busy (429) or failing (5xx) server is asked again, before anything was yielded.
    for (let attempt = 0; attempt < MAX_RETRIES && (res.status === 429 || res.status >= 500); attempt++) {
      if (!attempt) notices.push(`${req.model}: the server answered ${res.status}, asked again.`);
      void res.body?.cancel().catch(() => undefined); // not awaited: a cloned body waits for its twin
      await wd.rest(retryWait(res, attempt));
      res = await this.post(req, wd, notices);
    }
    if (req.tools?.length && (res.status === 400 || res.status === 404)) {
      const body = await wd.guard(res.clone().text()).catch(() => '');
      if (TOOLS_UNSUPPORTED.test(body)) throw new ToolsUnsupportedError(`chat ${res.status}: ${body.slice(0, 500)}`);
    }
    await wd.guard(assertOk(res, 'chat'));
    for (const text of notices) yield { type: 'notice', text };

    // Some servers ignore stream:true and answer with a complete JSON body.
    if (!res.headers.get('content-type')?.includes('text/event-stream')) {
      const json = (await wd.guard(res.json())) as Completion;
      wd.dispose();
      yield* fromCompletion(json);
      return;
    }
    const idle = limit('modelIdle');
    const body = wd.watched(res.body!, idle * 1000, `chat: the model's answer stopped, nothing for ${idle} s`);

    const decoder = new ReasoningDecoder();

    // Tool calls arrive split into fragments: accumulate them until the end.
    const calls = new ToolCallAccumulator();
    let stopReason = 'stop';
    let usage: ChatEvent | undefined;
    for await (const evt of parseSSE(body)) {
      if (evt.data === '[DONE]') break;
      const chunk = parsedChunk(evt.data);
      if (!chunk) continue; // not JSON: a proxy's keep-alive, say
      if (chunk.error) throw new Error(`chat: ${chunk.error.message ?? JSON.stringify(chunk.error)}`);
      usage = usageEvent(chunk.usage) ?? usage; // usually a final chunk with empty choices
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};
      yield* decoder.push(delta, contentToText(delta.content));
      for (const tc of delta.tool_calls ?? []) calls.push(tc);
      if (choice.finish_reason) stopReason = choice.finish_reason;
    }
    wd.dispose();
    yield* decoder.end();
    yield* calls.events();
    if (usage) yield usage;
    yield { type: 'done', stopReason };
  }
}

// Asking again after a 429 or 5xx: how many times, and the longest wait.
const MAX_RETRIES = 2;
const MAX_RETRY_WAIT_MS = 30_000;
// What Retry-After says (seconds or a date), at most MAX_RETRY_WAIT_MS; without it 1 s, then 2 s.
function retryWait(res: Response, attempt: number): number {
  const after = res.headers.get('retry-after')?.trim();
  const ms = !after ? NaN : /^\d+$/.test(after) ? Number(after) * 1000 : Date.parse(after) - Date.now();
  return Math.min(MAX_RETRY_WAIT_MS, Math.max(0, Number.isFinite(ms) ? ms : 1000 * 2 ** attempt));
}

// Base URLs whose server rejected stream_options (kept for the panel/worker session).
const NO_USAGE_OPTION = new Set<string>();
const NO_TOOL_CHOICE = new Set<string>(); // baseURL|model
const NO_JSON_FORMAT = new Set<string>(); // baseURL|model
const NO_REASONING = new Set<string>(); // baseURL|model: rejected an answer's reasoning sent back
// A message field the server does not take, as OpenAI, Groq and Mistral say it ('reasoning' was
// unexpected - 'messages.1'; 'messages.1': property 'reasoning' is unsupported; loc messages,1,…,reasoning),
// naming the field as a field (namesField), not a model (r1-reasoning).
const REASONING_REJECTED = /messages.{0,120}reasoning|reasoning.{0,120}messages/is;

// "required" (any tool), "none", or one tool by its wire name.
const toolChoiceBody = (choice: string) => (choice === 'required' || choice === 'none' ? choice : { type: 'function', function: { name: choice } });
// "baseURL|model" pairs whose server rejected the thinking setting.
const NO_THINKING = new Set<string>();

// The usage a server reports; the reasoning tokens (part of completion_tokens) where it splits them
// (0, as some send for every model: not split), and the cached ones (part of prompt_tokens) where it says.
type WireUsage = { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number }; prompt_tokens_details?: { cached_tokens?: number } | null };
function usageEvent(u: WireUsage | undefined): ChatEvent | undefined {
  if (typeof u?.prompt_tokens !== 'number') return undefined;
  const reasoning = u.completion_tokens_details?.reasoning_tokens;
  const cached = u.prompt_tokens_details?.cached_tokens;
  return { type: 'usage', inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens ?? 0, ...(typeof reasoning === 'number' && reasoning > 0 && { reasoningTokens: reasoning }), ...(typeof cached === 'number' && cached > 0 && { cachedTokens: cached }) };
}

// content can be a string, null or a list of parts [{type:'text', text}].
function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p === 'string' ? p : typeof p?.text === 'string' ? p.text : '')).join('');
  return '';
}

interface Completion {
  error?: { message?: string };
  usage?: WireUsage;
  choices?: {
    message?: Record<string, unknown> & {
      content?: unknown;
      tool_calls?: WireToolCall[];
    };
    finish_reason?: string;
  }[];
}

function* fromCompletion(json: Completion): Generator<ChatEvent> {
  if (json.error) throw new Error(`chat: ${json.error.message ?? JSON.stringify(json.error)}`);
  const choice = json.choices?.[0];
  const decoder = new ReasoningDecoder();
  yield* decoder.push(choice?.message, contentToText(choice?.message?.content));
  yield* decoder.end();
  yield* completionToolCalls(choice?.message?.tool_calls ?? []);
  const usage = usageEvent(json.usage);
  if (usage) yield usage;
  yield { type: 'done', stopReason: choice?.finish_reason ?? 'stop' };
}
