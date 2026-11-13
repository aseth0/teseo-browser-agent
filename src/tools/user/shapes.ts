// What the user tools take, checked (pure: the panel reads the plan from the calls too).
import { fields } from '../define';
import { toWireName } from '../../core/tool-registry';
import type { AskQuestion, Message } from '../../core/types';

export const MAX_QUESTIONS = 4;

type PlanStatus = 'pending' | 'in_progress' | 'done';
export interface PlanStep {
  title: string;
  status: PlanStatus;
}

// The questions as the model wrote them, checked: what the card can show.
export function questionsOf(args: unknown): AskQuestion[] {
  const list = fields(args).questions;
  if (!Array.isArray(list) || !list.length) throw new Error('questions: give 1 to 4 questions');
  if (list.length > MAX_QUESTIONS) throw new Error(`questions: at most ${MAX_QUESTIONS} at a time`);
  return list.map((q: Partial<AskQuestion>, i) => {
    if (!q?.question) throw new Error(`questions[${i}].question is missing`);
    const type = q.type ?? (q.options?.length ? 'choice' : 'text');
    if (type !== 'text' && !(q.options?.length && q.options.length >= 2)) throw new Error(`questions[${i}]: a ${type} question needs 2 or more options`);
    return { question: q.question, header: q.header, type, options: type === 'text' ? undefined : q.options, placeholder: q.placeholder };
  });
}

export function planOf(args: unknown): PlanStep[] {
  const steps = fields(args).steps;
  if (!Array.isArray(steps) || !steps.length) throw new Error('steps: give the whole list of steps');
  return steps.map((s: Partial<PlanStep>, i) => {
    if (!s?.title) throw new Error(`steps[${i}].title is missing`);
    const status = s.status ?? 'pending';
    if (!['pending', 'in_progress', 'done'].includes(status)) throw new Error(`steps[${i}].status must be pending, in_progress or done`);
    return { title: s.title, status };
  });
}

// The last plan the model showed in the conversation (its last user.plan call that ran), with that call's
// id and the index of its message: the panel pins it, the agent loop reminds the model of it.
export const PLAN_TOOL = toWireName('user.plan'); // as the model calls it, in the history
export function latestPlan(history: Message[]): { id: string; at: number; steps: PlanStep[]; dismissed?: boolean } | undefined {
  const ran = new Set(history.flatMap((m) => m.parts.flatMap((p) => (p.type === 'tool_result' && !p.isError ? [p.toolCallId] : []))));
  for (let at = history.length - 1; at >= 0; at--) {
    for (const p of [...history[at]!.parts].reverse()) {
      if (p.type !== 'tool_call' || p.name !== PLAN_TOOL || !ran.has(p.id)) continue;
      try {
        return { id: p.id, at, steps: planOf(p.args), ...(p.dismissed && { dismissed: true }) };
      } catch {
        continue;
      }
    }
  }
  return undefined;
}

export const planDone = (steps: PlanStep[]) => steps.every((s) => s.status === 'done');

// The history with the plans taken away (their calls' ids) marked. Marked, the panel does not pin one,
// and the model is neither reminded of it (context/plan-reminder) nor sent it after a compaction.
export function withPlansDismissed(history: Message[], ids: ReadonlySet<string>): Message[] {
  if (!ids.size) return history;
  return history.map((m) => (m.parts.some((p) => p.type === 'tool_call' && ids.has(p.id))
    ? { ...m, parts: m.parts.map((p) => (p.type === 'tool_call' && ids.has(p.id) ? { ...p, dismissed: true } : p)) }
    : m));
}

// Whether the panel pins the plan: not once taken away (its call's id), nor once every step is done and
// the turn that sent it has ended (a new plan with steps to do brings it back).
export function planShown(plan: { at: number; steps: PlanStep[]; dismissed?: boolean }, history: Message[], { busy }: { busy: boolean }): boolean {
  if (plan.dismissed) return false;
  return !planDone(plan.steps) || (busy && plan.at > history.findLastIndex((m) => m.role === 'user'));
}
