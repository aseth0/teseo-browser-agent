// Agent loop: model → tool calls → results → model..., until it stops calling tools.
import type { Feature } from './build';
import type { ContextItem } from './messages';
import { bestEffort, errorText } from './errors';
import { PartsBuilder } from './parts-builder';
import { fragmentShown } from './repetition';
import { BLOCK_AFTER, callKey, failuresInTurn } from './repeated-calls';
import { execute } from './tool-exec';
import { toWireName, type ToolRegistry } from './tool-registry';
import { namedTab } from './util';
import { DEFAULT_MAX_STEPS } from './limits';
import { text } from './model-texts';
import { callPhaseId, noPhases, type PhaseHandle, type PhaseRecorder } from './phases';
import { ToolsUnsupportedError, type AccessRequest, type Authorization, type CallUsage, type ChatEvent, type ChatRequest, type LLMProvider, type TabSeen, type Message, type Part, type ThinkingLevel, type Tool, type ToolCallLog, type ToolContext, type ToolSpec, type WindowSource } from './types';

export type LoopEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'message'; message: Message } // complete message to append to the history
  | { type: 'usage'; usage: CallUsage } // after every model call
  | { type: 'notice'; text: string } // for the chat: from the provider (a setting the model ignored), or the loop's own (shortened, cut)
  | { type: 'step-limit'; steps: number } // stopped with tool results the model has not seen yet
  | { type: 'done' }
  | { type: 'error'; error: string };

// Who answers, and how each request goes to it.
export interface LoopModel {
  provider: LLMProvider;
  name: string;
  system?: string;
  thinking?: ThinkingLevel; // none: the server's default
  toolChoice?: ChatRequest['toolChoice']; // for the first call only
  // The model's window in tokens (context/window runWindow): a request estimated over FULL of it goes
  // shortened more (RunSeen.squeeze); none: never.
  contextWindow?: number;
  // Where contextWindow comes from: on 'default' (a guess for an unknown window) a request is shortened
  // only to 1 on its own; more only once the server refused one as too long.
  windowSource?: WindowSource;
  tokenRatio?: number; // the model's estimates corrected by it (context/token-ratio)
  // Whether an error is the server refusing a request as too long (context/window isContextOverflow):
  // the request goes once more, shortened as much as it can be, and so do the rest of the run's.
  overflowed?: (error: string) => boolean;
}

// What the model gets of the conversation, and what a request costs.
export interface LoopContext {
  // What the model gets of the system prompt and the conversation (context/compaction's modelView;
  // context/in-run with what `run` says of this run's results).
  view: (system: string | undefined, messages: Message[], run: RunSeen) => { system?: string; messages: Message[] };
  // What a call cost (context/usage's measureCall), from the request as the model got it, its answer
  // and what the server reported: the 'usage' event, and the tokens on the answer's meta.
  measure: (request: { system?: string; tools: ToolSpec[]; messages: Message[] }, answer: Part[], reported?: CallUsage['reported']) => { usage: CallUsage; tokens: { input: number; output: number; reasoning?: number; cached?: number } };
  // The request's input tokens alone (context/usage estimatedInput), for the room left in the window:
  // cheaper than measure, which also works out where every token comes from. None: measure's.
  estimate?: (request: { system?: string; tools: ToolSpec[]; messages: Message[] }) => number;
  // Between the model's steps: what goes on its own after the step's last tool result, from what the
  // model wrote in that step (context/step-attach; empty when it wrote nothing) and the plan it showed
  // (context/plan-reminder); `messages`: the conversation so far, with the step's results.
  attachAfter?: (reply: string, messages: Message[]) => Promise<ContextItem[]>;
}

// What every call of the run gets in its ToolContext.
export type RunToolContext = Pick<ToolContext, 'tabId' | 'settings' | 'interact' | 'conversationId' | 'skills' | 'templates' | 'agentId'>;

