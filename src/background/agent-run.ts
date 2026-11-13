// A chat's run: the provider checked, the agent's setup (its tools, skills, templates, sites and the
// agents it may ask: background/run-setup), the page and the rest of the turn's context added to
// your message, then the agent loop, its events sent to the panel as they come. Sub-agents
// (agents.ask) run in background/sub-agent.
import { agentAllows, agentById, agentStore } from '../agents/profiles';
import { isEmptyAgent } from '../agents/builtins';
import { forcedToolChoice } from '../context/inline-mentions';
import { excludedTools } from '../context/request';
import { stepPlanReminder } from '../context/plan-reminder';
import { withPlansDismissed } from '../tools/user/shapes';
import { stepAttachItems } from '../context/step-attach';
import { turnContext } from '../context/turn';
import { runAgentLoop } from '../core/agent-loop';
import { keep } from '../core/kept-results';
import { withOnDemand } from '../tools/load';
import { appendContext, keepSystemMemory } from '../core/messages';
import { memoryChanges } from '../memory/prompt';
import { seenWhole } from '../context/compaction';
import { text } from '../core/model-texts';
import type { BackgroundToPanel } from '../core/protocol';
import type { createQuestions } from '../core/questions';
import type { AccessRequest, UserReply, UserRequest } from '../core/types';
import { hostOf } from '../core/util';
import { DEFAULT_LOG_MODE } from '../logs/actions';
import { loadMemory } from '../memory/store';
import { providerAccess } from '../page/access';
import { conversationPolicies } from '../policy/store';
import { skillStore } from '../skills/store';
import { templateStore } from '../templates/store';
import { blacklistGate, wentMasked } from '../word-blacklist/gate';
import { loadBlacklist } from '../word-blacklist/store';
import { reachOrAsk } from '../providers/provider-access';
import { learnFrom, loopOptions, prepareAgent, targetFor, type RunMessage, type RunScope } from './run-setup';
import { settingsNow } from './settings';
import { runSubAgent } from './sub-agent';
import { tabUrl } from './tabs';
import type { ToolsFor } from './tool-catalog';

// What a run is given by its chat's session.
export interface RunContext {
  toolsFor: ToolsFor;
  signal: AbortSignal; // stopped, or replaced by a new run
  send: (m: BackgroundToPanel) => void; // to the panel, until the run stops
  questions: ReturnType<typeof createQuestions<BackgroundToPanel>>;
  interact: (request: UserRequest, signal?: AbortSignal) => Promise<UserReply>;
  startedAt: number; // the response time counts reading the page too
  dismissedPlans: ReadonlySet<string>; // the plans the user took away while it goes (its calls' ids)
}

