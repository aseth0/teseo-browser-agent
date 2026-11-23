// What a run is set up from, shared by the chat's agent (background/agent-run) and the agents it asks
// (background/sub-agent): what the run loaded, an agent's setup and policy, its page's tools as the
// tab moves, and the agent loop's options.
import { browser } from 'wxt/browser';
import { askToolFor, MAX_DEPTH, withAsk } from '../agents/ask';
import { panelToolsFor, withPanel } from '../agents/panel';
import { DEFAULT_AGENT_NAME } from '../agents/builtins';
import { limit } from '../core/limits';
import { panelPageOf } from './panel-page';
import { SAY_TOOL } from '../speech/protocol';
import { speaksAloud } from '../speech/settings';
import { agentAllows, agentLabel, agentNow, agentOffers, callableAgents, seenBy, type AgentProfile } from '../agents/profiles';
import { BROWSER_AGENT } from '../agents/registry';
import { repeatableIn } from '../context/in-run';
import { requestView } from '../context/request-view';
import { buildSystemPrompt, excludedTools, memoryPromptOptions } from '../context/request';
import { heldSkills, onDemandGroups } from '../tools/load';
import { hasCreateGroup } from '../agents/builtins';
import { learnFromCall, tokenRatioOf } from '../context/token-ratio';
import { estimatedInput, estimateRequest, measureCall } from '../context/usage';
import { checkLearnedWindow, isContextOverflow, learnContextWindow, runWindow } from '../context/window';
import type { LoopContext, LoopEvent, LoopOptions, LoopTools } from '../core/agent-loop';
import type { PanelToBackground } from '../core/protocol';
import type { ToolRegistry } from '../core/tool-registry';
import type { AccessRequest, CallSeen, Message, ToolCallLog, ToolResult, WindowSource } from '../core/types';
import { logAction, logEntry, type ActionLogMode, type ActionSource } from '../logs/actions';
import { keepMemory, keptMemory } from '../memory/prompt';
import { memoryFor, type MemoryItem } from '../memory/store';
import { pageTools } from '../page/webmcp';
import { authorize, type Answer, type PolicyDeps } from '../policy/engine';
import { policyAccessFor } from '../policy/agent-access';
import { effectivePolicy, type PolicyStore } from '../policy/store';
import { createProvider } from '../providers/registry';
import { readMoreTool } from '../tools/read-more';
import type { Skill } from '../skills/types';
import type { ProviderConfig, Settings } from '../storage/settings';
import type { PageTemplate } from '../templates/types';
import type { BlacklistGate } from '../word-blacklist/gate';
import type { RunContext } from './agent-run';
import { seenTab, urlOfTab } from './tabs';
import { lackedBy } from '../tools/build-tools';
import type { PhaseRecorder } from '../core/phases';

export type RunMessage = Extract<PanelToBackground, { type: 'run' }>;
// The provider and model an agent runs on, the window its requests fit in (context/window runWindow), and
// how far the estimates are from what its server reports (context/token-ratio).
// `windowSource`: where the window comes from ('default': Settings → Compaction's guess for an unknown one).
type Target = { cfg: ProviderConfig; model: string; window?: number; windowSource?: WindowSource; ratio?: number };
// `fromPanel`: the window the panel counted on for the chat's model, and where it comes from.
export const targetFor = async (settings: Settings, cfg: ProviderConfig, model: string, fromPanel?: { tokens?: number; source?: WindowSource }): Promise<Target> => {
  const w = await runWindow(settings, cfg, model, fromPanel);
  return { cfg, model, window: w.tokens, windowSource: w.source, ratio: await tokenRatioOf(cfg.id, model) };
};

// A sub-agent's run, for agents.ask. callId: the agents.ask call, whose card shows the run;
// callerTarget: the caller's provider and model.
export type SubAgentRun = { asked: AgentProfile; caller: AgentProfile | undefined; task: string; callId: string | undefined; depth: number; callerTarget: Target };

// What one run loaded and how it reaches the panel and the user: the same for every agent it runs.
export interface RunScope extends Omit<RunContext, 'toolsFor' | 'startedAt'> {
  msg: RunMessage;
  settings: Settings;
  all: ToolRegistry; // the tools offered on the tab
  agents: AgentProfile[];
  allSkills: Skill[];
  allTemplates: PageTemplate[];
  allMemory: MemoryItem[];
  logMode: ActionLogMode;
  listedUrl: string | undefined; // the page whose tools were listed
  inConversation: PolicyStore | undefined; // what the user allowed for this conversation
  askAccess: (access: AccessRequest) => Promise<boolean>; // this run's: once it stops, answered no without asking
  runSubAgent: (run: SubAgentRun) => Promise<ToolResult>;
  blacklist: BlacklistGate; // every request of the run goes through it, the sub-agents' too
  // The turn's phases (core/phases): its own, and under each agents.ask call those of the agent asked.
  // Other parts of a run add theirs here (with a label, a detail and a duration).
  phases: PhaseRecorder;
}

