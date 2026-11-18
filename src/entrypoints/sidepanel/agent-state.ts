// The side panel's conversation state (useAgent) and how it changes: a pure reducer, so that every
// way a turn starts or ends clears the same things.
import { withPlansDismissed } from '../../tools/user/shapes';
import { appendContext, keepSystemMemory, markStopped } from '../../core/messages';
import { appendLive, type LiveSegment, type SubRun } from '../../core/live';
import type { BackgroundToPanel } from '../../core/protocol';
import type { AccessRequest, ActionDetail, CallUsage, Compaction, Message, Part, TurnPhase, UserRequest } from '../../core/types';
import { unknownCase } from '../../core/util';
import { keepPhases, withPhase } from '../../core/phases';
import { callTokens, contextUsed, estimateOutput, estimateReasoning } from '../../context/usage';

// What the agent is waiting for: approval of an action, or access to a site.
export type Confirmation =
  | { kind: 'action'; id: string; summary: string; details?: ActionDetail[]; host: string; agent?: string; problem?: string; edited?: Record<string, string> } // problem, edited: asked again after the user's edits
  | ({ kind: 'access'; id: string } & AccessRequest)
  | { kind: 'user'; id: string; request: UserRequest } // a tool asks the user (tools/user)
  | { kind: 'more-steps'; id: string; agent: string; steps: number }; // a sub-agent ran out of steps: go on?

// Context accounting for the current conversation.
export interface SessionUsage {
  last?: CallUsage; // the latest model call: how full the context is now
  previous?: CallUsage; // the call before it, when this panel saw both: what changed since
  calls: number;
  input: number; // summed over calls (reported, or estimated when the server does not say)
  output: number;
  reasoning?: number; // of `output`, the reasoning (as servers split it, else estimated)
  cached?: number; // of `input`, what the servers' prompt caches served, where they say
  timeline?: UsageTimeline;
}

// This conversation's model calls (not its sub-agents'), for the context meter's chart: the input of
// each, and the compactions as the number of calls before each.
export interface UsageTimeline {
  inputs: number[];
  compactedAt: number[];
}

export interface AgentState {
  conversationId: string; // its key in the history
  history: Message[];
  live: LiveSegment[];
  subs: Record<string, SubRun>; // the sub-agents running, by the call they answer
  busy: boolean;
  compacting: boolean; // the earlier turns are being compacted (useCompaction): no other conversation meanwhile
  status: string; // what the agent does before the model answers
  error: string;
  notices: string[];
  stepLimit: number | null; // the turn stopped there, unanswered
  confirmations: Confirmation[];
  usage: SessionUsage;
  results: Part[]; // the step's results as its calls ended, until its results message: kept on a Stop
  phases: TurnPhase[]; // the turn's phases as they go (core/phases): kept in your message once it ends
}

export type AgentAction =
  | { type: 'event'; event: BackgroundToPanel } // from the background, through the port
  | { type: 'run'; history: Message[] } // a turn starts
  | { type: 'finish'; error?: string } // it ends (or the agent could not be reached)
  | { type: 'stop'; interrupted?: boolean } // stopped by the user (interrupted: by a message sent at once): what was streamed stays, marked as stopped
  | { type: 'lost' } // the port disconnected
  | { type: 'load'; conversationId: string; history: Message[] } // another conversation: new or saved
  | { type: 'answered'; id: string } // a confirmation card was answered
  | { type: 'compacting'; on: boolean }
  | { type: 'plan-dismissed'; id: string } // the user took this plan away (its call's id)
  | { type: 'history'; conversationId: string; history: Message[]; compaction?: Compaction }; // compacted between turns, for that conversation

const EMPTY_USAGE: SessionUsage = { calls: 0, input: 0, output: 0 };

export const initialAgentState = (conversationId: string): AgentState => ({
  conversationId,
  history: [],
  live: [],
  subs: {},
  busy: false,
  compacting: false,
  status: '',
  error: '',
  notices: [],
  stepLimit: null,
  confirmations: [],
  usage: EMPTY_USAGE,
  results: [],
  phases: [],
});

// What a turn leaves behind while it goes, cleared when it ends.
const endTurn = (s: AgentState, error = ''): AgentState => ({
  ...s,
  history: keepPhases(s.history, s.phases),
  phases: [],
  busy: false,
  status: '',
  live: [],
  subs: {},
  confirmations: [],
  results: [],
  ...(error && { error }),
});

// Before a turn, or another conversation: nothing of the last one shows.
const resetTurn = (s: AgentState): AgentState => ({ ...endTurn(s), error: '', notices: [], stepLimit: null });

// The turn ended without the agent saying so (the port lost, an error): what was streamed stays and
// tool calls left without results get one, marked as stopped (markStopped), so the history stays one
// the servers accept. Unchanged when nothing was left half done.
function cutShort(s: AgentState): AgentState {
  const last = s.history.at(-1);
  const halfDone = s.live.some((l) => l.text) || (last?.role === 'assistant' && last.parts.some((p) => p.type === 'tool_call'));
  return halfDone ? { ...s, history: markStopped(s.history, s.live, false, s.results) } : s;
}