// The tools offered, and how a call is allowed and run.
export interface LoopTools {
  registry: ToolRegistry;
  context: RunToolContext;
  // Before each request after the first: the tools again, when they changed (the page's own tools,
  // WebMCP, once the tab is on another page); none when they did not.
  refresh?: (tools: ToolRegistry) => Promise<ToolRegistry | undefined>;
  // Where a tool that runs others (a script's tool(), script/steps) finds them: every tool there is,
  // also those not offered to the model (switched off, or not the agent's); none: those offered.
  stepTools?: ToolRegistry;
  // Called before every call (the policy): whether it may run, and what the user commented.
  authorize?: (tool: Tool, args: unknown, ctx: ToolContext) => Promise<Authorization>;
  // Asks the user for a permission a tool needs; true when granted.
  requestAccess?: (access: AccessRequest) => Promise<boolean>;
  // The feature a tool called but not offered needs, when this build lacks it (tools/build-tools): its
  // reply says the tool is not in this version, not that it is unknown.
  lacking?: (wireName: string) => Feature | undefined;
}

// What the loop tells as it goes, besides its events.
export interface LoopHooks {
  log?: (call: ToolCallLog) => void; // every tool call, as it ends (the action log)
  tabOf?: (tabId: number) => Promise<TabSeen | undefined>; // a tab a call names, for the chat to show
  // What a call does inside it, as it goes (a script tool's steps): for the panel, under that call.
  onSub?: (callId: string, label: string, event: LoopEvent) => void;
  // Each call's result as it ends, before the step's results message: what a stopped chat keeps (the
  // calls that ended were done; core/messages markStopped).
  onResult?: (result: Part) => void;
  onOverflow?: (error: string) => void; // a refusal as too long, which may say the model's window (context/window learnContextWindow)
  // The turn's phases (core/phases): each model call and its parts, each tool call, what was attached
  // between steps. None: not recorded.
  phases?: PhaseRecorder;
}

export interface LoopOptions {
  model: LoopModel;
  context: LoopContext;
  tools: LoopTools;
  hooks?: LoopHooks;
  maxSteps?: number;
  startedAt?: number; // when the run began (Date.now()); none: when the loop starts
}

const FULL = 0.9; // of the model's window, past which a request is shortened more
const WINDOW_SOURCE: Record<WindowSource, string> = {
  'model-settings': 'window set for the model',
  error: 'window learned from an error',
  server: 'server window',
  settings: 'provider window',
  'model-max': "model's most",
  default: 'default window',
};
const kTokens = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString('en-US'));
// What the chat is told when a request is shortened to fit: how full (estimated), of what window and
// from where, and what the tools weigh of it.
export function nearlyFull(d: { input: number; window: number; source?: WindowSource; tools: number }): string {
  const source = WINDOW_SOURCE[d.source ?? 'settings'];
  const unknown = d.source === 'default' ? " Set the model's window in the context meter if it takes more." : '';
  return `Context nearly full (${kTokens(d.input)} of ${kTokens(d.window)}, ${source}; tools ${kTokens(d.tools)}): earlier results of this turn were shortened more for this request.${unknown}`;
}
export const SENT_SHORTER = 'The server said the request was too long: sent again, shortened more.';
export const loopCut = (fragment: string) => `Reply cut: it kept repeating "${fragmentShown(fragment)}".`;

// What a run knows of its tool results beyond their content, for the view: the page elements each
// action's result carries, by its call's id (ToolResult.elements); and how much more to shorten what
// came earlier in the turn, when the request would not fit the model's window (context/in-run squeezeRun).
interface RunSeen {
  elements: ReadonlyMap<string, string>;
  squeeze?: 1 | 2;
}