// The tab an agent works on: the panel's, or a sub-agent's own (background/sub-agent), and the page
// whose tools (WebMCP) it was offered at the start.
type AgentPage = { tabId: number | undefined; listedUrl: string | undefined };
const panelPage = (run: RunScope): AgentPage => ({ tabId: run.msg.tabId, listedUrl: run.listedUrl });

// The page's own tools (WebMCP) follow the tab: listed again once it is on another page, so the
// model can call those of a page it went to in the same turn. Those not offered to the agent, or
// switched off, stay out as at the start.
const followPage = (run: RunScope, who: AgentProfile | undefined, excluded: string[], { tabId, listedUrl }: AgentPage): LoopTools['refresh'] => {
  if (tabId === undefined) return undefined;
  let listedFor = listedUrl;
  return async (tools) => {
    const tab = await browser.tabs.get(tabId).catch(() => undefined);
    if (tab?.url === listedFor) return undefined;
    const url = tab?.url;
    if (tab?.status === 'complete') listedFor = url; // still loading: listed again next time, its tools may come later
    const fresh = agentOffers(who, await pageTools(tabId, url), run.agents).filter((t) => !excluded.includes(t.name));
    return tools.without(tools.list().filter((t) => t.source === 'webmcp').map((t) => t.name)).with(fresh);
  };
};

// What the policy engine asks for an agent (none: Browser): its own policy on its sites (only those,
// when it says so), what the user allowed for this conversation before that.
function buildPolicyDeps(run: RunScope, who: AgentProfile | undefined): PolicyDeps {
  const { inConversation, questions, signal } = run;
  const sites = policyAccessFor(who, BROWSER_AGENT);
  return {
    getPolicy: async (host) => {
      const [conversation, site] = await Promise.all([inConversation?.load() ?? {}, sites.policies()]);
      return effectivePolicy(conversation, site, host);
    },
    setPolicy: (host, decided, scope) =>
      scope === 'conversation' ? (inConversation?.set(host, decided) ?? Promise.resolve()) : sites.save(host, decided),
    tabUrl: urlOfTab, // a closed tab: no URL, so asked
    tabOf: seenTab,
    confirm: (req) => questions.ask<Answer>((id) => ({ type: 'confirm', id, ...req, ...(who && { agent: agentLabel(who) }) }), { decision: 'deny' }, signal),
    // Its sites as saved now: "Always" on a card, or Settings, may have changed them during the run.
    ...(who && { agent: { name: who.name, allows: async (host: string) => agentAllows(await agentNow(who), host) } }),
  };
}

