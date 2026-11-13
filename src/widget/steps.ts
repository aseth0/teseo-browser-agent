// Steps of a page widget action: instead of one tool and one prompt, steps run in
// order, each named, each able to use what the ones before it gave as {name} or {name.path}
// ("{ticket.fields.summary}", "{search.items[0].id}"):
//   { "name": "page", "read": "{{url}}", "match": "https?://(?<domain>[^/]+)/browse/(?<id>[A-Z]+-\\d+)" }
//   { "name": "ticket", "tool": "jira.issue", "args": { "key": "{page.id}" }, "extract": "fields" }
//   { "name": "triage", "prompt": "Triage {page.id}: {ticket.summary}", "fields": { "priority": ["High", "Low"] } }
// A read step's value is read in the page (as the action's reads); its match keeps a part of it: the
// named groups as an object, else the first group, else what matched. A tool step runs as the
// action's tool would; its match cuts an answer in text into a list. A model step asks the model,
// which may call the step's tools first; its answer a text, or with fields a JSON object checked
// against them, asked again once when it does not match. The boxes and the badge take their values
// from all of them, by the same paths.
import { neutralizeTags, text, truncate } from '../core/model-texts';
import type { Message, Tool, ToolContext, ToolSpec } from '../core/types';
import { toWireName } from '../core/tool-registry';
import { extractPath } from '../tools/http';
import { baseParams } from '../tools/custom/runtime';
import { parseVariable } from '../skills/variables';
import { isObject } from '../core/util';
import { errorText } from '../core/errors';
import type { WidgetAction } from './actions';
import { outputLines } from './output-lines';
import { STOPPED, type WidgetOutputs, type WidgetRunReply } from './protocol';

export type FieldType = 'text' | 'number' | 'boolean' | string[];
export interface ReadStep { name: string; read: string; match?: string }
// match: on an answer in text, every match; each: a path to a list, the tool run once per item ({item})
export interface ToolStep { name: string; tool: string; args?: Record<string, string>; extract?: string; match?: string; each?: string }
export interface ModelStep { name: string; prompt: string; fields?: Record<string, FieldType>; tools?: string[] } // tools: those the model may call, by name
export type ActionStep = ReadStep | ToolStep | ModelStep;
export type StepKind = 'read' | 'tool' | 'model';

export const stepKind = (s: ActionStep): StepKind => ('read' in s ? 'read' : 'tool' in s ? 'tool' : 'model');
export const hasSteps = (a: Pick<WidgetAction, 'steps'>) => !!a.steps?.length;
export const hasModelStep = (a: Pick<WidgetAction, 'steps'>) => !!a.steps?.some((s) => stepKind(s) === 'model');
// The page values its read steps take, by name, as the action's reads are.
export const readStepsOf = (a: Pick<WidgetAction, 'steps'>): Record<string, string> =>
  Object.fromEntries((a.steps ?? []).filter((s): s is ReadStep => stepKind(s) === 'read').map((s) => [s.name, s.read]));

// What a step did, as the editor's Try shows it while it runs.
export interface StepTrace {
  i: number;
  name: string;
  kind: StepKind;
  status: 'running' | 'done' | 'error';
  ms?: number;
  sent?: unknown; // the read value, the tool's arguments, or the prompt
  value?: unknown;
  error?: string;
  attempt?: number; // a model step asked again
  calls?: StepCall[]; // a model step's calls to its tools, or a tool's for each item
  of?: number; // for each item: how many the list had, when it ran for only the first MAX_EACH
}

// A call a model step made, and what it got.
export interface StepCall {
  tool: string;
  args: unknown;
  value?: unknown;
  error?: string;
}

const MAX_TOOL_ROUNDS = 6; // a model step's requests that call tools, before it must answer
const MAX_EACH = 20; // the items a tool step runs for
const MAX_MATCHED = 20_000; // characters a match reads: a pattern from settings never stalls on a long answer

// {name} or {name.path}, the path with dots, [n] or [].
const REF = /\{([a-z][a-z0-9_]*)((?:\.[A-Za-z0-9_$-]+|\[\d*\]|\.\{[^{}]+\})*)\}/g;
const STEP_NAME = /^[a-z][a-z0-9_]*$/;
const NAME_FIRST = /^[a-z][a-z0-9_]*/; // the step a path starts with

const lookup = (vars: Record<string, unknown>, name: string, path: string): unknown => {
  const p = path.replace(/\[(\d+)\]/g, '.$1').replace(/^\./, '');
  return p ? extractPath(vars[name], p) : vars[name];
};
// The value at a box's or the badge's path: "triage.priority", "marks[0].title".
const valueAt = (vars: Record<string, unknown>, path: string) => {
  const name = NAME_FIRST.exec(path)?.[0] ?? '';
  return lookup(vars, name, path.slice(name.length));
};
const show = (v: unknown) => (v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v));

