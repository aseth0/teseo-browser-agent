// Per-site action policies: one set per agent (agents/registry), all in the extension's own
// IndexedDB (storage/secrets, "sitePolicies"), which no content script can read or write (storage.local
// they can: a page could have allowed itself); and one set per conversation in storage.session ("In
// this conversation" on the confirmation card), gone with a new conversation or when the browser
// closes. The conversation's comes before the agent's (effectivePolicy).
import { browser } from 'wxt/browser';
import { storageRecord } from '../storage/area';
import { BROWSER_AGENT } from '../agents/registry';
import { moveOnce, onSecretChanged, readSecret, updateSecret } from '../storage/secrets';
import { serialized } from '../storage/serial';
import { watchKey } from '../storage/watch';
import type { SitePolicy } from '../core/site-policy';

export type { SitePolicy };
export type SitePolicies = Record<string, SitePolicy>;

export interface PolicyStore {
  load(): Promise<SitePolicies>;
  set(host: string, policy: SitePolicy): Promise<void>; // "ask" is the default: its entry is removed
  onChanged(cb: (p: SitePolicies) => void): () => void;
}

// The policies of every agent, by agent.
type AllPolicies = Record<string, SitePolicies>;
const SECRET = 'sitePolicies';

const withPolicy = (all: SitePolicies, host: string, policy: SitePolicy): SitePolicies => {
  const next = { ...all };
  if (policy === 'ask') delete next[host];
  else next[host] = policy;
  return next;
};

// An agent's policies (the panel and the background both write them: one at a time, storage/secrets).
function agentStoreOf(agent: string): PolicyStore {
  const load = async () => (await readSecret<AllPolicies>(SECRET))?.[agent] ?? {};
  return {
    load,
    set: (host, policy) => updateSecret<AllPolicies>(SECRET, (all = {}) => ({ value: { ...all, [agent]: withPolicy(all[agent] ?? {}, host, policy) }, notify: true })),
    onChanged: (cb) => onSecretChanged(SECRET, () => void load().then(cb, (e: unknown) => console.error('[policies]', e))),
  };
}

// A conversation's, in storage.session (content scripts cannot read that area). Its changes one at a
// time, movePolicyKey's too.
const sessionSerials = new Map<string, ReturnType<typeof serialized>>();
const sessionSerial = (key: string) => {
  let serial = sessionSerials.get(key);
  if (!serial) sessionSerials.set(key, (serial = serialized(`policies:session:${key}`)));
  return serial;
};
function sessionStore(key: string): PolicyStore {
  const load = (): Promise<SitePolicies> => storageRecord<SitePolicy>('session', key);
  const serial = sessionSerial(key);
  return {
    load,
    set: (host, policy) => serial(async () => browser.storage.session.set({ [key]: withPolicy(await load(), host, policy) })),
    onChanged: (cb) => watchKey('session', key, (c) => cb((c.newValue as SitePolicies | undefined) ?? {})),
  };
}

export const agentPolicyStore = (agent = BROWSER_AGENT): PolicyStore => agentStoreOf(agent);
const CONVERSATION_PREFIX = 'conversationPolicies:';

// A key's policy (an MCP server's, renamed or removed) moved to another key, or dropped: for every
// agent's own policies here, and for every conversation of this browser session.
export async function movePolicyKey(from: string, to: string | undefined): Promise<void> {
  const moved = (p: SitePolicies): SitePolicies => {
    const { [from]: policy, ...rest } = p;
    return policy && to ? { ...rest, [to]: policy } : rest;
  };
  await updateSecret<AllPolicies>(SECRET, (all = {}) => {
    const touched = Object.values(all).some((p) => from in p);
    return { value: touched ? Object.fromEntries(Object.entries(all).map(([agent, p]) => [agent, moved(p)])) : all, notify: touched };
  });
  const session = await browser.storage.session.get(null);
  const keys = Object.keys(session).filter((key) => key.startsWith(CONVERSATION_PREFIX));
  // Each read again inside its lock, so that a policy set meanwhile is kept.
  await Promise.all(keys.map((key) => sessionSerial(key)(async () => {
    const p = await storageRecord<SitePolicy>('session', key);
    if (from in p) await browser.storage.session.set({ [key]: moved(p) });
  })));
}
export const conversationPolicies = (conversationId: string): PolicyStore => sessionStore(`${CONVERSATION_PREFIX}${conversationId}`);

export const loadSitePolicies = (agent = BROWSER_AGENT) => agentPolicyStore(agent).load();
export const setSitePolicy = (host: string, policy: SitePolicy, agent = BROWSER_AGENT) => agentPolicyStore(agent).set(host, policy);

// Policies earlier versions kept in storage.local ("sitePolicies" for the browser agent, from before
// agents existed; "sitePolicies.<agent>"), moved here once (storage/secrets moveOnce); a policy already
// here wins.
const LEGACY_KEY = /^sitePolicies(?:\.(.+))?$/;
export async function moveLegacyPolicies(): Promise<void> {
  const keys = Object.keys(await browser.storage.local.get(null)).filter((k) => LEGACY_KEY.test(k));
  await moveOnce(SECRET, keys, (stored) =>
    updateSecret<AllPolicies>(SECRET, (all = {}) => {
      const next = { ...all };
      for (const [key, policies] of Object.entries(stored)) {
        const agent = LEGACY_KEY.exec(key)![1] ?? BROWSER_AGENT;
        next[agent] = { ...(policies as SitePolicies), ...next[agent] };
      }
      return { value: next, notify: true };
    }),
  );
}

// The policy in force for a host: the conversation's, else the site's, else ask.
export const effectivePolicy = (conversation: SitePolicies, site: SitePolicies, host: string): SitePolicy => conversation[host] ?? site[host] ?? 'ask';

