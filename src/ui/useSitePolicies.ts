import { BROWSER_AGENT } from '../agents/registry';
import { agentPolicyStore, conversationPolicies, type PolicyStore, type SitePolicies, type SitePolicy } from '../policy/store';
import { useLive } from './useLive';

const NONE: SitePolicies = {};

// Live view of one stored set of policies (`key`: what it is of, to subscribe again when it changes).
function usePolicyStore(make: () => PolicyStore, key: string): [SitePolicies, (host: string, p: SitePolicy) => void] {
  const policies = useLive(() => make().load(), (set) => make().onChanged(set), NONE, '[policies]', key);
  return [policies, (host, p) => void make().set(host, p)];
}

// An agent's per-site action policies (also updated by "Always on this site").
export const useSitePolicies = (agent = BROWSER_AGENT) => usePolicyStore(() => agentPolicyStore(agent), agent);

// The sites allowed to act without asking in one conversation ("In this conversation").
export const useConversationPolicies = (conversationId: string) => usePolicyStore(() => conversationPolicies(conversationId), conversationId);