export const LOST_CONNECTION = 'Lost the connection to the agent. Send the message again.';

export function agentReducer(s: AgentState, action: AgentAction): AgentState {
  switch (action.type) {
    case 'event':
      return onEvent(s, action.event);
    case 'run':
      // Regenerated (a shorter history): the chart as a reload would show it; the totals stay paid.
      return { ...resetTurn(s), history: action.history, busy: true, ...(action.history.length < s.history.length && { usage: { ...s.usage, previous: undefined, timeline: timelineOf(action.history) } }) };
    case 'finish':
      return endTurn(s, action.error);
    case 'stop':
      return endTurn({ ...s, history: markStopped(s.history, s.live, action.interrupted, s.results) });
    case 'lost':
      return s.busy ? endTurn(cutShort(s), LOST_CONNECTION) : s;
    case 'load':
      return { ...resetTurn(s), conversationId: action.conversationId, history: action.history, usage: usageOf(action.history) };
    case 'answered':
      return { ...s, confirmations: s.confirmations.filter((c) => c.id !== action.id) };
    case 'compacting':
      return { ...s, compacting: action.on };
    case 'plan-dismissed':
      return planDismissed(s, action.id);
    case 'history':
      // Compacted from what another conversation was (one opened meanwhile): dropped.
      if (action.conversationId !== s.conversationId) return s;
      return { ...s, history: action.history, usage: action.compaction ? withCompaction(s.usage, action.compaction) : s.usage };
  }
}

const planDismissed = (s: AgentState, id: string): AgentState => ({ ...s, history: withPlansDismissed(s.history, new Set([id])) });

function onEvent(s: AgentState, evt: BackgroundToPanel): AgentState {
  switch (evt.type) {
    case 'plan-dismissed':
      return planDismissed(s, evt.id);
    case 'resume': // a run of this conversation that went on while this chat was away: the rest follows
      return { ...resetTurn(s), history: evt.history, usage: usageOf(evt.history), busy: true };
    case 'status':
      return { ...s, status: evt.text };
    case 'phase':
      return s.busy ? { ...s, phases: withPhase(s.phases, evt.phase) } : s;
    case 'text-delta':
      return { ...s, live: appendLive(s.live, 'text', evt.text) };
    case 'reasoning-delta':
      return { ...s, live: appendLive(s.live, 'reasoning', evt.text) };
    case 'context':
      // Stored in the last user message so later turns resend it unchanged.
      return { ...s, status: '', history: appendContext(s.history, evt.items) };
    case 'system-memory':
      return { ...s, history: keepSystemMemory(s.history, evt.memory) };
    case 'message':
      return { ...s, live: [], results: [], history: [...s.history, evt.message] };
    case 'tool-result':
      return { ...s, results: [...s.results, evt.result] };
    case 'usage':
      return { ...s, usage: addCall(s.usage, evt.usage) };
    case 'notice':
      return s.notices.includes(evt.text) ? s : { ...s, notices: [...s.notices, evt.text] };
    case 'step-limit':
      return { ...s, stepLimit: evt.steps };
    case 'confirm':
      return { ...s, confirmations: [...s.confirmations, { kind: 'action', id: evt.id, summary: evt.summary, details: evt.details, host: evt.host, agent: evt.agent, problem: evt.problem, edited: evt.edited }] };
    case 'access': {
      const { type: _type, ...access } = evt;
      return { ...s, confirmations: [...s.confirmations, { kind: 'access', ...access }] };
    }
    case 'tool-match': {
      // Kept in your message, for the views and the next turns (tools/match).
      const last = s.history.at(-1);
      return last?.role === 'user' ? { ...s, history: [...s.history.slice(0, -1), { ...last, toolMatch: evt.match }] } : s;
    }
    case 'auto-attach': {
      // Kept in your message, for Layers.
      const last = s.history.at(-1);
      return last?.role === 'user' ? { ...s, history: [...s.history.slice(0, -1), { ...last, autoAttach: evt.check }] } : s;
    }
    case 'user-request':
      return { ...s, confirmations: [...s.confirmations, { kind: 'user', id: evt.id, request: evt.request }] };
    case 'more-steps':
      return { ...s, confirmations: [...s.confirmations, { kind: 'more-steps', id: evt.id, agent: evt.agent, steps: evt.steps }] };
    case 'user-closed':
      return { ...s, confirmations: s.confirmations.filter((c) => c.id !== evt.id) };
    case 'sub': {
      // Its model calls count in the session's totals, not in how full this conversation is.
      const { callId, agent, event } = evt;
      if (event.type === 'usage') return { ...s, usage: addSubCall(s.usage, event.usage) };
      const run = s.subs[callId] ?? { agent, messages: [], live: [] };
      const next =
        event.type === 'text-delta' ? { ...run, live: appendLive(run.live, 'text', event.text) }
        : event.type === 'reasoning-delta' ? { ...run, live: appendLive(run.live, 'reasoning', event.text) }
        : event.type === 'message' ? { ...run, messages: [...run.messages, event.message], live: [] }
        : undefined;
      return next ? { ...s, subs: { ...s.subs, [callId]: next } } : s;
    }
    case 'error':
      return endTurn(cutShort(s), evt.error);
    case 'done':
      return endTurn(s);
    default:
      unknownCase(evt); // a newer build's event changes nothing
      return s;
  }
}