export async function* runAgentLoop(history: Message[], opts: LoopOptions, signal: AbortSignal): AsyncGenerator<LoopEvent> {
  const messages = [...history];
  const usedIds = new Set(history.flatMap((m) => m.parts.flatMap((p) => (p.type === 'tool_call' ? [p.id] : []))));
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
  let toolsDisabled = false;
  const runStart = opts.startedAt ?? Date.now();
  const { model, context } = opts;
  let tools = opts.tools.registry;
  // The specs of the tools offered, built again only when the registry changes: the same list then
  // goes to every step, and its size is estimated once (context/usage).
  let specsOf: ToolRegistry | undefined;
  let toolSpecs: ToolSpec[] = [];
  const elements = new Map<string, string>();
  let refused = false; // the server refused a request of this run as too long: the rest go squeezed most
  let toldFull = false; // the chat was told once in this run
  // The last call's request as the server counted it (reported) and as estimated, for the next: the
  // estimate then only has to count what changed since (context/token-ratio corrects that much).
  let anchor: Anchor | undefined;
  // The model sent again a call already not run (core/repeated-calls): the next request lets it call none.
  let callsBlocked = false;
  const phases = opts.hooks?.phases ?? noPhases;
  let modelCalls = 0; // the model calls of this run, for their phases' labels
  try {
    for (let step = 0; step < maxSteps; step++) {
      if (step > 0 && opts.tools.refresh) tools = (await bestEffort(opts.tools.refresh(tools), 'refresh-tools')) ?? tools; // the ones offered stay
      if (specsOf !== tools) [specsOf, toolSpecs] = [tools, tools.specs()];
      const specs = toolsDisabled ? [] : toolSpecs;
      const builder = new PartsBuilder(usedIds);
      const { view, squeeze, shortened, estimated, full } = fitView(opts, messages, { elements, specs, refused, anchor });
      // Told only when it left something out (what does not fit may be all fixed: the prompt, the tools).
      if (shortened && full && !toldFull) {
        toldFull = true;
        yield { type: 'notice', text: nearlyFull(full) };
      }
      const toolChoice = !specs.length ? undefined : callsBlocked ? 'none' : step === 0 ? model.toolChoice : undefined;
      const request: ChatRequest = { model: model.name, system: view.system, messages: view.messages, tools: specs.length ? specs : undefined, thinking: model.thinking, toolChoice };
      const callPhase = phases.start({ kind: 'call', label: `Model call ${++modelCalls}`, detail: model.name });
      let answer: StepAnswer;
      try {
        answer = yield* streamStep(opts, request, builder, { squeeze, signal, phases: phases.under(callPhase.id) });
      } finally {
        callPhase.end();
      }
      if (answer.again) {
        callPhase.note(answer.again === 'without-tools' ? `${model.name} · took no tools: sent again without them` : `${model.name} · refused as too long: sent again shortened`);
        if (answer.again === 'without-tools') toolsDisabled = true;
        else refused = true;
        step--;
        continue;
      }
      const { looped } = answer;
      anchor = answer.reported?.input ? { reported: answer.reported.input, estimated } : undefined;
      // Cut for a loop: without the calls it may have begun (they would go without their results).
      const parts = looped ? builder.parts.filter((p) => p.type !== 'tool_call') : builder.parts;
      const { usage, tokens } = context.measure({ system: view.system, tools: specs, messages: view.messages }, parts, answer.reported);
      const end = Date.now();
      const meta = { ...tokens, reported: !!answer.reported, ms: end - answer.callStart, firstTokenMs: answer.firstTokenMs, sinceStartMs: end - runStart };
      const assistant: Message = { role: 'assistant', parts, meta, ...(looped && { cut: looped }) };
      messages.push(assistant);
      if (looped) yield { type: 'notice', text: loopCut(looped) };
      yield { type: 'message', message: assistant };
      yield { type: 'usage', usage };
      if (looped) {
        yield { type: 'done' };
        return;
      }

      const calls = builder.parts.filter((p) => p.type === 'tool_call');
      if (!calls.length) {
        yield { type: 'done' };
        return;
      }
      // Called anyway: the server ignores tool_choice, so the rest go without tools.
      if (toolChoice === 'none') toolsDisabled = true;

      const ran = await runCalls(opts, tools, calls, { elements, failed: failuresInTurn(messages) }, signal);
      if (!ran) {
        yield { type: 'done' };
        return;
      }
      const { results } = ran;
      callsBlocked = ran.blockedAgain;
      // What the model wrote in this step (not its reasoning nor its calls) may bring memory or bookmarks,
      // and its plan a reminder: after the last result, also inside its content (what the model reads).
      const reply = builder.parts.map((p) => (p.type === 'text' && !p.context ? p.text : '')).join('').trim();
      const attachAfter = context.attachAfter;
      const extra = attachAfter
        ? await phases.time({ kind: 'attach', label: 'Attached after the results' }, async () => (await bestEffort(attachAfter(reply, [...messages, { role: 'tool', parts: results }]), 'attach-after')) ?? [], (items) => (items.length ? attachedDetail(items) : undefined))
        : [];
      const last = results.at(-1);
      if (extra.length && last?.type === 'tool_result') {
        results[results.length - 1] = {
          ...last,
          content: [last.content, ...extra.map((e) => e.text)].join('\n\n'),
          attached: extra.map((e) => ({ kind: e.kind, text: e.text, ...(e.source && { source: e.source }) })),
        };
      }
      const toolMsg: Message = { role: 'tool', parts: results };
      messages.push(toolMsg);
      yield { type: 'message', message: toolMsg };
    }
    // Out of steps: the history ends with tool results, so running it again continues the turn.
    yield { type: 'step-limit', steps: maxSteps };
    yield { type: 'done' };
  } catch (e) {
    yield signal.aborted ? { type: 'done' } : { type: 'error', error: errorText(e) };
  }
}

