// A chat's run: the provider checked, the agent's setup (its tools, skills, templates, sites and the
// agents it may ask: background/run-setup), the page and the rest of the turn's context added to
// your message, then the agent loop, its events sent to the panel as they come. Sub-agents
// (agents.ask) run in background/sub-agent.
import { agentAllows, agentById, agentStore } from '../agents/profiles';
import { isEmptyAgent } from '../agents/builtins';
import { ASK_TOOL } from '../agents/ask';
import { forcedToolChoice } from '../context/inline-mentions';
import { excludedTools } from '../context/request';
import { stepPlanReminder } from '../context/plan-reminder';
import { withPlansDismissed } from '../tools/user/shapes';
import { stepAttachItems } from '../context/step-attach';
import { turnContext } from '../context/turn';
import { hasMessageTime, messageTimeItem } from '../context/date-time';
import { runAgentLoop } from '../core/agent-loop';
import { toWireName } from '../core/tool-registry';
import { keep } from '../core/kept-results';
import { phaseRecorder } from '../core/phases';
import { withOnDemand, type OnDemandGroup } from '../tools/load';
import { turnToolMatch, toolMatchNote } from '../tools/match-turn';
import { matchesAny } from '../tools/match';
import { indexToolsLater } from '../tools/tool-index';
import { autoInjectOn } from '../context/auto-inject';
import { meaningOffFor } from '../context/meaning-off';
import { MEANING_FAILED_NOTICE } from '../memory/query-meaning';
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
  // The turn's phases (core/phases), sent as they go: those the panel measured before it (compacting),
  // the wait for the worker, then the run's own.
  const phases = phaseRecorder((phase) => send({ type: 'phase', phase }));
  for (const p of Array.isArray(msg.lead) ? msg.lead : []) send({ type: 'phase', phase: p });
  if (typeof msg.sentAt === 'number' && startedAt >= msg.sentAt) phases.add({ kind: 'start', label: 'Starting the agent', at: msg.sentAt, ms: startedAt - msg.sentAt });
  const setup = phases.start({ kind: 'setup', label: 'Setting up', at: startedAt });
  // This run's questions: once it stops, answered no without asking.
  const askAccess = (access: AccessRequest) => questions.ask((id) => ({ type: 'access', id, ...access }), false, signal);
  const settings = await settingsNow();
  const cfg = settings.providers.find((p) => p.id === msg.providerId);
  if (!cfg) {
    setup.end('provider not configured');
    return send({ type: 'error', error: 'Provider not configured' });
  }
  setup.note(`${cfg.name} · ${msg.model}`);
  // The provider's site is granted at runtime (Test connection in Settings, or here, once).
  if (!(await reachOrAsk(cfg, askAccess))) {
    setup.end('no access to the provider');
    return send({ type: 'error', error: `No access to ${providerAccess(cfg).site}: allow it to use the provider "${cfg.name}", or test it in Settings → Providers.` });
  }

  const [allSkills, allTemplates, agents, allMemory] = await Promise.all([skillStore.load(), templateStore.load(), agentStore.load(), loadMemory()]);
  const agent = agentById(agents, msg.agentId);
  let history = msg.history;
  const { tabId } = msg;
  const listedUrl = tabId === undefined ? undefined : await tabUrl(tabId); // the page whose tools come next
  setup.end();
  const listing = phases.start({ kind: 'tools', label: 'Listing the tools' });
  const { registry: all, mcpErrors } = await toolsFor(tabId, settings, { url: listedUrl, signal, chat: true }).finally(() => listing.end());
  // A server that could not be reached is not said in the chat (the MCP menu marks it, and Layers'
  // phase counts it), unless the model calls one of its tools: then why, once per server.
  const saidUnreached = new Set<string>();
  const unreachedCall = (name: string) => {
    const e = mcpErrors.find((x) => name.startsWith(`mcp.${x.server}.`) || name.startsWith(toWireName(`mcp.${x.server}.`)));
    if (!e || saidUnreached.has(e.server)) return;
    saidUnreached.add(e.server);
    send({ type: 'notice', text: e.signIn ? `${e.error} Its tools are not offered until then.` : `MCP server "${e.server}" could not be reached, its tools are not offered: ${e.error}` });
  };
  const run: RunScope = {
    msg, settings, all, agents, allSkills, allTemplates, allMemory, listedUrl, askAccess, signal, send, questions, interact, dismissedPlans, phases,
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
  let mentionedTools: string[] = []; // $tool: offered even if off, and asked for; agents.ask too with an @agent
  let forcedTools: string[] = []; // those Settings → Tools' forcing applies to: the $tool ones
  let held: OnDemandGroup[] = []; // the tool groups the message did not match, for tools.load (Only matching)
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
    const thisTurn = {}; // the message's vector is asked once for memory and the tool groups
    const preparing = phases.start({ kind: 'context', label: 'Preparing your message' });
    const turn = await turnContext(
      { history, tabId, url: listedUrl, includePage: msg.includePage && agentGetsPage, noSelection: msg.noSelection, noPage: noPageReason(), userTab: msg.userTab, conversationId: msg.conversationId, skip: msg.skip, turn: thisTurn },
      { settings: seen, skills, templates, memory, memoryOpts: main.memoryOpts, toolNames: registry.list().map((t) => t.name), askable: main.callable, requestAccess: askAccess, send, phases: phases.under(preparing.id) },
    ).finally(() => preparing.end());
    forcedTools = turn.mentionedTools;
    // An agent mentioned is asked through agents.ask: offered as a mentioned tool is, but not forced.
    mentionedTools = turn.mentionedAgents.length && !forcedTools.includes(ASK_TOOL) ? [...forcedTools, ASK_TOOL] : forcedTools;
    // Settings → Tools → Matching: the tool groups the message matches (tools/match), recommended with it
    // or the others held for tools.load.
    const offeredNow = registry.without(excludedTools(seen, skills).filter((n) => !mentionedTools.includes(n))).list();
    // Asked only once a mode matches: the default waits on nothing.
    const meaningOn = async () => autoInjectOn(settings, 'memoryMeaning', msg.skip) && !(await meaningOffFor(msg.conversationId));
    const matching = () => turnToolMatch({ settings, tools: offeredNow, history, mentioned: mentionedTools, onDemand: main.groups, meaningOn, turn: thisTurn });
    // A phase of its own only when something is matched (the default matches nothing).
    const tools = matchesAny(settings) ? await phases.under(preparing.id).time({ kind: 'tools', label: 'Matching the tools' }, matching, toolMatchNote) : await matching();
    if (tools.failed) send({ type: 'notice', text: MEANING_FAILED_NOTICE });
    // Tools not indexed yet went by words: indexed now, off this message's path (tools/tool-index).
    if (tools.toIndex) indexToolsLater(settings, tools.toIndex);
    if (tools.match) send({ type: 'tool-match', match: tools.match });
    held = tools.held;
    // What changed in memory since the kept one, first.
    const changes = main.kept && main.memoryOpts ? memoryChanges(memory, main.kept, main.memoryOpts, seenWhole(history)) : [];
    if (changes.length) phases.under(preparing.id).add({ kind: 'context', label: 'Memory changed since', detail: `${changes.length} attached`, ms: 0 });
    // Last, when you wrote it (Settings → About you → Date & time): when the panel sent it, written once.
    const stamp = hasMessageTime(last) ? undefined : messageTimeItem(typeof msg.sentAt === 'number' ? msg.sentAt : Date.now(), seen.dateTime);
    const items = [...changes, ...turn.items, ...(tools.item ? [tools.item] : []), ...(stamp ? [stamp] : [])];
    preparing.note(items.length ? `${items.length} attached` : 'nothing attached');
    if (items.length) {
      history = appendContext(history, items);
      send({ type: 'context', items });
    }
  }

  const excluded = excludedTools(seen, skills).filter((n) => !mentionedTools.includes(n));
  const base = loopOptions(run, agent, main, target, excluded, 'chat');
  // Groups offered once the model loads them (prepareAgent): the tools that create things for Browser
  // (Settings → Tools), the servers' set so (Settings → MCP servers).
  // And the tool groups your message did not match, with Only matching (tools/match).
  const opts = withOnDemand(base, history, mentionedTools, [...main.groups, ...held]);
  const offersPlan = base.tools.registry.list().some((t) => t.name === 'user.plan');
  // How many tools the model is offered (more may come once it loads a group), and the servers left out.
  const offered = opts.tools.registry.list().length;
  listing.note(`${offered} offered${mcpErrors.length ? ` · ${mcpErrors.length} MCP ${mcpErrors.length === 1 ? 'server' : 'servers'} unreachable` : ''}`);
  const loop = runAgentLoop(
    history,
    {
      ...opts,
      // Settings → Tools: the first call must use the mentioned tool (any of them, when several).
      model: { ...opts.model, thinking: msg.thinking, toolChoice: settings.mentions?.forceTool ? forcedToolChoice(forcedTools) : undefined },
      // Between its steps, memory and bookmarks its replies match, then the plan to update (not for
      // EmptyAgent: nothing attached).
      context: { ...opts.context, view: (system, messages, seen) => opts.context.view(system, withPlansDismissed(messages, dismissedPlans), seen), attachAfter: isEmptyAgent(agent) ? undefined : async (reply, messages) => {
        const plan = stepPlanReminder(withPlansDismissed(messages, dismissedPlans), offersPlan);
        return [...(await stepAttachItems(reply, messages, seen, memory, msg.skip)), ...(plan ? [plan] : [])];
      } },
      hooks: { ...opts.hooks, phases, log: (call) => {
        opts.hooks?.log?.(call);
        if (call.refused === 'unknown tool') unreachedCall(call.tool);
      }, onSub: (callId, label, event) => send({ type: 'sub', callId, agent: label, event }), onResult: (result) => send({ type: 'tool-result', result }) },
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
