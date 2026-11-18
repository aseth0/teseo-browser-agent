// A brief: how an agent hands work to another (agents.ask, panel.start). The task, the only field
// required, then what is already known, what not to do, when it is done and what to send back, each
// optional. The asked agent gets it laid out in sections ({task} of agent.task and panel.task, so a
// text the user edited keeps working), ending with how to shape its answer: the result, what it did,
// and what it could not do or verify.
import type { JSONSchema } from '../core/types';
import { text } from '../core/model-texts';
import { fields, optString } from '../tools/define';

export const BRIEF_FIELDS = ['context', 'constraints', 'done', 'report'] as const;
export type BriefField = (typeof BRIEF_FIELDS)[number];
export type Brief = { task: string } & Partial<Record<BriefField, string>>;

// The schema's fields, after those each tool requires (agent, task, url).
export const TASK_PROPERTY: JSONSchema = { type: 'string', description: 'What it should do or find out. It sees nothing else: give every detail it needs here or in context.' };
export const BRIEF_PROPERTIES: Record<BriefField, JSONSchema> = {
  context: { type: 'string', description: 'Optional. What is already known, tried or ruled out.' },
  constraints: { type: 'string', description: 'Optional. What it must not do or touch.' },
  done: { type: 'string', description: 'Optional. How it knows it has finished.' },
  report: { type: 'string', description: 'Optional. What to send back, and in what shape.' },
};

// How the user sees each field (a confirmation card).
export const BRIEF_LABELS: Record<BriefField, string> = { context: 'Already known', constraints: 'Do not', done: 'Done when', report: 'Send back' };

const SECTION = { context: 'brief.context', constraints: 'brief.constraints', done: 'brief.done', report: 'brief.report' } as const;

// The brief a call gives: none without a task. A field empty, blank or not a string is left out.
export function briefOf(args: unknown): Brief | undefined {
  const f = fields(args);
  const task = optString(f.task)?.trim();
  if (!task) return undefined;
  const brief: Brief = { task };
  for (const k of BRIEF_FIELDS) {
    const v = f[k];
    if (typeof v === 'string' && v.trim()) brief[k] = v.trim();
  }
  return brief;
}

// The task and its sections, as the user reads them (a row's chat in the Agents Panel).
export const briefShown = (b: Brief) => b.task + BRIEF_FIELDS.map((k) => (b[k] ? text(SECTION[k], { [k]: b[k] }) : '')).join('');

// What the asked agent gets as {task}: the sections, then how to shape its answer.
export const briefText = (b: Brief) => briefShown(b) + text('brief.answer');

// The fields a call gave, for a confirmation card: each with its label.
export const briefDetails = (b: Brief) => BRIEF_FIELDS.flatMap((k) => (b[k] ? [{ label: BRIEF_LABELS[k], value: b[k] }] : []));

// A call's arguments in the schema's order, whatever order the model wrote them in (the chat's view).
const ORDER = ['agent', 'task', 'url', ...BRIEF_FIELDS];
export function inBriefOrder(args: unknown): unknown {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args;
  const rank = (k: string) => (ORDER.includes(k) ? ORDER.indexOf(k) : ORDER.length);
  return Object.fromEntries(Object.entries(args).sort(([a], [b]) => rank(a) - rank(b)));
}