// The last request as its server counted it, and as it was estimated (before the model's correction).
interface Anchor {
  reported: number;
  estimated: number;
}

// What the model gets (compacted), once for the request and its estimates; shortened more while it
// would not fit the model's window, or after the server refused one of the run's as too long. On a
// window that is only Settings → Compaction's guess ('default'), no more than 1 on its own.
// Its size: from the last call the server reported (`anchor`), that plus what changed since, as
// corrected for the model; else the whole estimate so corrected.
// `shortened`: the window left something out of it; `estimated`: the request sent, uncorrected (the
// next anchor's); `full`: what the chat is told when it was shortened.
function fitView(opts: LoopOptions, messages: Message[], run: { elements: ReadonlyMap<string, string>; specs: ToolSpec[]; refused: boolean; anchor?: Anchor }) {
  const { model, context } = opts;
  const { elements, specs, anchor } = run;
  const ratio = model.tokenRatio ?? 1;
  const viewOf = (squeeze: 0 | 1 | 2) => context.view(model.system, messages, { elements, ...(squeeze && { squeeze }) });
  const rawOf = (v: { system?: string; messages: Message[] }) => {
    const request = { system: v.system, tools: specs, messages: v.messages };
    return context.estimate ? context.estimate(request) : context.measure(request, []).tokens.input;
  };
  const inputOf = (raw: number) => Math.max(0, Math.round(anchor ? anchor.reported + (raw - anchor.estimated) * ratio : raw * ratio));
  let squeeze: 0 | 1 | 2 = run.refused ? 2 : 0;
  const most = squeeze === 2 || model.windowSource !== 'default' ? 2 : 1;
  let view = viewOf(squeeze);
  const limit = model.contextWindow && model.contextWindow * FULL;
  let raw = rawOf(view);
  const before = inputOf(raw);
  let input = before;
  while (limit && squeeze < most && input > limit) {
    view = viewOf(++squeeze as 1 | 2);
    raw = rawOf(view);
    input = inputOf(raw);
  }
  const shortened = input < before;
  const full = shortened && model.contextWindow
    ? { input: before, window: model.contextWindow, source: model.windowSource, tools: Math.round(rawOf({ messages: [] }) * ratio) }
    : undefined;
  return { view, squeeze, shortened, estimated: raw, full };
}

