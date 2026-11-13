// The "script" base of custom tools: JavaScript for an API that takes several requests (a list, then
// a request for each item, merged), the body of an async function given `input` (the tool's own
// parameters) and `request(method, path, body)` to the tool's site. It runs in the script engine
// (script/quickjs), where it reaches nothing else; its requests go with the tool's headers and
// session (in `http`, as an HTTP request's: its url is the site). What it returns goes to the model as
// untrusted. It changes things unless the user ticked that it only reads, as an HTTP request.
import { neutralizeSecrets } from '../secrets';
import { limit, wrappedResultMax } from '../../core/limits';
import { cutAndKeep } from '../../core/kept-results';
import { markValue, stripMarks, text } from '../../core/model-texts';
import { toWireName } from '../../core/tool-registry';
import type { Message, Tool, ToolContext } from '../../core/types';
import type { CustomTool } from './types';
import { inputValues } from './values';
import { argumentDetails } from '../../core/argument-details';
import type { ScriptAccess } from '../../script/request';
import type { ScriptRun, ScriptSteps } from '../../script/quickjs';

export const SCRIPT_BASE = 'script';

// Where a script runs: the background (script/away), or the page that tries it (Try).
export type ScriptRunner = (access: ScriptAccess, code: string, input: Record<string, unknown>, signal: AbortSignal, steps?: ScriptSteps) => Promise<ScriptRun>;

// What a script returned, as text.
const answerOf = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value, null, 1));

// What the model gets, the script's answer worded as such; cut, its whole kept for tools.read_more (in
// `conversationId`'s). One that returned nothing says so: the model forgot its return.
export function scriptResult(tool: string, run: ScriptRun, conversationId?: string): string {
  const result = run.value === null
    ? text('result.script_nothing')
    : markValue(cutAndKeep(answerOf(run.value), 'toolResult', { conversationId, source: tool, max: wrappedResultMax() }), 'tool');
  return text('result.script', { tool, count: String(run.requests), result });
}

// What the script gets as `input`: every parameter of the tool, null when not given (so that its name,
// a variable of its own too, is always there; undefined would not cross to the script engine).
export function scriptInput(custom: CustomTool, args: unknown): Record<string, unknown> {
  const given = inputValues(custom.inputs ?? [], args);
  return Object.fromEntries((custom.inputs ?? []).map((i) => [i.name, given[i.name] ?? null]));
}

export function scriptTool(custom: CustomTool, inputSchema: Tool['inputSchema'], runner: ScriptRunner): Tool {
  const access = custom.http!;
  const site = access.url ? new URL(access.url).host : '';
  const calls = !!custom.uses?.length; // a script that calls tools (its steps, tools/custom/script-tool's tool())
  return {
    name: custom.name,
    description: custom.description,
    inputSchema,
    source: 'custom',
    // Its steps are each asked as usual; its own requests, as a request to its site.
    effect: access.readOnly || !site ? 'read' : 'write',
    ...(!site && { siteless: true }),
    // The site policy is the site's, as for a request to it.
    describe: async (args) => ({
      summary: site ? `Run the script of ${custom.name} on ${site}` : `Run the script of ${custom.name}`,
      ...(site && { url: access.url }),
      details: [
        ...argumentDetails(args),
        ...(calls ? [{ label: 'Tools it calls', value: custom.uses!.join(', ') }] : []),
        ...(access.session ? [{ label: 'Signed in as you', value: `Sends your browser session for ${site}` }] : []),
      ],
    }),
    run: async (args, ctx: ToolContext) => {
      const steps = calls ? scriptSteps(custom, ctx) : undefined;
      const input = neutralizeSecrets(scriptInput(custom, args)); // the model's values cannot name a saved value
      const run = await (steps ? runner(access, custom.script ?? '', input, ctx.signal, steps.handlers) : runner(access, custom.script ?? '', input, ctx.signal));
      const data = run.value !== null ? { data: run.value } : {};
      if (!steps) return { type: 'text', text: scriptResult(custom.name, run, ctx.conversationId), ...data };
      return { type: 'text', text: stepsResult(custom.name, run, steps, ctx.conversationId), ...data, trace: { agent: custom.name, messages: steps.messages, steps: true } };
    },
  };
}

// The steps of a script that calls tools: each tool() runs as a call of the model's would (the policy,
// the user's confirmation), only for the tools in its uses, shown to the user as it goes; those with
// report, and its notes, go to the model with its answer.
function scriptSteps(custom: CustomTool, ctx: ToolContext) {
  // By their wire names: the script may write either ("browser.find" or "browser__find").
  const uses = new Set(custom.uses?.map(toWireName));
  const messages: Message[] = [];
  const reported: string[] = [];
  let taken = 0;
  const show = (message: Message) => {
    messages.push(message);
    ctx.emit?.(custom.name, message);
  };
  const handlers: ScriptSteps = {
    maxSteps: limit('scriptSteps'),
    timeMs: limit('scriptStepsTime') * 1000,
    tool: async (name, args, report) => {
      if (!uses.has(toWireName(name))) throw new Error(`"${name}" is not among the tools this script calls (its uses: ${custom.uses!.join(', ')}).`);
      if (!ctx.callTool) throw new Error('This script calls tools: it runs only from a chat, not from another tool.');
      const n = ++taken;
      const id = `step-${n}`;
      show({ role: 'assistant', parts: [{ type: 'tool_call', id, name, args }] });
      const answer = await ctx.callTool(name, args);
      show({ role: 'tool', parts: [{ type: 'tool_result', toolCallId: id, content: answer.content, ...(answer.isError && { isError: true }) }] });
      if (report) reported.push(text('result.script_step', { n: String(n), tool: name, result: answer.content }));
      return { ok: !answer.isError, text: stripMarks(answer.content), ...(answer.data !== undefined && { data: answer.data }) };
    },
    note: (line) => {
      reported.push(text('result.script_note', { text: markValue(line, 'tool') }));
      show({ role: 'assistant', parts: [{ type: 'text', text: line }] });
    },
  };
  return { handlers, messages, reported, taken: () => taken };
}

// What the model gets from a script that calls tools: the steps it reported, then its answer (one that
// returned nothing and reported nothing says so).
function stepsResult(tool: string, run: ScriptRun, steps: ReturnType<typeof scriptSteps>, conversationId?: string): string {
  const cut = (s: string) => cutAndKeep(s, 'toolResult', { conversationId, source: tool, max: Math.floor(wrappedResultMax() / 2) });
  return text('result.script_steps', {
    tool,
    count: String(steps.taken()),
    steps: cut(steps.reported.join('\n\n')),
    result: run.value === null && !steps.reported.length ? text('result.script_nothing') : markValue(cut(answerOf(run.value)), 'tool'),
  });
}
