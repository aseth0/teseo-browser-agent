// Agents the user talks to in the chat (Settings → Agents): each with its own instructions, model,
// and only the tools and skills the user gives it; every site, or only its own (onlyItsSites).
// Browser, the chat as it always was, is not stored: it is the browser agent (agents/registry), set
// up in Settings → Tools, Skills and Website access, with every tool not switched off.
import { createCollection, type Collection, type CollectionItem } from '../storage/collection';
import { fieldsPart, withSecretPart } from '../storage/secret-part';
import { sameName } from '../storage/import';
import { readSecret } from '../storage/secrets';
import type { SitePolicy } from '../policy/store';
import type { Skill } from '../skills/types';
import type { PageTemplate } from '../templates/types';
import type { Settings } from '../storage/settings';
import { HISTORY_TOOLS } from '../history/names';
import { isMcpPolicyHost } from '../core/mcp-keys';
import { MEMORY_TOOLS } from '../core/memory-names';
import { isHost } from '../core/hosts';
import { ASK_TOOL } from './ask';
import { PANEL_TOOLS } from './panel';
import { builderOn, builderProfile, upgradeBuilder } from './builder';
import { BUILDER_ID, CREATE_TOOLS } from '../core/builder-ids';
import { DEFAULT_AGENT_ICON, DEFAULT_AGENT_ID, DEFAULT_AGENT_NAME, DEFAULT_NAMES, EMPTY_AGENT, browserAsAgent } from './builtins';
import { EMPTY_AGENT_ID } from './registry';

export interface AgentProfile extends CollectionItem {
  name: string;
  icon?: string; // an emoji
  description: string; // what it is for (other agents will read it to call it)
  instructions: string; // added after the general system prompt
  providerId?: string; // its model; none: the chat's
  model?: string;
  tools: string[]; // the tools it is offered, by dotted name: nothing else, nor tools added later
  skills: string[]; // the skills it gets, by name
  templates: string[]; // the site templates it gets, by name
  sites: Record<string, SitePolicy>; // its sites, each with its policy: the chat opens with it there
  onlyItsSites?: boolean; // it uses only its sites; none: every site, the site's own policy where it has none
  canAsk: boolean; // it may ask other agents (agents.ask): those that can be asked
  canBeAsked: boolean; // other agents may ask it
  memory?: 'internal'; // what it saves (memory.save naming no agent) is its alone; none: external, every agent's
  builderSkills?: string[]; // Builder's: the skills it came with, as of its last load (upgradeBuilder)
  builderTools?: string[]; // and the tools, likewise
  givenTools?: string[]; // the tools it got on its own as they came out (givenNewTools): one the user took away stays away
  voiceProfileId?: string; // Settings → Speak's profile its answers are read with; none (or one removed): the default one
  canSpeak?: boolean; // offered speech.say, to read a text aloud on its own (default: no)
}

// Browser as the chat and the agents table show it: its name and icon (Settings → Agents → Browser).
export const browserAgentLabel = (settings: Pick<Settings, 'browserAgent'>) =>
  agentLabel({ name: DEFAULT_AGENT_NAME, icon: settings.browserAgent?.icon ?? DEFAULT_AGENT_ICON });

// Names no agent may take.
const RESERVED_NAMES = [...DEFAULT_NAMES, EMPTY_AGENT.name.toLowerCase()];

// What an agent's sites are keyed by: a host, or an MCP server's policy key ("mcp:<server>",
// core/mcp-keys' serverPolicyHost), which "Always" on an MCP tool's card saves.
export const isSiteKey = (key: string) => isHost(key) || isMcpPolicyHost(key);

// Agents saved before a field existed get it empty (what the move takes too, moveAgentAccess).
const stored = createCollection<AgentProfile>('agents', [], (a) => ({
  ...a,
  templates: a.templates ?? [],
  canAsk: a.canAsk ?? false,
  canBeAsked: a.canBeAsked ?? false,
  sites: a.sites ?? {},
}));
// Builder first, as stored or as it comes.
const withBuilder = (agents: AgentProfile[]) => [agents.find((a) => a.id === BUILDER_ID) ?? builderProfile(), ...agents.filter((a) => a.id !== BUILDER_ID)];