// A tool argument: one that is just {ref} keeps the value as it is; any other, a text, read as the
// parameter's type when it is a number or true/false. In a URL ("https://…?q={song.query}") each
// value is encoded, so that a "&" or "#" in it stays part of it.
function argValue(template: string, vars: Record<string, unknown>, type: string | undefined): unknown {
  const whole = new RegExp(`^${REF.source}$`).exec(template.trim());
  if (whole) return lookup(vars, whole[1]!, whole[2] ?? '');
  const url = /^https?:\/\//i.test(template.trim());
  const filled = template.replace(REF, (_, name: string, path: string) => {
    const value = show(lookup(vars, name, path));
    return url ? encodeURIComponent(value) : value;
  });
  if ((type === 'number' || type === 'integer') && filled.trim() !== '' && !Number.isNaN(Number(filled))) return Number(filled);
  if (type === 'boolean' && (filled === 'true' || filled === 'false')) return filled === 'true';
  return filled;
}

// What a match keeps: its named groups as an object, else its first group, else what matched.
const matchValue = (m: RegExpMatchArray): unknown => (m.groups && Object.keys(m.groups).length ? { ...m.groups } : m[1] ?? m[0]);

// A model step's prompt: each value in an untrusted block, a page's as page content, a tool's or a
// model's as a tool's answer.
function promptValue(step: ModelStep, steps: ActionStep[], vars: Record<string, unknown>): string {
  return step.prompt.trim().replace(REF, (whole, name: string, path: string) => {
    if (!Object.hasOwn(vars, name)) return whole;
    const value = neutralizeTags(show(lookup(vars, name, path)));
    const from = steps.find((s) => s.name === name);
    if (!from || stepKind(from) === 'read') return text('widget.page_value', { name: whole.slice(1, -1), value });
    return text('widget.tool_result', { tool: 'tool' in from ? from.tool : from.name, result: truncate(value, 'toolResult') });
  });
}

const fieldLine = (key: string, type: FieldType) =>
  `- "${key}": ${Array.isArray(type) ? `one of ${type.map((o) => JSON.stringify(o)).join(', ')}` : type === 'number' ? 'a number' : type === 'boolean' ? 'true or false' : 'a string'}`;

// What does not match the fields; none when it all does.
function fieldProblems(value: Record<string, unknown> | undefined, fields: Record<string, FieldType>): string[] {
  if (!value) return ['it is not a JSON object'];
  return Object.entries(fields).flatMap(([key, type]) => {
    const v = value[key];
    if (v === undefined || v === null) return [`"${key}" is missing`];
    if (Array.isArray(type)) return type.includes(String(v)) ? [] : [`"${key}" is ${JSON.stringify(v)}: expected one of ${type.map((o) => JSON.stringify(o)).join(', ')}`];
    if (type === 'number' && typeof v !== 'number') return [`"${key}" is ${JSON.stringify(v)}: expected a number`];
    if (type === 'boolean' && typeof v !== 'boolean') return [`"${key}" is ${JSON.stringify(v)}: expected true or false`];
    if (type === 'text' && typeof v !== 'string') return [`"${key}" is ${JSON.stringify(v)}: expected a string`];
    return [];
  });
}