// How a request to the model ended: answered (cut when the model was caught in a loop: `looped`, what
// it kept repeating), or to go again: without tools (the model takes none), or shortened most (the
// server refused it as too long).
type StepAnswer =
  | { again: 'without-tools' | 'shortened' }
  | { again?: undefined; reported?: CallUsage['reported']; callStart: number; firstTokenMs?: number; looped?: string };

// One request to the model, streamed into `builder`: its deltas and notices as they come.
// `phases`: under the call's phase, its parts: the wait for the first token, then the reasoning and
// the answer as they take turns.
async function* streamStep(opts: LoopOptions, request: ChatRequest, builder: PartsBuilder, { squeeze, signal, phases }: { squeeze: number; signal: AbortSignal; phases: PhaseRecorder }): AsyncGenerator<LoopEvent, StepAnswer> {
  const { model, hooks = {} } = opts;
  let reported: CallUsage['reported'];
  let started = false;
  const callStart = Date.now();
  let firstTokenMs: number | undefined;
  // This call's own signal: cut when the model is caught in a loop, as when the run is stopped.
  const call = new AbortController();
  let looped: string | undefined; // what the model kept repeating
  const waiting = phases.start({ kind: 'wait', label: 'Waiting for the first token' });
  let part: { kind: 'reasoning' | 'answer'; phase: PhaseHandle } | undefined;
  const partIs = (kind: 'reasoning' | 'answer' | undefined) => {
    if (part?.kind === kind) return;
    part?.phase.end();
    part = kind && { kind, phase: phases.start({ kind, label: kind === 'reasoning' ? 'Reasoning' : 'Answer' }) };
  };
  try {
    const stream: AsyncIterable<ChatEvent> = model.provider.chat(request, AbortSignal.any([signal, call.signal]));
    for await (const evt of stream) {
      started = true;
      if (evt.type === 'usage') reported = { input: evt.inputTokens, output: evt.outputTokens, ...(evt.reasoningTokens !== undefined && { reasoning: evt.reasoningTokens }), ...(evt.cachedTokens !== undefined && { cached: evt.cachedTokens }) };
      if (firstTokenMs === undefined && (evt.type === 'text-delta' || evt.type === 'reasoning-delta' || evt.type === 'tool-call')) {
        firstTokenMs = Date.now() - callStart;
        waiting.end();
      }
      if (evt.type === 'reasoning-delta') partIs('reasoning');
      else if (evt.type === 'text-delta') partIs('answer');
      else if (evt.type === 'reasoning-end') partIs(undefined);
      builder.add(evt);
      if (evt.type === 'text-delta' || evt.type === 'reasoning-delta' || evt.type === 'notice') yield evt;
      if ((evt.type === 'text-delta' || evt.type === 'reasoning-delta') && (looped = builder.loopAfter(evt.text.length))) break;
    }
  } catch (e) {
    // Models without tool support (e.g. some Ollama models) reject the request: retry without tools.
    if (!started && request.tools && e instanceof ToolsUnsupportedError) {
      yield { type: 'notice', text: `${model.name} does not support tools: this turn goes on without them.` };
      return { again: 'without-tools' };
    }
    const error = errorText(e);
    // Refused as too long: once more, shortened as much as it can be, as every request after it.
    if (!started && squeeze < 2 && model.overflowed?.(error)) {
      hooks.onOverflow?.(error);
      yield { type: 'notice', text: SENT_SHORTER };
      return { again: 'shortened' };
    }
    // Cut for a loop: what the stream says as it ends does not matter.
    if (!looped) throw e;
  } finally {
    if (looped) call.abort();
    waiting.end(firstTokenMs === undefined ? 'no answer' : undefined);
    partIs(undefined);
  }
  return { reported, callStart, firstTokenMs, looped };
}