// What gives an agent its reach: its sites (its policy on each), whether it uses only those, its tools,
// whom it may ask or be asked by, and whether it is on. Kept in storage/secrets and read only there, not
// with the rest of it in storage.local, which content scripts may write: there a page could give an
// agent "act without asking" on itself, every site or the tools that create things, as Browser's site
// policies are kept apart for (policy/store). An agent written to storage.local alone (a page's) is
// off, with nothing. storage.local keeps a copy of it, never read, for earlier versions.
const ACCESS = ['sites', 'onlyItsSites', 'tools', 'canAsk', 'canBeAsked', 'enabled'] as const;
type Access = Pick<AgentProfile, (typeof ACCESS)[number]>;
const NO_ACCESS = (): Access => ({ sites: {}, onlyItsSites: true, tools: [], canAsk: false, canBeAsked: false, enabled: false });
const access = withSecretPart(stored, {
  secret: 'agentAccess',
  ...fieldsPart<AgentProfile, (typeof ACCESS)[number]>(ACCESS, NO_ACCESS),
  // A site that is not a host (nor an MCP server's key) is dropped.
  upgrade: (a) => {
    const now = givenNewTools({ ...a, sites: Object.fromEntries(Object.entries(a.sites).filter(([host]) => isSiteKey(host))) });
    return a.id === BUILDER_ID ? upgradeBuilder(now) : now;
  },
});

// Tools that came out after agents were made, each with the tools whose agents get it: once, so one
// the user takes away stays away.
const NEW_TOOLS: Record<string, string[]> = { 'memory.list': ['memory.read', 'memory.search'] };
function givenNewTools(a: AgentProfile): AgentProfile {
  const given = a.givenTools ?? [];
  const added = Object.keys(NEW_TOOLS).filter((t) => !given.includes(t) && !a.tools.includes(t) && NEW_TOOLS[t]!.some((w) => a.tools.includes(w)));
  return { ...a, tools: [...a.tools, ...added], givenTools: Object.keys(NEW_TOOLS) };
}

// Moved once from where earlier versions kept it: the agents' sites in the secret "agentSites" (left
// there for them), the rest in storage.local with the agents.
async function moveAgentAccess(): Promise<void> {
  await access.moveIn('agentAccess', async (user) => {
    const sites = await readSecret<Record<string, Record<string, SitePolicy>>>('agentSites');
    return user.map((a) => ({ ...a, sites: sites?.[a.id] ?? a.sites }));
  });
}

const loadAgents = async () => {
  await moveAgentAccess();
  return withBuilder(await access.load());
};

export const agentStore: Collection<AgentProfile> = {
  ...access,
  load: loadAgents,
  // Builder comes as it is until it is first saved.
  update: async (id, change, missing) => {
    await moveAgentAccess();
    return access.update(id, change, missing ?? (id === BUILDER_ID ? builderProfile : undefined));
  },
  remove: async (id) => {
    if (id !== BUILDER_ID) await access.remove(id);
  },
  removeMany: (ids) => access.removeMany(ids.filter((id) => id !== BUILDER_ID)),
  onChanged: (cb) => access.onChanged((agents) => cb(withBuilder(agents))),
};

export const newAgentProfile = (): AgentProfile => ({ id: crypto.randomUUID(), enabled: true, name: '', description: '', instructions: '', tools: [], skills: [], templates: [], sites: {}, canAsk: false, canBeAsked: false, givenTools: Object.keys(NEW_TOOLS) });

// An agent by its name as the user or the model writes it ("Browser" too, or "Default"), and its name
// by its id; none when there is no such agent.
export const isDefaultName = (name: string) => DEFAULT_NAMES.includes(name.trim().toLowerCase());
export const agentIdByName = (agents: AgentProfile[], name: string) =>
  isDefaultName(name) ? DEFAULT_AGENT_ID : agents.find((a) => sameName(a.name, name))?.id;
