// The site policies a run goes by, for an agent or none: the agent's as saved now ("Always" may have
// changed them) over the shared ones of its column in Website access (`key`: Browser's, the page
// widget's). A policy decided while it runs goes to the agent when it keeps its own for that site,
// else to the column.
import { agentNow, agentPolicies, agentStore, keepsPolicy, withSite, type AgentProfile } from '../agents/profiles';
import { loadSitePolicies, setSitePolicy, type SitePolicy } from './store';

export function policyAccessFor(owner: AgentProfile | undefined, key: string) {
  return {
    policies: async (): Promise<Record<string, SitePolicy>> => {
      const shared = await loadSitePolicies(key);
      return owner ? agentPolicies(await agentNow(owner), shared) : shared;
    },
    // To the agent as stored when it is saved (its sites, and what the user changed since the card).
    save: async (host: string, policy: SitePolicy): Promise<void> => {
      const now = owner && (await agentNow(owner));
      if (now && keepsPolicy(now, host)) await agentStore.update(now.id, (a) => withSite(a, host, policy));
      else await setSitePolicy(host, policy, key);
    },
  };
}
