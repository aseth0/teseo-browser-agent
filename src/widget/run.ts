// Runs a page widget action: its tool, called directly with the action's arguments, and the answer
// cut into the action's boxes; with a prompt, one request to the model (no tools for it), the tool's
// answer going with the prompt as untrusted. A tool that writes is confirmed in the card first (the
// site policies say when): a page must never set off a write on its own (its script cannot click the
// widget, but it decides what the user sees and selects).
import { neutralizeTags, stripMarks, text, truncate } from '../core/model-texts';
import { AccessRequiredError, type ToolSpec, type CallSeen, type LLMProvider, type Message, type Part, type ThinkingLevel, type Tool, type ToolContext, type ToolResult } from '../core/types';
import type { ToolCallLog } from '../core/types';
import { baseParams, buildValue } from '../tools/custom/runtime';
import { answersInJson, askedPrompt, filledPrompt, onLoad, type WidgetAction } from './actions';
import { outputLines } from './output-lines';
import { STOPPED, type ActionConfirm, type CardDecision, type WidgetOutputs, type WidgetRunReply } from './protocol';
import { agentAllows, agentOffers, type AgentProfile } from '../agents/profiles';
import { hasSteps, parseJsonObject, runSteps, type StepTrace } from './steps';
import { authorize } from '../policy/engine';
import type { SitePolicy } from '../policy/store';
import { errorText } from '../core/errors';

// What an action with steps says as it runs: each step (Try), and its conversation (the chat's buttons).
export interface StepHooks {
  onStep?(trace: StepTrace): void;
  onExchange?(messages: Message[]): void;
}

// What a call may do, as in the chat: the agent the action runs as (none: Default), held to its
// sites; the site policies that apply (the agent's, or the widget's column in Website access) and
// "Always on this site"; and the card that asks the user. Without a way to ask, a write is refused.
export interface ActionAccess {
  agent?: AgentProfile;
  tabUrl(tabId: number | undefined): Promise<string | undefined>;
  getPolicy?(host: string): Promise<SitePolicy>; // none: ask
  setPolicy?(host: string, policy: SitePolicy): Promise<void>;
  confirm?(request: ActionConfirm, signal: AbortSignal): Promise<CardDecision>; // 'deny' once the signal aborts
  log?(call: ToolCallLog): void; // the action's tool call, as it ends (the action log)
}

// Why this call may not run; none: it may (asked in the card when it writes and the site says so),
// on the site it was allowed on (ToolContext.approvedHost).
async function accessRefusal(access: ActionAccess | undefined, tool: Tool, args: unknown, ctx: ToolContext, seen: CallSeen): Promise<{ refusal?: string; approvedHost?: string }> {
  const writes = tool.effect === 'write';
  if (!writes && !access?.agent) return {};
  if (!access || (writes && !access.confirm)) return { refusal: `"${tool.name}" changes things, and there is no card to ask you in here.` };
  const { agent, confirm } = access;
  let denied = false;
  const { refused, approvedHost } = await authorize({
    getPolicy: async (host) => (await access.getPolicy?.(host)) ?? 'ask',
    setPolicy: async (host, policy) => access.setPolicy?.(host, policy),
    tabUrl: access.tabUrl,
    confirm: async (req) => {
      const decision = confirm ? await confirm(req, ctx.signal) : 'deny';
      denied = decision === 'deny';
      return { decision };
    },
    ...(agent && { agent: { name: agent.name, allows: (host: string) => agentAllows(agent, host) } }),
  }, tool, args, ctx, seen);
  if (denied) return { refusal: 'Not done: you denied it.' };
  return refused ? { refusal: stripMarks(refused) } : { approvedHost };
}

// Why a tool cannot run from the widget; none: it can. Those that ask the user something, and those
// always confirmed (saving a skill, an agent…) are the chat's.
export function widgetRefusal(tool: Tool | undefined, name: string): string | undefined {
  if (!tool) return `The tool "${name}" is not available: it is switched off, or its MCP server is not connected.`;
  if (tool.effect === 'interact' || tool.alwaysAsk) return `"${name}" is for the chat: the page widget runs tools that read or act on a site.`;
  return undefined;
}

// What an action is given: the text it takes, and the values it read from the page (on load).
interface ActionValues {
  input: string;
  reads?: Record<string, string>;
}
const valuesOf = (given: string | ActionValues): ActionValues => (typeof given === 'string' ? { input: given } : given);

