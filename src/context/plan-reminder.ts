// Between the model's steps: the plan it showed in this turn (tools/user latestPlan), when it still has
// steps to do, after that step's last tool result (LoopContext.attachAfter): each time the tool calls
// since the model last showed it pass a multiple of the planReminder limit, or those of the whole turn
// one of planReminderAlways (0: off), which comes even when it keeps updating it. One from an earlier
// turn is left alone: the user may have moved on.
import type { ContextItem } from '../core/messages';
import { limit } from '../core/limits';
import { text } from '../core/model-texts';
import type { Message } from '../core/types';
import { latestPlan, PLAN_TOOL, planDone, type PlanStep } from '../tools/user/shapes';
import { PLAN_REMINDER_SOURCE } from './sources';

export const PLAN_START_REMINDER_ROUNDS = 3;

// The steps as the model reads them.
export const planStepLines = (steps: PlanStep[]) => steps.map((s) => text('plan.step', { status: s.status, title: s.title })).join('\n');

const toolRounds = (messages: Message[]) => messages.filter((m) => m.role === 'assistant' && m.parts.some((p) => p.type === 'tool_call')).length;
// The model's tool calls, its plan's own left out.
const toolCalls = (messages: Message[]) => messages.reduce((n, m) => n + (m.role === 'assistant' ? m.parts.filter((p) => p.type === 'tool_call' && p.name !== PLAN_TOOL).length : 0), 0);
// Whether the calls, with those of the last step, went past a multiple of `every` (0: never).
const passes = (before: number, after: number, every: number) => every > 0 && Math.floor(after / every) > Math.floor(before / every);

// `messages`: the conversation with the step's tool results.
export function planReminder(messages: Message[]): ContextItem | undefined {
  const plan = latestPlan(messages);
  const turn = messages.findLastIndex((m) => m.role === 'user');
  if (!plan || plan.dismissed || planDone(plan.steps) || turn > plan.at) return undefined;
  const step = messages.findLastIndex((m) => m.role === 'assistant');
  if (step <= plan.at) return undefined; // the step that showed it
  const count = (from: number) => [toolCalls(messages.slice(from + 1, step)), toolCalls(messages.slice(from + 1))] as const;
  const [sincePlan, sincePlanNow] = count(plan.at);
  const [inTurn, inTurnNow] = count(turn);
  if (!passes(sincePlan, sincePlanNow, limit('planReminder')) && !passes(inTurn, inTurnNow, limit('planReminderAlways'))) return undefined;
  return { kind: 'tool', text: text('plan.reminder', { calls: String(inTurnNow), plan_steps: planStepLines(plan.steps) }), source: PLAN_REMINDER_SOURCE };
}

// No plan shown in this turn after PLAN_START_REMINDER_ROUNDS rounds of tool calls: asks for one, once a turn.
export function planStartReminder(messages: Message[]): ContextItem | undefined {
  const turn = messages.findLastIndex((m) => m.role === 'user');
  if ((latestPlan(messages)?.at ?? -1) > turn) return undefined;
  const rounds = toolRounds(messages.slice(turn + 1));
  if (rounds !== PLAN_START_REMINDER_ROUNDS) return undefined;
  return { kind: 'tool', text: text('plan.start_reminder', { rounds: String(rounds) }), source: PLAN_REMINDER_SOURCE };
}

// What goes after a step's results: the plan shown, or the request for one while the model can show it.
export function stepPlanReminder(messages: Message[], offered: boolean): ContextItem | undefined {
  return planReminder(messages) ?? (offered ? planStartReminder(messages) : undefined);
}