// What an agent's run is built from (none: Browser). An agent other than Browser sees only its
// tools, skills and site templates (its own choice, not Settings → Tools), its own policy on its
// sites (only those, when it says so), adds its instructions, and may ask the agents it was let
// ask, while not too deep. `history`: the chat's conversation, whose system prompt keeps the memory it
// started with (memory/prompt keptMemory): `kept` is that one, `built` a new one to keep.
export function prepareAgent(run: RunScope, who: AgentProfile | undefined, depth: number, target: Target, history?: Message[]) {
  const { settings, all, agents, msg } = run;
  const { settings: seen, skills, templates } = seenBy(who, settings, run.allSkills, run.allTemplates);
  const memory = memoryFor(run.allMemory, who?.id);
  const callable = depth < MAX_DEPTH ? callableAgents(who, agents, settings) : [];
  // The Agents Panel's tools: for the chat of a row the user started there (the first level, the agent
  // you talk to), not for the agents it asks.
  const panelRow = depth === 1 && callable.length ? msg.panelRow : undefined;
  const offered = new Set(withPanel(withAsk(agentOffers(who, all.list(), agents), callable), !!panelRow).map((t) => t.name));
  // speech.say: by the agent's own switch (Settings → Agents), off by default, whatever its tools say.
  if (speaksAloud(settings, who) && all.list().some((t) => t.name === SAY_TOOL)) offered.add(SAY_TOOL);
  else offered.delete(SAY_TOOL);
  const ask = askToolFor(callable, (sub, task, callId) => run.runSubAgent({ asked: sub, caller: who, task, callId, depth: depth + 1, callerTarget: target }));
  const panel = panelRow ? panelToolsFor(callable, who?.name ?? DEFAULT_AGENT_NAME, panelPageOf(panelRow), limit('panelAgents')) : [];
  // tools.read_more for every agent with tools: what a cut note offers is always there to read on.
  const registry = all.with([ask, ...panel, ...(offered.size ? [readMoreTool()] : [])]).without(all.list().map((t) => t.name).filter((n) => !offered.has(n)));
  const policy = buildPolicyDeps(run, who);
  // What the policy saw of each call goes with its answer, for the action log.
  const authorizing: LoopTools['authorize'] = async (tool, args, ctx) => {
    const noted: CallSeen = {};
    return { ...(await authorize(policy, tool, args, ctx, noted)), seen: noted };
  };
  const log = (source: ActionSource) => (call: ToolCallLog) =>
    void logAction(logEntry(call, { source, ...(who && { agent: agentLabel(who) }), ...(msg.conversationId && { conversationId: msg.conversationId }) }), run.logMode);
  const memoryOpts = memoryPromptOptions(seen, who);
  const key = JSON.stringify({ agent: who?.id ?? '', ...memoryOpts });
  const kept = history && memoryOpts ? keptMemory(history, key) : undefined;
  const built = history && memoryOpts && !kept ? keepMemory(memory, memoryOpts, key) : undefined;
  // Groups offered once the model loads them (tools/load): the tools that create things for Browser, the
  // servers' set so; the skills of those not loaded yet are not listed, tools.load names them.
  const groups = onDemandGroups(settings, registry.without(excludedTools(seen, skills)).list(), { create: hasCreateGroup(who), skills });
  const system = buildSystemPrompt({ settings: seen, skills, templates, agent: who, asksAgents: callable.length > 0, memory, memoryText: (kept ?? built)?.text, heldSkills: heldSkills(groups, history ?? []) });
  return { seen, skills, templates, memory, memoryOpts, kept, built, registry, authorizing, log, system, groups, callable };
}
type AgentSetup = ReturnType<typeof prepareAgent>;

// What a run's model gets of its conversation (LoopContext.view; context/request-view). `tools`: those
// offered, to know which results cannot be had again by calling the tool again.
export const runView = (settings: Settings, tools: ToolRegistry): LoopContext['view'] => {
  const repeatable = repeatableIn(tools);
  return (system, messages, seen) => requestView(settings, system, messages, { elements: seen.elements, squeeze: seen.squeeze, repeatable });
};

// What a run's events teach of its model: how far the estimates are from what its server reports
// (context/token-ratio), and its window, from a server that refused a request as too long and gave up
// (context/window; one refused and sent again is learned through onOverflow): only an error that is
// such a refusal (learnContextWindow checks it). A call that took more than the window learned for the
// model shows that one was stale: forgotten.
export const learnFrom = (target: Target) => (evt: LoopEvent) => {
  if (evt.type === 'usage') {
    void learnFromCall(target.cfg.id, target.model, evt.usage);
    if (evt.usage.reported) void checkLearnedWindow(target.cfg.id, target.model, evt.usage.reported.input);
  } else if (evt.type === 'error' && isContextOverflow(evt.error)) void learnContextWindow(target.cfg.id, target.model, evt.error);
};

// The agent loop's options any agent runs with: its model, prompt and tools (without `excluded`),
// its policy and log, the tab (`page`; none: the panel's) and the conversation.
export const loopOptions = (run: RunScope, who: AgentProfile | undefined, setup: AgentSetup, target: Target, excluded: string[], source: ActionSource, page = panelPage(run)): LoopOptions => ({
  model: { provider: run.blacklist.provider(createProvider(target.cfg), target.cfg.id), name: target.model, system: setup.system, contextWindow: target.window, windowSource: target.windowSource, tokenRatio: target.ratio, overflowed: isContextOverflow },
  context: {
    view: runView(run.settings, setup.registry),
    measure: measureCall,
    estimate: (r) => estimatedInput(estimateRequest(r.system, r.tools, r.messages)),
  },
  tools: {
    registry: setup.registry.without(excluded),
    context: { tabId: page.tabId, settings: run.settings, interact: run.interact, conversationId: run.msg.conversationId, skills: who?.skills, templates: who?.templates, agentId: who?.id },
    refresh: followPage(run, who, excluded, page),
    stepTools: run.all,
    authorize: setup.authorizing,
    requestAccess: run.askAccess,
    lacking: lackedBy,
  },
  hooks: {
    log: setup.log(source),
    tabOf: seenTab,
    onOverflow: (error) => void learnContextWindow(target.cfg.id, target.model, error),
  },
});