// The tool's arguments: each template with the input and the page's values in it, typed as the
// tool's parameter.
export function actionArgs(action: WidgetAction, given: string | ActionValues, tool: Pick<Tool, 'inputSchema'>): Record<string, unknown> {
  const { input, reads } = valuesOf(given);
  const types = baseParams(tool);
  return Object.fromEntries(
    Object.entries(action.args)
      .filter(([, template]) => template.trim())
      .map(([name, template]) => [name, buildValue(template, { ...reads, input }, types[name]?.type)]),
  );
}

// The answer as a value: the data the tool keeps apart, its JSON, or its text.
function answerOf(result: Extract<ToolResult, { type: 'text' | 'json' }>): unknown {
  if (result.type === 'json') return result.value;
  if (result.data !== undefined) return result.data;
  const text = stripMarks(result.text);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// The model an action's prompt goes to, and where its answer goes as it comes.
export interface ActionModel {
  provider: LLMProvider;
  model: string;
  thinking?: ThinkingLevel; // none: the server's default
  onDelta(kind: 'text' | 'reasoning', text: string): void;
  // The request and its answer as a conversation, to go on with it in the chat ("Open in the chat").
  onExchange?(messages: Message[]): void;
}

export async function runWidgetAction(action: WidgetAction, input: string | ActionValues, tools: Tool[], ctx: ToolContext, access?: ActionAccess, model?: ActionModel, hooks?: StepHooks): Promise<WidgetRunReply> {
  try {
    return (await tryWidgetAction(action, input, tools, ctx, access, model, hooks)).reply;
  } catch (e) {
    if (e instanceof AccessRequiredError) return { error: `No access to ${e.access.site}: allow it in Settings → Website access, then try again.` };
    throw e;
  }
}

// The reply, and the tool's answer it was cut from (for actions.save, to show the model when no box
// finds anything). A site the tool may not reach yet is thrown (AccessRequiredError): from the chat,
// the user is asked for it. An agent's action uses only its tools, on its sites.
export async function tryWidgetAction(action: WidgetAction, given: string | ActionValues, tools: Tool[], ctx: ToolContext, access?: ActionAccess, model?: ActionModel, hooks?: StepHooks): Promise<{ reply: WidgetRunReply; answer?: unknown }> {
  const values = valuesOf(given);
  if (hasSteps(action)) return { reply: await runActionSteps(action, values, tools, ctx, access, model, hooks) };
  const prompt = action.prompt?.trim();
  let found: string | undefined; // the tool's answer, for the prompt
  if (action.tool) {
    const ran = await runTool(action, values, tools, ctx, access);
    if ('error' in ran) return { reply: ran };
    if (!prompt) return { reply: { outputs: action.outputs.map((o) => ({ label: o.label, lines: outputLines(ran.answer, o) })) }, answer: ran.answer };
    found = ran.text;
  }
  if (!prompt) return { reply: { error: 'The action has no tool and no prompt.' } };
  if (!model) return { reply: { error: 'No model to answer: choose one in the side panel, or for this action in Settings → Actions.' } };
  return { reply: await askModel(action, values, found, access?.agent, model, ctx.signal) };
}

// The action's tool, run: its answer as a value (for the boxes) and as text (for the prompt).
const runTool = (action: WidgetAction, values: ActionValues, tools: Tool[], ctx: ToolContext, access?: ActionAccess) =>
  callTool(action.tool, (tool) => actionArgs(action, values, tool), onLoad(action), tools, ctx, access);

// A tool of the action's (its own, or a step's), with the arguments made for it.
async function callTool(name: string, argsOf: (tool: Tool) => Record<string, unknown>, loads: boolean, tools: Tool[], ctx: ToolContext, access?: ActionAccess): Promise<{ answer: unknown; text: string } | { error: string }> {
  const tool = tools.find((t) => t.name === name);
  const refused = widgetRefusal(tool, name);
  if (refused || !tool) return { error: refused! };
  if (access?.agent && !agentOffers(access.agent, [tool], []).length) return { error: `"${tool.name}" is not among the tools of the agent "${access.agent.name}".` };
  // On load nothing is asked: only a tool that reads (the page decides when it runs).
  if (loads && tool.effect !== 'read') return { error: `"${tool.name}" changes things: an action on page load only reads.` };
  const args = argsOf(tool);
  const target = tool.tabOf?.(args);
  if (target !== undefined && target !== ctx.tabId) return { error: 'The action reads another tab: the page widget only reads its own.' };
  const at = Date.now();
  const seen: CallSeen = {};
  const done = <T extends { error: string } | { answer: unknown; text: string }>(ran: T, refused?: string): T => {
    access?.log?.({ tool: tool.name, at, ms: Date.now() - at, seen, ...(refused ? { refused } : 'error' in ran ? { error: ran.error } : { size: ran.text.length }) });
    return ran;
  };
  const { refusal, approvedHost } = await accessRefusal(access, tool, args, ctx, seen);
  // Stopped while it was being asked (the card closed, or the time was up): never run.
  if (ctx.signal.aborted) return done({ error: STOPPED }, STOPPED);
  if (refusal) return done({ error: refusal }, refusal);
  let result: ToolResult;
  try {
    result = await tool.run(args, approvedHost ? { ...ctx, approvedHost } : ctx);
  } catch (e) {
    if (e instanceof AccessRequiredError) throw e;
    return done({ error: errorText(e) });
  }
  if (result.type === 'image') return done({ error: `"${tool.name}" answers with an image, which the page widget does not show yet.` });
  if (result.type === 'text' && result.isError) return done({ error: stripMarks(result.text) });
  return done({ answer: answerOf(result), text: result.type === 'json' ? JSON.stringify(result.value) : stripMarks(result.text) });
}

// The system prompt of an action's requests: the widget's and its agent's.
const systemOf = (agent: AgentProfile | undefined) =>
  [text('system.widget'), agent ? text('system.agent', { name: agent.name, instructions: agent.instructions.trim() }).trim() : ''].filter(Boolean).join('\n\n');

// The prompt to the model: the action's (what it takes and reads in it), the tool's answer as untrusted, and
// with several boxes, the JSON asked for; the system prompt, the widget's and its agent's.
export function promptOf(action: WidgetAction, given: string | ActionValues, found: string | undefined, agent: AgentProfile | undefined): { system: string; user: string; prompt: string; shown: string; toolBlock?: string } {
  const system = systemOf(agent);
  const keys = action.outputs.map((o) => `- "${o.from?.trim()}": ${o.label.trim()}`).join('\n');
  const values = valuesOf(given);
  const prompt = askedPrompt(action, values);
  const toolBlock = found !== undefined ? text('widget.tool_result', { tool: action.tool, result: truncate(found, 'toolResult') }) : undefined;
  const user = [prompt, toolBlock, answersInJson(action) ? text('widget.json_outputs', { keys }) : ''];
  // As the chat shows it (Part shown): the values without their blocks.
  return { system, user: user.filter(Boolean).join('\n\n'), prompt, shown: filledPrompt(action, values), ...(toolBlock && { toolBlock }) };
}

// The request and its answer as the chat keeps a conversation: the prompt as the user's message,
// the tool's answer attached to it (shown as context), and the answer (the boxes, when they came in
// JSON) with its reasoning.
function exchangeOf(action: WidgetAction, asked: ReturnType<typeof promptOf>, reasoning: string, reply: WidgetOutputs, agent: AgentProfile | undefined): Message[] {
  const user: Part[] = [{ type: 'text', text: asked.prompt, shown: asked.shown }, ...(asked.toolBlock ? [{ type: 'text' as const, text: asked.toolBlock, context: 'tool' as const, source: `page widget: ${action.tool}` }] : [])];
  const said = saidOf(reply);
  return [
    { role: 'user', parts: user, ...(agent && { agent: agent.id }) },
    { role: 'assistant', parts: [...(reasoning.trim() ? [{ type: 'reasoning' as const, text: reasoning }] : []), { type: 'text', text: said }] },
  ];
}

// The boxes as the model's answer in the chat.
const saidOf = (reply: WidgetOutputs) =>
  reply.outputs.length === 1 && reply.outputs[0]!.text !== undefined ? reply.outputs[0]!.text : reply.outputs.map((o) => `**${o.label}**\n${o.text ?? o.lines.map((l) => `- ${l.text}`).join('\n')}`).join('\n\n');

const NO_ANSWER = 'The model gave no answer.';
type ModelCall = { id: string; name: string; args: unknown };

// One request to the action's model, what it writes streamed to the card as it comes: its answer, its
// reasoning and the tools it calls.
async function streamAnswer(model: ActionModel, request: { system: string; messages: Message[]; json: boolean; tools?: ToolSpec[] }, signal: AbortSignal): Promise<{ answer: string; reasoning: string; calls: ModelCall[] } | { error: string }> {
  let answer = '';
  let reasoning = '';
  const calls: ModelCall[] = [];
  try {
    for await (const evt of model.provider.chat({ model: model.model, ...request, thinking: model.thinking }, signal)) {
      if (evt.type === 'tool-call') calls.push({ id: evt.id, name: evt.name, args: evt.args });
      if (evt.type === 'text-delta') answer += evt.text;
      if (evt.type === 'reasoning-delta') reasoning += evt.text;
      if (evt.type === 'text-delta' || evt.type === 'reasoning-delta') model.onDelta(evt.type === 'text-delta' ? 'text' : 'reasoning', evt.text);
    }
  } catch (e) {
    return { error: signal.aborted ? STOPPED : errorText(e) };
  }
  return { answer, reasoning, calls };
}

// One request, streamed to the card; its answer cut into the boxes.
async function askModel(action: WidgetAction, values: ActionValues, found: string | undefined, agent: AgentProfile | undefined, model: ActionModel, signal: AbortSignal): Promise<WidgetRunReply> {
  const asked = promptOf(action, values, found, agent);
  const json = answersInJson(action);
  const streamed = await streamAnswer(model, { system: asked.system, messages: [{ role: 'user', parts: [{ type: 'text', text: asked.user }] }], json }, signal);
  if ('error' in streamed) return streamed;
  const { answer, reasoning } = streamed;
  if (!answer.trim()) return { error: NO_ANSWER };
  const reply = json ? boxesOf(action, answer) : { outputs: [{ label: action.outputs[0]!.label, lines: [], text: answer.trim() }] };
  if ('outputs' in reply) model.onExchange?.(exchangeOf(action, asked, reasoning, reply, agent));
  return reply;
}

// The boxes from the model's JSON: a text as it is; anything else, as the tool's answer would be.
export function boxesOf(action: WidgetAction, answer: string): WidgetRunReply {
  const value = parseJsonObject(answer);
  if (!value) return { error: `The model did not answer with the JSON asked for: ${answer.trim().slice(0, 200)}` };
  const outputs: WidgetOutputs['outputs'] = action.outputs.map((o) => {
    const v = value[o.from!.trim()];
    return typeof v === 'string' ? { label: o.label, lines: [], text: v.trim() } : { label: o.label, lines: outputLines(v, { ...o, from: undefined }) };
  });
  return { outputs };
}

// An action with steps (widget/steps): its tools run as its own tool would, its model steps asked one
// request each, streamed to the card.
async function runActionSteps(action: WidgetAction, values: ActionValues, tools: Tool[], ctx: ToolContext, access?: ActionAccess, model?: ActionModel, hooks?: StepHooks): Promise<WidgetRunReply> {
  const system = systemOf(access?.agent);
  // What it did, for the chat: the last model step's prompt, and every step's value.
  let prompt: string | undefined;
  const found: Record<string, unknown> = {};
  const onStep = (trace: StepTrace) => {
    hooks?.onStep?.(trace);
    if (trace.status !== 'done') return;
    found[trace.name] = trace.value;
    if (trace.kind === 'model' && typeof trace.sent === 'string') prompt = trace.sent;
  };
  const reply = await runSteps(action, values, tools, ctx, {
    system,
    onStep,
    runTool: (name, argsOf) => callTool(name, argsOf, onLoad(action), tools, ctx, access),
    ...(model && {
      ask: async (sys: string, messages: Message[], json: boolean, offered?: ToolSpec[]) => {
        const streamed = await streamAnswer(model, { system: sys, messages, json, ...(offered && { tools: offered }) }, ctx.signal);
        if ('error' in streamed) return streamed;
        const { answer, calls } = streamed;
        if (calls.length) return { answer, calls };
        return answer.trim() ? { answer } : { error: NO_ANSWER };
      },
    }),
  });
  if (action.chatButtons && 'outputs' in reply) hooks?.onExchange?.(stepsExchange(action, prompt, found, reply, access?.agent));
  return reply;
}

// The steps and their answer as the chat keeps a conversation: the last model step's prompt (none:
// the action's name) as the user's message, the steps' values attached to it, and the boxes.
function stepsExchange(action: WidgetAction, prompt: string | undefined, found: Record<string, unknown>, reply: WidgetOutputs, agent: AgentProfile | undefined): Message[] {
  const block = text('widget.tool_result', { tool: action.name, result: truncate(neutralizeTags(JSON.stringify(found, null, 1)), 'toolResult') });
  const user: Part[] = [{ type: 'text', text: prompt ?? action.name, shown: action.name }, { type: 'text', text: block, context: 'tool', source: `page widget: ${action.name}` }];
  return [
    { role: 'user', parts: user, ...(agent && { agent: agent.id }) },
    { role: 'assistant', parts: [{ type: 'text', text: saidOf(reply) }] },
  ];
}

