// Context accounting for one model call (core/types' CallUsage): what the request is made of
// (estimated) and what the server reported, when it does.
import { originRuns } from '../core/model-texts';
import type { CallUsage, ContextBreakdown, Message, Part, SourceBreakdown, ToolSpec, UsageSource } from '../core/types';
import { CHARS_PER_TOKEN, estimateTokens, imageTokens, partTokens, sentReasoning, tokenWeight } from './budget';

// What the wire (providers/openai-compat) adds to the parts: each message's role and the chat
// template's delimiters; a tool call's id and type, and its result's tool_call_id; and each tool's
// {"type":"function","function":{…}} around its spec, the schema under "parameters".
const MESSAGE_TOKENS = 4;
const CALL_ID_TOKENS = 8;
const TOOL_WIRE_CHARS = 30;

// The size of the tool definitions as sent (none without tools), by the specs list: a model call
// estimates the same list twice, and the agent loop keeps it while the tools stay the same.
const specsChars = new WeakMap<ToolSpec[], number>();
function toolsChars(tools: ToolSpec[]): number {
  if (!tools.length) return 0;
  let n = specsChars.get(tools);
  if (n === undefined) specsChars.set(tools, (n = JSON.stringify(tools).length + TOOL_WIRE_CHARS * tools.length));
  return n;
}

// Tokens the wire adds to a message: a tool's results go one a message, and their images in one more.
function framingTokens(m: Message): number {
  if (m.role !== 'tool') return MESSAGE_TOKENS + CALL_ID_TOKENS * m.parts.filter((p) => p.type === 'tool_call').length;
  const results = m.parts.flatMap((p) => (p.type === 'tool_result' ? [p] : []));
  return results.length * (MESSAGE_TOKENS + CALL_ID_TOKENS) + (results.some((p) => p.images?.length) ? MESSAGE_TOKENS : 0);
}
const systemTokens = (system: string | undefined) => (system ? estimateTokens(system) + MESSAGE_TOKENS : 0);

// As the request goes: `system` and `messages` as the model gets them (context/compaction's modelView).
export function estimateRequest(system: string | undefined, tools: ToolSpec[], messages: Message[]): ContextBreakdown {
  const b: ContextBreakdown = {
    system: systemTokens(system),
    tools: Math.ceil(toolsChars(tools) / CHARS_PER_TOKEN),
    conversation: 0,
    pageContext: 0,
    skills: 0,
    toolResults: 0,
  };
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  for (const [i, m] of messages.entries()) {
    b[m.role === 'tool' ? 'toolResults' : 'conversation'] += framingTokens(m);
    b.conversation += estimateTokens(sentReasoning(m, i, lastUser));
    for (const p of m.parts) {
      const n = partTokens(p);
      if (p.type === 'tool_result') b.toolResults += n;
      else if (p.type === 'text' && p.context === 'page') b.pageContext += n;
      else if (p.type === 'text' && p.context === 'skill') b.skills += n;
      else b.conversation += n;
    }
  }
  return b;
}

// Estimated per source, of the request as the model gets it (modelView): unrounded tokens are summed
// first, so many short marked values do not round up.
export function estimateSources(system: string | undefined, tools: ToolSpec[], messages: Message[]): SourceBreakdown {
  const weight: SourceBreakdown = {};
  const add = (source: UsageSource, n: number) => n && (weight[source] = (weight[source] ?? 0) + n);
  const addText = (s: string, unmarked: UsageSource) => {
    for (const run of originRuns(s)) add(run.origin ?? unmarked, tokenWeight(run.text));
  };
  addText(system ?? '', 'system');
  if (system) add('system', MESSAGE_TOKENS);
  if (tools.length) add('tools', toolsChars(tools) / CHARS_PER_TOKEN);
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  for (const [i, m] of messages.entries()) {
    add(m.role === 'tool' ? 'results' : m.role === 'assistant' ? 'answers' : 'message', framingTokens(m));
    add('answers', tokenWeight(sentReasoning(m, i, lastUser)));
    for (const p of m.parts) {
      if (p.type === 'text') addText(p.text, m.role === 'assistant' ? 'answers' : p.context ? 'wrappers' : 'message');
      else if (p.type === 'tool_call') add('answers', tokenWeight(p.name + JSON.stringify(p.args ?? {})));
      else if (p.type === 'tool_result') {
        addText(p.content, 'results');
        add('tool', (p.images ?? []).reduce((n, i) => n + imageTokens(i), 0)); // screenshots of the page
      } else if (p.type === 'image') add('message', p.data ? imageTokens(p) : 0); // yours
    }
  }
  return Object.fromEntries(Object.entries(weight).map(([k, n]) => [k, Math.ceil(n)]));
}

// An answer as the model wrote it, its reasoning included (`estimateReasoning`: that alone, which
// partTokens weighs 0: only the requests of its own turn send it back, context/budget sentReasoning).
export function estimateOutput(parts: Part[]): number {
  return estimateReasoning(parts) + parts.reduce((n, p) => n + partTokens(p), 0);
}
export const estimateReasoning = (parts: Part[]) => parts.reduce((n, p) => n + (p.type === 'reasoning' ? estimateTokens(p.text) : 0), 0);

// Of a request's messages, the images: yours and the tools' screenshots.
function imagesTokens(messages: Message[]): number {
  let n = 0;
  for (const m of messages) {
    for (const p of m.parts) {
      if (p.type === 'image' && p.data) n += imageTokens(p);
      else if (p.type === 'tool_result') for (const i of p.images ?? []) n += imageTokens(i);
    }
  }
  return n;
}

export function estimatedInput(b: ContextBreakdown): number {
  return b.system + b.tools + b.conversation + b.pageContext + b.skills + b.toolResults;
}

// One call of the agent loop (its `measure`): from the request as the model got it, its answer, and
// what the server reported; with the call's tokens, for its message.
export function measureCall(request: { system?: string; tools: ToolSpec[]; messages: Message[] }, answer: Part[], reported?: CallUsage['reported']) {
  const { system, tools, messages } = request;
  const usage: CallUsage = {
    breakdown: estimateRequest(system, tools, messages),
    sources: estimateSources(system, tools, messages),
    estimatedOutput: estimateOutput(answer),
    estimatedReasoning: estimateReasoning(answer),
    estimatedImages: imagesTokens(messages),
    ...(tools.length > 0 && { toolNames: tools.map((t) => t.name) }),
    reported,
  };
  return { usage, tokens: callTokens(usage) };
}

// Tokens of one call: the reported numbers when available (with the reasoning's share of the output,
// when the server says), else the estimate. Its whole output, as it is paid for.
export function callTokens(u: CallUsage): { input: number; output: number; reasoning?: number; cached?: number } {
  return u.reported ?? { input: estimatedInput(u.breakdown), output: u.estimatedOutput };
}

// Tokens of a call's answer as a request after its turn sends it back, without its reasoning (the
// requests of its own turn send that too: context/budget sentReasoning): as the server split them; as it
// reported them when there was no reasoning; else estimated.
function sentBackTokens(u: CallUsage): number {
  const r = u.reported;
  if (r?.reasoning) return Math.max(0, r.output - r.reasoning);
  if (!u.estimatedReasoning) return callTokens(u).output;
  return u.estimatedOutput - u.estimatedReasoning;
}

// Tokens the conversation occupies after a call: its request and the answer as sent back.
export function contextUsed(u: CallUsage): number {
  return callTokens(u).input + sentBackTokens(u);
}