export const agentNameById = (agents: AgentProfile[], id: string) => (id === DEFAULT_AGENT_ID ? DEFAULT_AGENT_NAME : agents.find((a) => a.id === id)?.name);

// The ids in the order the user dragged them to (Settings → Agents); those not placed yet keep their
// place after them.
function inAgentOrder(ids: string[], order: string[] = []): string[] {
  const at = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length + ids.indexOf(id));
  return [...ids].sort((a, b) => at(a) - at(b));
}
// Every agent the chat offers, Browser and EmptyAgent too, by id, in that order.
export const orderedAgentIds = (agents: { id: string }[], order?: string[]) => inAgentOrder([DEFAULT_AGENT_ID, EMPTY_AGENT_ID, ...agents.map((a) => a.id)], order);
// One moved from one place to another (indexes in the ordered list).
export const movedAgent = (ids: string[], from: number, to: number) => {
  const next = [...ids];
  const [id] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, id!);
  return next;
};

export const agentLabel = (a: { name: string; icon?: string }) => (a.icon?.trim() ? `${a.icon.trim()} ${a.name}` : a.name);

// The agent a conversation runs as: EmptyAgent, or the one of that id while it is switched on; else
// Browser (none).
export const agentById = (agents: AgentProfile[], id: string | undefined) =>
  id === EMPTY_AGENT_ID ? EMPTY_AGENT : id && id !== DEFAULT_AGENT_ID ? agents.find((a) => a.id === id && a.enabled) : undefined;
// An agent as saved now ("Always" in a card may have changed its sites since it was loaded).
export const agentNow = async (a: AgentProfile) => agentById(await agentStore.load(), a.id) ?? a;

// What keeps it from being saved.
export function agentProblems(agent: AgentProfile, agents: AgentProfile[]): string[] {
  const name = agent.name.trim();
  const problems: string[] = [];
  if (!name) problems.push('The agent needs a name.');
  else if (RESERVED_NAMES.includes(name.toLowerCase()) || agents.some((a) => a.id !== agent.id && sameName(a.name, name))) problems.push(`Another agent is named "${name}".`);
  if (!!agent.providerId !== !!agent.model?.trim()) problems.push('Choose both the provider and the model, or neither (the chat\'s).');
  return problems;
}

// Skills or site templates as the agent sees them: on only those it was given, by name.
const onlyGiven = <T extends { name: string; enabled: boolean }>(items: T[], names: string[]): T[] => items.map((i) => ({ ...i, enabled: names.includes(i.name) }));
// The site templates as the agent sees them (none: Browser, all): the run's and the page bar's chips.
export const templatesSeenBy = (agent: AgentProfile | undefined, templates: PageTemplate[]): PageTemplate[] => (agent ? onlyGiven(templates, agent.templates) : templates);

// What a request is built from, as the agent sees it (none: Browser, as is): only its skills and site
// templates on, and what Settings → Tools switches off becomes what the agent lacks, for the parts of
// the prompt that depend on a tool by name (the history and memory tools); its tools themselves come from
// agentOffers. The background builds the request with it, and the chat's views rebuild it with it.
export function seenBy(agent: AgentProfile | undefined, settings: Settings, skills: Skill[], templates: PageTemplate[]): { settings: Settings; skills: Skill[]; templates: PageTemplate[] } {
  if (!agent) return { settings, skills, templates };
  return {
    settings: { ...settings, disabledTools: [...HISTORY_TOOLS, ...MEMORY_TOOLS].filter((n) => !agent.tools.includes(n)) },
    skills: onlyGiven(skills, agent.skills),
    templates: templatesSeenBy(agent, templates),
  };
}