// The usage of a saved conversation, from the tokens its model calls recorded: the last one says how
// full the context was (its input as a whole: how it split is not kept; its answer as sent back, from
// its parts when the server did not say how much of it was reasoning).
function usageOf(history: Message[]): SessionUsage {
  if (!history.some((m) => m.meta || m.compaction)) return EMPTY_USAGE;
  const answers = history.flatMap((m) => (m.meta ? [{ parts: m.parts, meta: m.meta }] : []));
  const calls = answers.map((a) => a.meta);
  const lastAnswer = answers.at(-1);
  const last = lastAnswer?.meta;
  const usage: SessionUsage = {
    calls: calls.length,
    input: calls.reduce((n, c) => n + c.input, 0),
    output: calls.reduce((n, c) => n + c.output, 0),
    reasoning: answers.reduce((n, a) => n + (a.meta.reasoning ?? estimateReasoning(a.parts)), 0),
    cached: calls.reduce((n, c) => n + (c.cached ?? 0), 0),
    timeline: timelineOf(history),
    last: last && {
      breakdown: { system: 0, tools: 0, conversation: last.input, pageContext: 0, skills: 0, toolResults: 0 },
      estimatedOutput: estimateOutput(lastAnswer.parts),
      estimatedReasoning: estimateReasoning(lastAnswer.parts),
      ...(last.reported && { reported: { input: last.input, output: last.output, ...(last.reasoning !== undefined && { reasoning: last.reasoning }), ...(last.cached !== undefined && { cached: last.cached }) } }),
    },
  };
  // The compactions made after that call (from the meter, or one whose turn then did not go): what they left.
  const lastCall = history.findLastIndex((m) => m.meta);
  const since = history.flatMap((m) => (m.compaction?.ranAfter && m.compaction.ranAfter > lastCall ? [m.compaction] : []));
  return compactedUsage(usage, since.sort((a, b) => a.at - b.at));
}

// A saved conversation's calls and its compactions, each after the calls of the messages before it
// ran (or before the message it is on).
export function timelineOf(history: Message[]): UsageTimeline {
  const inputs = history.flatMap((m) => (m.meta ? [m.meta.input] : []));
  const callsBefore = (end: number) => history.slice(0, end).filter((m) => m.meta).length;
  const compactedAt = [...new Set(history.flatMap((m, i) => (m.compaction ? [callsBefore(m.compaction.ranAfter ?? i)] : [])))].sort((a, b) => a - b);
  return { inputs, compactedAt };
}

// The context as compactions after the latest call left it: that call's, less what they took out
// (estimated), until the next call says.
function compactedUsage(u: SessionUsage, compactions: Compaction[]): SessionUsage {
  if (!u.last || !compactions.length) return u;
  const used = compactions.reduce((n, c) => n - c.before + c.after, contextUsed(u.last));
  const conversation = Math.max(0, Math.round(used));
  return { ...u, previous: undefined, last: { breakdown: { system: 0, tools: 0, conversation, pageContext: 0, skills: 0, toolResults: 0 }, estimatedOutput: 0 } };
}

// A compaction between turns: on the chart after the calls so far, and in how full the context is.
function withCompaction(u: SessionUsage, compaction: Compaction): SessionUsage {
  const timeline = u.timeline ?? { inputs: [], compactedAt: [] };
  const at = timeline.inputs.length; // one mark for compactions with no call between them
  const compactedAt = timeline.compactedAt.includes(at) ? timeline.compactedAt : [...timeline.compactedAt, at];
  return compactedUsage({ ...u, timeline: { ...timeline, compactedAt } }, [compaction]);
}

function addTotals(u: SessionUsage, call: CallUsage): SessionUsage {
  const { input, output, reasoning, cached } = callTokens(call);
  return { ...u, calls: u.calls + 1, input: u.input + input, output: u.output + output, reasoning: (u.reasoning ?? 0) + (reasoning ?? call.estimatedReasoning ?? 0), cached: (u.cached ?? 0) + (cached ?? 0) };
}

function addCall(u: SessionUsage, call: CallUsage): SessionUsage {
  const timeline = u.timeline ?? { inputs: [], compactedAt: [] };
  return { ...addTotals(u, call), last: call, previous: u.last, timeline: { ...timeline, inputs: [...timeline.inputs, callTokens(call).input] } };
}

function addSubCall(u: SessionUsage, call: CallUsage): SessionUsage {
  return addTotals(u, call);
}
