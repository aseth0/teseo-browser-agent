// What a request is built from (the skills, site templates, tools, agents and memory), and the
// request as `agent` sees it (request-parts requestAs), for the prompt preview.
import { agentStore, type AgentProfile } from '../agents/profiles';
import { memoryStore } from '../memory/store';
import type { Settings } from '../storage/settings';
import type { Message } from '../core/types';
import { useTemplates } from './templates/useTemplates';
import { requestAs } from './request-parts';
import { useSkills } from './Skills';
import { useToolCatalog } from './Tools';
import { useCollection } from './useCollection';

export function useRequestAs(agent: AgentProfile | undefined, settings: Settings, history?: Message[]) {
  const sources = useRequestSources();
  const { skills, templates, catalog } = sources;
  return { ...requestAs(agent, settings, sources, false, history), loaded: { skills, templates, catalog } };
}

// Every source of a request, each kept up to date.
export function useRequestSources() {
  return { skills: useSkills(), templates: useTemplates(), catalog: useToolCatalog(), agents: useCollection(agentStore), memory: useCollection(memoryStore) };
}