// A JSON object, also inside a ```json fence or after some words.
export function parseJsonObject(s: string): Record<string, unknown> | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(s)?.[1] ?? s;
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start < 0 || end < start) return undefined;
  try {
    const v = JSON.parse(fenced.slice(start, end + 1)) as unknown;
    return isObject(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

// Why the steps cannot be saved.
export function stepProblems(steps: ActionStep[], reads: Record<string, string> = {}): string[] {
  const problems: string[] = [];
  const seen = new Set(['input', ...Object.keys(reads)]);
  const refsOf = (t: string) => [...t.matchAll(REF)].map((m) => m[1]!);
  const badMatch = (at: string, match: unknown) => {
    if (match === undefined) return;
    try {
      new RegExp(String(match), 'g');
    } catch (e) {
      problems.push(`${at}: its match is not a valid regular expression (${errorText(e)}).`);
    }
  };
  const unknownRefs = (where: string, t: string, also: string[] = []) => {
    const unknown = refsOf(t).filter((n) => !seen.has(n) && !also.includes(n));
    if (unknown.length) problems.push(`${where} uses ${unknown.map((n) => `{${n}}`).join(', ')}: no step before it has that name.`);
  };
  steps.forEach((s, i) => {
    const at = `Step ${i + 1}${s?.name ? ` (${s.name})` : ''}`;
    if (!isObject(s)) return problems.push(`${at} is not an object.`);
    if (typeof s.name !== 'string' || !STEP_NAME.test(s.name)) problems.push(`${at} needs a name: lowercase letters, digits and _.`);
    else if (s.name === 'item') problems.push(`${at}: "item" names the item of a step that runs for each.`);
    else if (seen.has(s.name)) problems.push(`${at}: the name "${s.name}" is taken.`);
    const kinds = ['read', 'tool', 'prompt'].filter((k) => k in s);
    if (kinds.length !== 1) problems.push(`${at} has one of "read", "tool" or "prompt".`);
    else if ('read' in s) {
      const v = parseVariable(String(s.read).trim());
      if (!v || v.kind === 'items') problems.push(`${at}: "read" is {{url}}, {{page}}, {{selector:css}}, {{selector:css?attr}}, {{meta:name}} or {{schema:@Type:path}}.`);
      badMatch(at, s.match);
    } else if ('tool' in s) {
      if (typeof s.tool !== 'string' || !s.tool) problems.push(`${at}: "tool" is a tool's name.`);
      badMatch(at, s.match);
      if (s.each !== undefined && (typeof s.each !== 'string' || !seen.has(NAME_FIRST.exec(s.each.trim())?.[0] ?? ''))) problems.push(`${at}: "each" is a path to a list a step before it gives.`);
      for (const [param, t] of Object.entries(s.args ?? {})) {
        if (typeof t !== 'string') problems.push(`${at}: the argument "${param}" is a text template.`);
        else unknownRefs(`${at}, argument "${param}",`, t, typeof s.each === 'string' ? ['item'] : []);
      }
    } else {
      if (typeof s.prompt !== 'string' || !s.prompt.trim()) problems.push(`${at}: "prompt" is the text for the model.`);
      else unknownRefs(at, s.prompt);
      if (s.tools !== undefined && (!Array.isArray(s.tools) || s.tools.some((t) => typeof t !== 'string'))) problems.push(`${at}: "tools" is a list of tools' names.`);
      for (const [key, type] of Object.entries(s.fields ?? {})) {
        const ok = Array.isArray(type) ? type.length > 0 && type.every((o) => typeof o === 'string') : ['text', 'number', 'boolean'].includes(type);
        if (!ok) problems.push(`${at}: the field "${key}" is "text", "number", "boolean" or a list of options.`);
      }
    }
    if (typeof s.name === 'string') seen.add(s.name);
  });
  return problems;
}

// Each step's names that the boxes and the badge use, checked once the steps are.
export function pathProblems(action: Pick<WidgetAction, 'steps' | 'outputs' | 'badge' | 'reads'>): string[] {
  const names = new Set(['input', ...Object.keys(action.reads ?? {}), ...(action.steps ?? []).map((s) => s.name)]);
  const first = (p: string) => NAME_FIRST.exec(p.trim())?.[0];
  const paths = [...action.outputs.map((o, i) => [`Box ${i + 1}`, o.from] as const), ['The badge', action.badge] as const];
  return paths.flatMap(([what, p]) => (p?.trim() && !names.has(first(p) ?? '') ? [`${what} takes "${p}": it starts with a step's name.`] : []));
}

// What the steps need to run: the action's tool runner (widget/run), and the model.
export interface StepRunner {
  runTool(name: string, argsOf: (tool: Tool) => Record<string, unknown>): Promise<{ answer: unknown; text?: string } | { error: string }>;
  ask?(system: string, messages: Message[], json: boolean, tools?: ToolSpec[]): Promise<{ answer: string; calls?: { id: string; name: string; args: unknown }[] } | { error: string }>;
  system: string;
  onStep?(trace: StepTrace): void;
}

export async function runSteps(action: WidgetAction, values: { input: string; reads?: Record<string, string> }, tools: Tool[], ctx: Pick<ToolContext, 'signal'>, runner: StepRunner): Promise<WidgetRunReply> {
  const steps = action.steps ?? [];
  const vars: Record<string, unknown> = { input: values.input, ...values.reads };
  for (const [i, step] of steps.entries()) {
    if (ctx.signal.aborted) return { error: STOPPED };
    const kind = stepKind(step);
    const at = Date.now();
    const trace = (t: Omit<StepTrace, 'i' | 'name' | 'kind'>) => runner.onStep?.({ i, name: step.name, kind, ...t, ...(t.status !== 'running' && { ms: Date.now() - at }) });
    const fail = (error: string, sent?: unknown) => {
      trace({ status: 'error', error, ...(sent !== undefined && { sent }) });
      return { error: `Step ${i + 1} (${step.name}): ${error}` };
    };
    let value: unknown;
    if ('read' in step) {
      const raw = values.reads?.[step.name] ?? '';
      trace({ status: 'running', sent: raw });
      if (!raw) return fail(`the page has nothing at ${step.read}.`, raw);
      if (step.match) {
        const m = new RegExp(step.match).exec(raw.slice(0, MAX_MATCHED));
        if (!m) return fail(`"${step.match}" does not match "${raw.slice(0, 200)}".`, raw);
        value = matchValue(m);
      } else value = raw;
      vars[step.name] = value;
      trace({ status: 'done', sent: raw, value });
    } else if ('tool' in step) {
      // Once, or once per item of its list, each item as {item}.
      const each = step.each?.trim();
      const list = each ? valueAt(vars, each) : undefined;
      if (each && !Array.isArray(list)) return fail(`"${each}" is not a list.`);
      const items = Array.isArray(list) ? list.slice(0, MAX_EACH) : [undefined];
      const pattern = step.match ? new RegExp(step.match, 'g') : undefined;
      const calls: StepCall[] = [];
      const found: unknown[] = [];
      let sentLast: unknown;
      trace({ status: 'running' });
      for (const item of items) {
        const scope = each ? { ...vars, item } : vars;
        let sent: Record<string, unknown> = {};
        const argsOf = (tool: Tool) => {
          const params = baseParams(tool);
          sent = Object.fromEntries(Object.entries(step.args ?? {}).filter(([, t]) => t.trim()).map(([n, t]) => [n, argValue(t, scope, params[n]?.type)]));
          return sent;
        };
        const ran = await runner.runTool(step.tool, argsOf);
        if ('error' in ran) return fail(ran.error, sent);
        let got = step.extract?.trim() ? extractPath(ran.answer, step.extract.trim()) : ran.answer;
        if (pattern) {
          const answer = show(got);
          got = [...answer.slice(0, MAX_MATCHED).matchAll(pattern)].map(matchValue);
          if (!(got as unknown[]).length && !each) return fail(`"${step.match}" does not match its answer: "${answer.slice(0, 200)}".`, sent);
        }
        found.push(got);
        sentLast = sent;
        if (each) {
          calls.push({ tool: step.tool, args: sent, value: got });
          trace({ status: 'running', calls: [...calls] });
        }
      }
      value = each ? found : found[0];
      vars[step.name] = value;
      const cut = Array.isArray(list) && list.length > items.length ? { of: list.length } : {};
      trace({ status: 'done', value, ...(each ? { calls, ...cut } : { sent: sentLast }) });
    } else {
      if (!runner.ask) return fail('no model to answer: choose one in the side panel, or for this action.');
      const asked = await askStep(step, promptValue(step, steps, vars), tools, { ...runner, ask: runner.ask }, trace);
      if ('error' in asked) return fail(asked.error, asked.user);
      vars[step.name] = asked.value;
      trace({ status: 'done', sent: asked.user, value: asked.value, ...(asked.calls.length && { calls: asked.calls }) });
    }
  }
  return stepOutputs(action, vars, steps.at(-1)?.name);
}

// A model step: its prompt, with its fields asked for; its tools called as the model asks, up to
// MAX_TOOL_ROUNDS times; its fields checked, asked again once.
async function askStep(step: ModelStep, prompt: string, tools: Tool[], runner: StepRunner & Pick<Required<StepRunner>, 'ask'>, trace: (t: Omit<StepTrace, 'i' | 'name' | 'kind'>) => void): Promise<{ value: unknown; user: string; calls: StepCall[] } | { error: string; user: string }> {
  const fields = step.fields && Object.keys(step.fields).length ? step.fields : undefined;
  const user = fields ? `${prompt}\n\n${text('widget.step_fields', { keys: Object.entries(fields).map(([k, t]) => fieldLine(k, t)).join('\n') })}` : prompt;
  const messages: Message[] = [{ role: 'user', parts: [{ type: 'text', text: user }] }];
  // Its tools, by their wire names; the JSON is then asked in words only (servers that take tools do
  // not all take response_format with them).
  const offered = (step.tools ?? []).map((n) => tools.find((t) => t.name === n)).filter((t): t is Tool => !!t);
  const specs: ToolSpec[] = offered.map((t) => ({ name: toWireName(t.name), description: t.description, inputSchema: t.inputSchema }));
  const calls: StepCall[] = [];
  trace({ status: 'running', sent: user });
  let rounds = 0;
  let retried = false;
  for (;;) {
    const asked = await runner.ask(runner.system, messages, !!fields && !specs.length, specs.length ? specs : undefined);
    if ('error' in asked) return { error: asked.error, user };
    if (asked.calls?.length) {
      if (++rounds > MAX_TOOL_ROUNDS) return { error: `it called tools ${MAX_TOOL_ROUNDS} times without answering.`, user };
      messages.push({ role: 'assistant', parts: [...(asked.answer.trim() ? [{ type: 'text' as const, text: asked.answer }] : []), ...asked.calls.map((c) => ({ type: 'tool_call' as const, ...c }))] });
      for (const c of asked.calls) {
        const tool = offered.find((t) => toWireName(t.name) === c.name);
        const call: StepCall = { tool: tool?.name ?? c.name, args: c.args };
        calls.push(call);
        trace({ status: 'running', sent: user, calls: [...calls] });
        const ran = tool ? await runner.runTool(tool.name, () => (isObject(c.args) ? c.args : {})) : { error: `"${c.name}" is not among this step's tools.` };
        if ('error' in ran) call.error = ran.error;
        else call.value = ran.answer;
        const result = 'error' in ran ? ran.error : ran.text ?? show(ran.answer);
        messages.push({ role: 'tool', parts: [{ type: 'tool_result', toolCallId: c.id, content: text('widget.tool_result', { tool: call.tool, result: truncate(neutralizeTags(result), 'toolResult') }), ...('error' in ran && { isError: true }) }] });
        trace({ status: 'running', sent: user, calls: [...calls] });
      }
      continue;
    }
    if (!fields) return { value: asked.answer.trim(), user, calls };
    const parsed = parseJsonObject(asked.answer);
    const problems = fieldProblems(parsed, fields);
    if (!problems.length) return { value: Object.fromEntries(Object.keys(fields).map((k) => [k, parsed![k]])), user, calls };
    if (retried) return { error: `the answer did not match its fields: ${problems.join('; ')}.`, user };
    retried = true;
    trace({ status: 'running', sent: user, value: asked.answer, error: problems.join('; '), attempt: 2, ...(calls.length && { calls: [...calls] }) });
    messages.push({ role: 'assistant', parts: [{ type: 'text', text: asked.answer }] }, { role: 'user', parts: [{ type: 'text', text: text('widget.step_fields_retry', { problems: problems.join('; ') }) }] });
  }
}

// A count written as a page writes it: "1.234", "1,234", "1 234", "12"; none for anything else.
export function countOf(s: string): number | undefined {
  const t = s.trim();
  if (/^\d+$/.test(t)) return Number(t);
  if (/^\d{1,3}([.,\s\u00a0\u202f]\d{3})+$/.test(t)) return Number(t.replace(/\D/g, ''));
  return undefined;
}

// A number short enough for a badge: 999, 1.2K, 12K, 3.4M.
export function short(n: number): string {
  const abs = Math.abs(n);
  const cut = (v: number, unit: string) => `${v < 10 ? Math.floor(v * 10) / 10 : Math.floor(v)}${unit}`;
  if (abs < 1000) return String(Math.round(n * 10) / 10);
  return abs < 1e6 ? cut(n / 1e3, 'K') : cut(n / 1e6, 'M');
}

// The boxes, from the steps' values (a box without a path: the last step's); a text as written. And
// the badge: a number as it is, true or false as ✓ or ✗, a text's first characters.
function stepOutputs(action: WidgetAction, vars: Record<string, unknown>, last: string | undefined): WidgetOutputs {
  const outputs: WidgetOutputs['outputs'] = action.outputs.map((o) => {
    const found = valueAt(vars, o.from?.trim() || last || 'input');
    if (typeof found === 'string' && !o.text?.trim() && !o.link?.trim()) return { label: o.label, lines: [], text: found };
    return { label: o.label, lines: outputLines(found, { ...o, from: undefined }) };
  });
  const badgePath = action.badge?.trim();
  if (!badgePath) return { outputs };
  const v = valueAt(vars, badgePath);
  const count = typeof v === 'number' ? v : Array.isArray(v) ? v.length : typeof v === 'string' ? countOf(v) : undefined;
  const badge = typeof v === 'boolean' ? (v ? '✓' : '✗') : count !== undefined ? short(count) : typeof v === 'string' ? [...v.trim()].slice(0, 4).join('') : '';
  return { outputs, ...(badge && { badge }) };
}
