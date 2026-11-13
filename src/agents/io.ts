// Agents as JSON, to back them up or share them (Settings → Agents): { "agents": [...] }. An agent is
// a set of permissions, so one from a file comes in switched off, for the user to review, and never
// acts on a site without asking: "act without asking" comes in as "ask" ("read only" stays).
import type { SitePolicy } from '../policy/store';
import { importNamed, listFrom, stringList, type ImportRow } from '../storage/import';
import { agentProblems, isSiteKey, newAgentProfile, type AgentProfile } from './profiles';

type Shared = Omit<AgentProfile, 'id' | 'enabled' | 'builtin' | 'builderSkills' | 'builderTools' | 'givenTools'>;

export function exportAgents(agents: AgentProfile[]): string {
  const shared = agents.map(({ id: _id, enabled: _enabled, builtin: _builtin, builderSkills: _builderSkills, builderTools: _builderTools, givenTools: _givenTools, ...a }): Shared => a);
  return JSON.stringify({ agents: shared }, null, 2);
}

const askAtMost = (p: unknown): SitePolicy => (p === 'read-only' ? 'read-only' : 'ask');

// The agents in the JSON ({ "agents": [...] }, a list, or one), each new or replacing the one of its
// name, those left out, with why, and a row each.
export function importAgents(json: string, existing: AgentProfile[]): { agents: AgentProfile[]; skipped: string[]; rows: ImportRow<AgentProfile>[] } {
  const { items: agents, skipped, rows } = importNamed<AgentProfile>({
    list: listFrom(json, 'agents'),
    existing,
    build: (raw) => {
      const item = raw as Partial<AgentProfile>;
      const { id: _id, ...blank } = newAgentProfile();
      return {
        ...blank,
        enabled: false,
        name: String(item.name ?? '').trim(),
        ...(typeof item.icon === 'string' && item.icon.trim() && { icon: item.icon.trim() }),
        description: String(item.description ?? ''),
        instructions: String(item.instructions ?? ''),
        ...(typeof item.providerId === 'string' && typeof item.model === 'string' && { providerId: item.providerId, model: item.model }),
        tools: stringList(item.tools),
        skills: stringList(item.skills),
        templates: stringList(item.templates),
        sites: Object.fromEntries(Object.entries(item.sites ?? {}).filter(([host]) => isSiteKey(host)).map(([host, p]) => [host, askAtMost(p)])),
        ...(item.onlyItsSites === true && { onlyItsSites: true }),
        canAsk: item.canAsk === true,
        canBeAsked: item.canBeAsked === true,
        ...(item.memory === 'internal' && { memory: 'internal' as const }),
        // Its voice profile by id, as its provider: Settings → Speak's travel with the settings.
        ...(typeof item.voiceProfileId === 'string' && { voiceProfileId: item.voiceProfileId }),
        ...(item.canSpeak === true && { canSpeak: true }),
      };
    },
    problems: agentProblems,
  });
  return { agents, skipped, rows };
}