// The step's tool calls, one after the other: their results; none when the run was stopped (none of
// the calls left runs; the panel keeps what it showed). `failed`: how many times each call failed in
// the turn (core/repeated-calls), counted on as these run. `blockedAgain`: one of them was not run
// for the second time in the turn, so the model does not heed the reply that says why.
async function runCalls(opts: LoopOptions, tools: ToolRegistry, calls: Extract<Part, { type: 'tool_call' }>[], { elements, failed }: { elements: Map<string, string>; failed: Map<string, number> }, signal: AbortSignal): Promise<{ results: Part[]; blockedAgain: boolean } | undefined> {
  const { hooks = {} } = opts;
  const phases = hooks.phases ?? noPhases;
  const ctx: ToolContext = { ...opts.tools.context, signal };
  const results: Part[] = [];
  let blockedAgain = false;
  for (const call of calls) {
    if (signal.aborted) return undefined;
    const key = callKey(call.name, call.args);
    const failures = failed.get(key) ?? 0;
    if (failures >= BLOCK_AFTER) {
      failed.set(key, failures + 1);
      blockedAgain ||= failures > BLOCK_AFTER;
      hooks.log?.({ tool: tools.get(call.name)?.name ?? call.name, at: Date.now(), ms: 0, refused: 'repeated failing call' });
      results.push({ type: 'tool_result', toolCallId: call.id, content: text('result.repeated_call_blocked'), isError: true });
      hooks.onResult?.(results[results.length - 1]!);
      continue;
    }
    // The tab it names, as it is before the call (what it was asked to act on).
    const named = namedTab(call.args);
    const tab = named === undefined ? undefined : await hooks.tabOf?.(named).catch(() => undefined);
    // A tool that runs others (script/steps) runs each as a call of the model's would, with no
    // tool() of its own; its steps are shown under its call.
    let subCall = 0;
    const inner: ToolContext = { ...ctx, callId: undefined };
    // By the name as written ("browser.find"); the registry has them as the model calls them.
    const callTool: ToolContext['callTool'] = (name, args) => execute(opts, opts.tools.stepTools ?? tools, toWireName(name), args, { ...inner, callId: `${call.id}.${++subCall}` });
    const emit: ToolContext['emit'] = (label, message) => hooks.onSub?.(call.id, label, { type: 'message', message });
    const name = tools.get(call.name)?.name ?? call.name;
    const phase = phases.start({ kind: DELEGATES.has(name) ? 'agent' : 'tool', label: name, id: callPhaseId(call.id) });
    const { data: _data, elements: list, ...done } = await execute(withConfirmPhase(opts, phases.under(phase.id)), tools, call.name, call.args, { ...ctx, callId: call.id, callTool, emit }).finally(() => phase.end());
    if (done.isError) phase.note(done.content.split('\n')[0]!.slice(0, 120));
    if (list) elements.set(call.id, list);
    if (done.isError) failed.set(key, failures + 1);
    const content = done.isError && failures ? `${done.content}\n\n${text('result.repeated_failure')}` : done.content;
    results.push({ type: 'tool_result', toolCallId: call.id, ...done, content, ...(tab && { tab }) });
    hooks.onResult?.(results[results.length - 1]!);
  }
  return { results, blockedAgain };
}

// The tools that hand work to another agent: their phase says so (an agent asked, one started).
const DELEGATES = new Set(['agents.ask', 'panel.start']);

// A call's policy timed: when it asked the user, the wait for the answer is a phase of its own, so the
// call's own time can be told from yours.
function withConfirmPhase(opts: LoopOptions, phases: PhaseRecorder): LoopOptions {
  const { authorize } = opts.tools;
  if (!authorize) return opts;
  return {
    ...opts,
    tools: {
      ...opts.tools,
      authorize: async (tool, args, ctx) => {
        const at = Date.now();
        const auth = await authorize(tool, args, ctx);
        if (auth.seen?.asked) phases.add({ kind: 'confirm', label: 'Waiting for your confirmation', detail: auth.seen.asked, at, ms: Date.now() - at });
        return auth;
      },
    },
  };
}

// What was attached between steps, for its phase: how many of each kind.
function attachedDetail(items: ContextItem[]): string {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.kind, (counts.get(i.kind) ?? 0) + 1);
  return [...counts].map(([kind, n]) => `${n} ${kind}`).join(', ');
}
