// A sub-agent's run, for agents.ask: its own model (else its caller's), the task as its only
// message, no page block, a background tab of its own for the browser tools. The panel sees it as it
// goes; the caller gets only its final answer, and the whole run is kept with the call for the user (trace).
import { lastAnswer } from '../agents/ask';
import { agentLabel, agentOffers } from '../agents/profiles';
import { browserWith, DEFAULT_AGENT_ID, DEFAULT_AGENT_NAME, isEmptyAgent } from '../agents/builtins';
import { excludedTools } from '../context/request';
import { messageTimeItem } from '../context/date-time';
import { appendContext } from '../core/messages';
import { runAgentLoop } from '../core/agent-loop';
import { withOnDemand } from '../tools/load';
import { markValue, text } from '../core/model-texts';
import { callPhaseId } from '../core/phases';
import { fragmentShown } from '../core/repetition';
import type { Message, ToolResult } from '../core/types';
import { providerAccess } from '../page/access';
import { closeBackgroundTab, createBackgroundTab, LOAD_TIMEOUT_MS } from '../page/background-tab';
import { waitForLoad } from '../page/bridge';
import { reachOrAsk } from '../providers/provider-access';
import { learnFrom, loopOptions, prepareAgent, targetFor, type RunScope, type SubAgentRun } from './run-setup';
import { tabHolds } from '../watches/tab-holds';
import { urlOfTab } from './tabs';

// A sub-agent's own tab, in the background (page/background-tab): what it opens and does there
// leaves the user's tab alone. It starts on the user's page, loaded again (not a web page: blank).
async function openOwnTab(run: RunScope): Promise<number> {
  const at = await urlOfTab(run.msg.tabId);
  const url = at && /^https?:\/\//i.test(at) ? at : 'about:blank';
  const tabId = await createBackgroundTab(url, { web: run.settings.webSearch, agentTab: run.msg.tabId });
  tabHolds.openedForRun(tabId); // closed by a worker that starts again, should this one die meanwhile
  if (url !== 'about:blank') await waitForLoad(tabId, LOAD_TIMEOUT_MS);
  return tabId;
}

export async function runSubAgent(run: RunScope, { asked, caller, task, callId, depth, callerTarget }: SubAgentRun): Promise<ToolResult> {
  const { settings, all, agents, send, signal } = run;
  // Browser, asked: with the tools, skills and site templates switched on now.
  const sub = asked.id === DEFAULT_AGENT_ID ? browserWith(settings, agentOffers(undefined, all.list(), agents).map((t) => t.name), run.allSkills, run.allTemplates) : asked;
  const { model } = sub;
  const ownCfg = model ? settings.providers.find((p) => p.id === sub.providerId) : undefined;
  // Its own model's window; the caller's when it runs on the caller's model.
  const target = model && ownCfg ? await targetFor(settings, ownCfg, model) : callerTarget;
  if (!(await reachOrAsk(target.cfg, run.askAccess))) {
    return { type: 'text', text: `The agent "${sub.name}" could not run: no access to its provider's site, ${providerAccess(target.cfg).site}.`, isError: true };
  }
  const label = agentLabel(sub);
  // Its phases go under the call that asked it, which then says what it did.
  const parent = callId === undefined ? undefined : callPhaseId(callId);
  const phases = run.phases.under(parent);
  const setup = prepareAgent(run, sub, depth, target);
  // The task ends with when it was asked (Settings → About you → Date & time), as your messages do; not
  // for EmptyAgent, which gets the task alone.
  const given: Message = { role: 'user', parts: [{ type: 'text', text: text('agent.task', { caller: caller?.name ?? DEFAULT_AGENT_NAME, task }) }] };
  const stamp = isEmptyAgent(sub) ? undefined : messageTimeItem(Date.now(), setup.seen.dateTime);
  const task0 = stamp ? appendContext([given], [stamp])[0]! : given;
  const messages: Message[] = [];
  let stepped: number | false = false; // the steps it stopped at, out of them
  let failed: string | undefined;
  // With browser tools, its own tab, closed once it is done. The page's own tools (WebMCP) are then
  // those of its tab (from the first refresh), not the user's.
  const ownTab = setup.registry.list().some((t) => t.source === 'browser') ? await phases.time({ kind: 'setup', label: 'Opening its own tab' }, () => openOwnTab(run), () => '') : undefined;
  try {
    const base = loopOptions(run, sub, setup, target, excludedTools(setup.seen, setup.skills), 'sub-agent', ownTab === undefined ? undefined : { tabId: ownTab, listedUrl: undefined });
    const registry = ownTab === undefined ? base.tools.registry : base.tools.registry.without(base.tools.registry.list().filter((t) => t.source === 'webmcp').map((t) => t.name));
    const options = { ...base, tools: { ...base.tools, registry }, hooks: { ...base.hooks, phases } };
    // Groups offered once it loads them (prepareAgent): the tools that create things for Browser, as for
    // Default, and the servers' set so.
    const { groups } = setup;
    const learn = learnFrom(target);
    // Out of steps, the user may let it go on: its run so far ends with tool results, so running it
    // again continues it, with as many steps again. Asked no (or stopped): it answers as it is.
    for (let more = true; more; ) {
      const history = [task0, ...messages];
      stepped = false;
      for await (const evt of runAgentLoop(history, withOnDemand(options, history, [], groups), signal)) {
        if (callId) send({ type: 'sub', callId, agent: label, event: evt });
        learn(evt);
        if (evt.type === 'message') messages.push(evt.message);
        else if (evt.type === 'step-limit') stepped = evt.steps;
        else if (evt.type === 'error') failed = evt.error;
      }
      const steps = stepped;
      more = steps !== false && !failed && (await run.questions.ask<boolean>((id) => ({ type: 'more-steps', id, agent: label, steps }), false, signal)) === true;
    }
  } finally {
    if (ownTab !== undefined) {
      await closeBackgroundTab(ownTab);
      tabHolds.closedForRun(ownTab);
    }
  }
  const trace = { agent: label, messages: [task0, ...messages] };
  if (parent) run.phases.note(parent, `${label} · ${target.model} · ${messages.filter((m) => m.role === 'assistant').length} model calls · ${messages.flatMap((m) => m.parts).filter((p) => p.type === 'tool_call').length} tool calls${failed ? ' · failed' : ''}`);
  if (failed) return { type: 'text', text: `The agent "${sub.name}" failed: ${failed}`, isError: true, trace };
  const cut = messages.findLast((m) => m.cut)?.cut; // as it kept repeating this (core/repetition)
  const answer = [
    lastAnswer(messages) || text('result.agent_no_answer'),
    ...(stepped !== false ? [text('result.agent_step_limit')] : []),
    ...(cut ? [text('result.agent_cut', { fragment: fragmentShown(cut) })] : []),
  ].join('\n');
  return { type: 'text', text: `${text('result.agent_answer', { agent: sub.name, answer: markValue(answer, 'tool') })}\n${toolsNote(messages)}`, trace };
}

// How many tool calls it made, and how many failed: counted here, so the caller can tell an answer
// that says it checked from one that did.
export function toolsNote(messages: Message[]): string {
  const parts = messages.flatMap((m) => m.parts);
  const calls = parts.filter((p) => p.type === 'tool_call').length;
  const failed = String(parts.filter((p) => p.type === 'tool_result' && p.isError).length);
  return calls === 0 ? text('result.agent_no_tools') : calls === 1 ? text('result.agent_tools_one', { failed }) : text('result.agent_tools', { calls: String(calls), failed });
}
