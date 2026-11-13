// Settings → Website access (the sites the extension may read) and Site policies (what each agent may do
// on each site).
import { onPermissionsChanged } from './permissions-changed';
import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { AGENTS, type AgentInfo } from '../agents/registry';
import { grantedSites, patternHost, sitePattern } from '../page/permissions';
import { PolicySelect } from './PolicySelect';
import { agentPolicyStore, type SitePolicies, type SitePolicy } from '../policy/store';
import { POLICY_LABELS } from '../core/site-policy';
import { FilterBox, useFilter } from './Collection';
import { FilterChips, SectionHead, StatStrip } from './SectionParts';
import { useSitePolicies } from './useSitePolicies';
import { askOrigins } from './ask-permission';
import { SiteInput, useSiteInput } from './SiteInput';
import { useReload } from './useLive';
import { useAttempt } from './useAttempt';

// Every agent's site policies, read once for all the granted sites' rows (not once per row), and
// again when one changes.
const NO_POLICIES: Record<string, SitePolicies> = {};
const loadAllPolicies = async () => Object.fromEntries(await Promise.all(AGENTS.map(async (a) => [a.id, await agentPolicyStore(a.id).load()] as const)));
const onAnyPolicies = (again: () => void) => {
  const stops = AGENTS.map((a) => agentPolicyStore(a.id).onChanged(again));
  return () => stops.forEach((stop) => stop());
};

// Global access (<all_urls>) plus the sites granted one by one (chat, custom tools, MCP…).
export function WebAccess() {
  const [all, setAll] = useState(false);
  const [sites, setSites] = useState<string[]>([]);
  const { failed, attempt } = useAttempt();
  const policies = useReload(loadAllPolicies, onAnyPolicies, NO_POLICIES, '[policies]');
  const refresh = async () => {
    setAll(await browser.permissions.contains({ origins: ['<all_urls>'] }));
    const { origins = [] } = await browser.permissions.getAll();
    setSites(grantedSites(origins, browser.runtime.getManifest().host_permissions ?? []));
  };
  useEffect(() => {
    const again = () => void refresh();
    again();
    return onPermissionsChanged(again);
  }, []);
  const toggle = async () => {
    if (all) await browser.permissions.remove({ origins: ['<all_urls>'] });
    else await browser.permissions.request({ origins: ['<all_urls>'] });
    await refresh();
  };
  // Called from a click (user gesture), required by permissions.request.
  const site = useSiteInput(async (draft) => {
    let pattern: string;
    try {
      pattern = sitePattern(draft);
    } catch {
      return 'Not a valid site';
    }
    const granted = await askOrigins(pattern);
    await refresh();
    return granted ? undefined : `Permission denied for ${pattern}`;
  });
  const remove = async (origin: string) => {
    await browser.permissions.remove({ origins: [origin] });
    await refresh();
  };
  return (
    <section>
      <h3>Website access</h3>
      <div className="row">
        <button onClick={() => attempt(toggle())}>{all ? 'Revoke access to all websites' : 'Allow access to all websites'}</button>
        <span className="status">{all ? 'Enabled' : 'Permission will be requested per site from the chat'}</span>
      </div>
      {failed && <p className="error-text" role="alert">{failed}</p>}
      <p className="hint">Required for screenshots unless you open the panel with the extension icon.</p>
      <h4>Granted sites</h4>
      {sites.length ? (
        sites.map((origin) => {
          const host = patternHost(origin);
          return (
            <div key={origin} className="row">
              <span className="host-name">{origin}</span>
              {host && AGENTS.map((a) => <AgentPolicySelect key={a.id} agent={a} host={host} policies={policies[a.id] ?? {}} />)}
              <button onClick={() => attempt(remove(origin))}>Remove</button>
            </div>
          );
        })
      ) : (
        <p className="hint">No sites granted one by one yet.</p>
      )}
      <SiteInput site={site} placeholder="Add site… e.g. chat.example.com" />
      <p className="hint">
        Sites you allowed from the chat, custom tools or MCP servers, and what each agent may do on them. Removing a site makes
        the extension ask for access again next time; its action policy stays under Site policies.
        {all && ' Access to all websites is on, so every site is reachable anyway.'}
      </p>
    </section>
  );
}

// What one agent may do on a site; the agent's name shows only once there is more than one agent.
function AgentPolicySelect({ agent, host, policies }: { agent: AgentInfo; host: string; policies: SitePolicies }) {
  const select = (
    <PolicySelect label={`${agent.name} on ${host}`} title={`What the ${agent.name} may do on this site`} value={policies[host]}
      onChange={(p) => void agentPolicyStore(agent.id).set(host, p)} />
  );
  return AGENTS.length > 1 ? <label className="agent-policy">{agent.name}{select}</label> : select;
}

// Per-site action policies, one list per agent; "Ask before acting" applies to every site not listed.
export function SitePoliciesSection() {
  return (
    <section className="site-policies-settings">
      <SectionHead title="Site policies" about={<>
        What the model may do on each site: ask before clicking, typing or navigating (every site but these), act without asking, or only read.
        A server of MCP tools has its policy here too, as <code>mcp:&lt;server&gt;</code>.
      </>} />
      {AGENTS.map((a) => <AgentPolicies key={a.id} agent={a} />)}
      <p className="hint">Every other site asks first. Choosing &quot;Ask before acting&quot; removes the exception.</p>
    </section>
  );
}

type PolicyFilter = Exclude<SitePolicy, 'ask'>;

// One agent's exceptions: how many of each, filtered by site or policy, each with its policy.
function AgentPolicies({ agent }: { agent: AgentInfo }) {
  const [policies, setPolicy] = useSitePolicies(agent.id);
  const { filter, setFilter, matches } = useFilter();
  const [shown, setShown] = useState<PolicyFilter | 'all'>('all');
  const hosts = Object.keys(policies).sort();
  const count = (p: SitePolicy) => hosts.filter((h) => policies[h] === p).length;
  const listed = hosts.filter((h) => (shown === 'all' || policies[h] === shown) && matches([h]));
  return (
    <>
      {AGENTS.length > 1 && <div className="section-subhead"><h4>{agent.name}</h4></div>}
      <StatStrip stats={[
        { label: 'Exceptions', value: hosts.length, sub: 'Sites that do not ask first' },
        { label: 'Act without asking', value: count('auto'), sub: POLICY_LABELS.auto },
        { label: 'Read only', value: count('read-only'), sub: 'Never click, type or navigate' },
      ]} />
      {hosts.length > 0 && (
        <div className="row policies-toolbar">
          <FilterBox label="Filter sites" value={filter} onChange={setFilter} />
          <FilterChips<PolicyFilter> label="Show" value={shown} onChange={setShown} total={hosts.length} filters={[
            { id: 'auto', label: 'Act without asking', tone: 'match', count: count('auto') },
            { id: 'read-only', label: 'Read only', tone: 'site', count: count('read-only') },
          ]} />
        </div>
      )}
      {listed.length ? (
        <ul className="switch-rows" aria-label={`${agent.name}: site policies`}>
          {listed.map((host) => (
            <li key={host}>
              <span className="host-name">{host}</span>
              <PolicySelect label={`Policy on ${host}`} value={policies[host]} onChange={(p) => setPolicy(host, p)} />
            </li>
          ))}
        </ul>
      ) : <p className="hint">{hosts.length ? 'No site matches.' : 'No site exceptions yet: a card that asks offers one (Allow ▾ → Always).'}</p>}
    </>
  );
}