// Its tools, plus those that go with what it was given: the skill loaders (without a general skill
// they are left out like Browser's, excludedTools), agents.ask (without anyone to ask, withAsk) and the
// Agents Panel's tools (only where the panel offers them, withPanel).
// Browser: every tool, but the creating ones while Builder is on.
export const IMPLICIT = ['skills.load', 'skills.read_reference', ASK_TOOL, ...PANEL_TOOLS];
export const agentHasTool = (agent: Pick<AgentProfile, 'tools'>, name: string) => agent.tools.includes(name) || IMPLICIT.includes(name);
export const agentOffers = <T extends { name: string }>(agent: AgentProfile | undefined, tools: T[], agents: AgentProfile[]) =>
  agent ? tools.filter((t) => agentHasTool(agent, t.name)) : builderOn(agents) ? tools.filter((t) => !CREATE_TOOLS.includes(t.name)) : tools;

// The agent with a host (or an MCP server's key) given with its policy, or taken away (none); anything else, never given.
export function withSite(agent: AgentProfile, host: string, policy: SitePolicy | undefined): AgentProfile {
  const { [host]: _old, ...sites } = agent.sites;
  return { ...agent, sites: policy && isSiteKey(host) ? { ...sites, [host]: policy } : sites };
}

// An agent's tools as the tools menus edit them (a list of those switched off, Settings →
// Tools' disabledTools; the implicit ones always on), and back: a tool not in the catalog now keeps
// its place.
export const agentDisabledTools = (agent: Pick<AgentProfile, 'tools'>, catalog: string[]) => catalog.filter((n) => !agentHasTool(agent, n));
export const agentToolsFrom = (agent: Pick<AgentProfile, 'tools'>, catalog: string[], disabled: string[] = []) =>
  [...agent.tools.filter((n) => !catalog.includes(n)), ...catalog.filter((n) => !disabled.includes(n) && (!IMPLICIT.includes(n) || agent.tools.includes(n)))].sort();

// The agents one may ask: with "Can ask" (Browser's, Settings → Agents), every other one switched on
// that "Can be asked", Browser too when it can be.
export function callableAgents(agent: AgentProfile | undefined, agents: AgentProfile[], settings: Pick<Settings, 'defaultCanAsk' | 'browserAgent'>): AgentProfile[] {
  if (!(agent ? agent.canAsk : settings.defaultCanAsk)) return [];
  const browser = agent && agent.id !== DEFAULT_AGENT_ID && settings.browserAgent?.canBeAsked ? [browserAsAgent(settings)] : [];
  return [...browser, ...agents.filter((a) => a.enabled && a.canBeAsked && a.id !== agent?.id)];
}

// Whether the agent may use a host (from a URL: "example.com", "localhost:8080").
export const agentAllows = (agent: AgentProfile, host: string) => !agent.onlyItsSites || Object.hasOwn(agent.sites, host);

// What an agent may do on each site: its own policies over the sites' (`shared`: Browser's, or the
// page widget's), those alone when it uses only its sites.
export const agentPolicies = (agent: AgentProfile, shared: Record<string, SitePolicy>): Record<string, SitePolicy> =>
  agent.onlyItsSites ? agent.sites : { ...shared, ...agent.sites };

// Where "Always" on a card saves an agent's decision: to the agent on its sites (or on any, when it
// uses only those); elsewhere to the site's, as saving it to the agent would make the site its own.
export const keepsPolicy = (agent: AgentProfile, host: string) => !!agent.onlyItsSites || Object.hasOwn(agent.sites, host);

// The agent the chat opens with on a host: the first switched on that has it among its sites.
export const agentOfSite = (agents: AgentProfile[], host: string) => agents.find((a) => a.enabled && Object.hasOwn(a.sites, host));

// The agent the chat changes to on reaching a host: its first, from Browser or from the agent a site
// chose (`bySite`) when that one does not have the host too; never from one chosen by hand.
export function siteSwitch(agents: AgentProfile[], host: string, chosenId: string | undefined, bySite?: string) {
  const chosen = agentById(agents, chosenId);
  return chosen && (chosen.id !== bySite || Object.hasOwn(chosen.sites, host)) ? undefined : agentOfSite(agents, host);
}