export async function runAgent(msg: RunMessage, { toolsFor, signal, send, questions, interact, startedAt, dismissedPlans }: RunContext) {
  // The files (and a tab's audio transcribed) attached to your message that were cut, whole, for tools.read_more.
  for (const k of msg.kept ?? []) {
    const breaks = Array.isArray(k.breaks) ? k.breaks.map(Number).filter(Number.isFinite) : undefined;
    keep(msg.conversationId, { id: String(k.id), text: String(k.text), source: String(k.source), limit: k.limit === 'tabAudio' ? 'tabAudio' : 'attachedFile', next: Number(k.next) || 0, ...(breaks && { breaks }) });
  }
  // This run's questions: once it stops, answered no without asking.
  const askAccess = (access: AccessRequest) => questions.ask((id) => ({ type: 'access', id, ...access }), false, signal);
  const settings = await settingsNow();
  const cfg = settings.providers.find((p) => p.id === msg.providerId);
  if (!cfg) return send({ type: 'error', error: 'Provider not configured' });
  // The provider's site is granted at runtime (Test connection in Settings, or here, once).
  if (!(await reachOrAsk(cfg, askAccess))) {
    return send({ type: 'error', error: `No access to ${providerAccess(cfg).site}: allow it to use the provider "${cfg.name}", or test it in Settings → Providers.` });
  }

  const [allSkills, allTemplates, agents, allMemory] = await Promise.all([skillStore.load(), templateStore.load(), agentStore.load(), loadMemory()]);
  const agent = agentById(agents, msg.agentId);
  let history = msg.history;
  const { tabId } = msg;
  const listedUrl = tabId === undefined ? undefined : await tabUrl(tabId); // the page whose tools come next
  const { registry: all, mcpErrors } = await toolsFor(tabId, settings, { url: listedUrl, signal });
  for (const e of mcpErrors) send({ type: 'notice', text: e.signIn ? `${e.error} Its tools are not offered until then.` : `MCP server "${e.server}" could not be reached, its tools are not offered: ${e.error}` });
  const run: RunScope = {
    msg, settings, all, agents, allSkills, allTemplates, allMemory, listedUrl, askAccess, signal, send, questions, interact, dismissedPlans,
    logMode: settings.logs?.actions ?? DEFAULT_LOG_MODE,
    // What the user allowed for this conversation comes before the site policies.
    inConversation: msg.conversationId === undefined ? undefined : conversationPolicies(msg.conversationId),
    runSubAgent: (sub) => runSubAgent(run, sub),
    // The page it is on as each request goes (it may have moved to another one).
    // Turned off in the chat: none of it.
    blacklist: blacklistGate(msg.wordBlacklist === false ? undefined : await loadBlacklist(), {
      sticky: wentMasked(history) || !!msg.wordBlacklist,
      pageUrl: tabId === undefined ? undefined : () => tabUrl(tabId),
    }),
  };

  const target = await targetFor(settings, cfg, msg.model, { tokens: msg.contextWindow, source: msg.contextWindowSource });
  const main = prepareAgent(run, agent, 1, target, history);
  const { seen, skills, templates, memory, registry } = main;
  // The system prompt keeps the memory it started with: a new one is kept from this turn on.
  if (main.built) {
    history = keepSystemMemory(history, main.built);
    send({ type: 'system-memory', memory: main.built });
  }
  let mentionedTools: string[] = []; // $tool: offered even if off, and asked for
  // EmptyAgent gets your message as you wrote it: no page, no mentions, nothing attached.
  const last = history.at(-1);
  if (last?.role === 'user' && !isEmptyAgent(agent)) {
    // An agent that uses only its sites gets the page only there; without the page, the model is
    // told why.
    const agentGetsPage = !agent || agentAllows(agent, hostOf(listedUrl));
    const skipped = last.pageSkipped;
    const noPageReason = () =>
      skipped === 'off' ? text('context.no_page_off')
      : skipped === 'unreadable' || tabId === undefined ? text('context.no_page_unreadable')
      : !agentGetsPage ? text('context.no_page_agent', { agent: agent.name })
      : undefined;
    const turn = await turnContext(
      { history, tabId, url: listedUrl, includePage: msg.includePage && agentGetsPage, noSelection: msg.noSelection, noPage: noPageReason(), userTab: msg.userTab, conversationId: msg.conversationId, skip: msg.skip },
      { settings: seen, skills, templates, memory, memoryOpts: main.memoryOpts, toolNames: registry.list().map((t) => t.name), requestAccess: askAccess, send },
    );
    mentionedTools = turn.mentionedTools;
    // What changed in memory since the kept one, first.
    const items = [...(main.kept && main.memoryOpts ? memoryChanges(memory, main.kept, main.memoryOpts, seenWhole(history)) : []), ...turn.items];
    if (items.length) {
      history = appendContext(history, items);
      send({ type: 'context', items });
    }
  }

  const excluded = excludedTools(seen, skills).filter((n) => !mentionedTools.includes(n));
  const base = loopOptions(run, agent, main, target, excluded, 'chat');
  // Groups offered once the model loads them (prepareAgent): the tools that create things for Browser
  // (Settings → Tools), the servers' set so (Settings → MCP servers).
  const opts = withOnDemand(base, history, mentionedTools, main.groups);
  const offersPlan = base.tools.registry.list().some((t) => t.name === 'user.plan');
  const loop = runAgentLoop(
    history,
    {
      ...opts,
      // Settings → Tools: the first call must use the mentioned tool (any of them, when several).
      model: { ...opts.model, thinking: msg.thinking, toolChoice: settings.mentions?.forceTool ? forcedToolChoice(mentionedTools) : undefined },
      // Between its steps, memory and bookmarks its replies match, then the plan to update (not for
      // EmptyAgent: nothing attached).
      context: { ...opts.context, view: (system, messages, seen) => opts.context.view(system, withPlansDismissed(messages, dismissedPlans), seen), attachAfter: isEmptyAgent(agent) ? undefined : async (reply, messages) => {
        const plan = stepPlanReminder(withPlansDismissed(messages, dismissedPlans), offersPlan);
        return [...(await stepAttachItems(reply, messages, seen, memory, msg.skip)), ...(plan ? [plan] : [])];
      } },
      hooks: { ...opts.hooks, onSub: (callId, label, event) => send({ type: 'sub', callId, agent: label, event }), onResult: (result) => send({ type: 'tool-result', result }) },
      startedAt,
    },
    signal,
  );
  const learn = learnFrom(target); // the meter and the estimates take it from then on
  for await (const evt of loop) {
    learn(evt);
    // An answer to a masked request says so: the conversation's next turns go masked too.
    send(evt.type === 'message' && evt.message.role === 'assistant' && run.blacklist.active ? { ...evt, message: { ...evt.message, masked: true } } : evt);
  }
}
