// The sections of an agent's editor (ui/agents/AgentEditor, BrowserEditor).
import { agentDisabledTools, agentToolsFrom } from '../../agents/profiles';
import { isHost } from '../../core/hosts';
import { toWireName } from '../../core/tool-registry';
import { originPattern, siteHost } from '../../page/permissions';
import type { SitePolicy } from '../../policy/store';
import type { Skill } from '../../skills/types';
import type { PageTemplate } from '../../templates/types';
import { MissingAccess } from '../fields';
import { PolicySelect } from '../PolicySelect';
import { SiteInput, useSiteInput } from '../SiteInput';
import { PageSection } from '../text-pages';
import { ToolsList, useToolCatalog } from '../Tools';

// Browser's tools: those switched on in Settings → Tools (the same list).
export function BrowserTools({ disabled, onChange }: { disabled: string[]; onChange: (disabled: string[]) => void }) {
  const catalog = useToolCatalog();
  const on = catalog.filter((t) => !disabled.includes(t.name)).map((t) => t.name);
  return (
    <PageSection page="tools" title="Tools" count={on.length} summary={nameList(on.map(toWireName), 'No tools: it only answers.')}>
      <p className="hint">The same as Settings → Tools: what you switch here, you switch there.</p>
      <ToolsList tools={catalog} disabled={disabled} onDisabled={onChange} />
    </PageSection>
  );
}

// What a section has, in a line (the first few, then how many more).
const SHOWN_NAMES = 8;
const nameList = (list: string[], none: string) =>
  list.length ? `${list.slice(0, SHOWN_NAMES).join(', ')}${list.length > SHOWN_NAMES ? ` and ${list.length - SHOWN_NAMES} more` : ''}` : none;

// The tools it is offered, as in the chat's 🔧 menu: only those ticked. Tools not available now (a
// server not connected, a page's own tools) keep their tick.
export function AgentTools({ tools, onChange }: { tools: string[]; onChange: (tools: string[]) => void }) {
  const catalog = useToolCatalog();
  const names = catalog.map((t) => t.name);
  return (
    <PageSection page="tools" title="Tools" count={tools.length} summary={nameList(tools.map(toWireName), 'No tools: it only answers.')}>
      <p className="hint">Only those ticked, nor tools added later.</p>
      <ToolsList tools={catalog} disabled={agentDisabledTools({ tools }, names)} onDisabled={(d) => onChange(agentToolsFrom({ tools }, names, d))} />
    </PageSection>
  );
}

// Its memory: what it saves is every agent's (external), or its own (internal). `name`: the radios'.
export function MemoryChoice({ name, memory, onChange }: { name: string; memory: 'internal' | undefined; onChange: (memory: 'internal' | undefined) => void }) {
  return (
    <PageSection page="memory" title="Memory">
      <label className="check">
        <input type="radio" name={name} checked={memory !== 'internal'} onChange={() => onChange(undefined)} />
        External memory: what it saves, every agent sees (unless it names some)
      </label>
      <label className="check">
        <input type="radio" name={name} checked={memory === 'internal'} onChange={() => onChange('internal')} />
        Internal memory: what it saves is its alone (unless it names other agents); it still sees the items for every agent
      </label>
    </PageSection>
  );
}

// Whether it may ask other agents (agents.ask), and be asked by them.
export function AskToggles(props: { canAsk: boolean; canBeAsked: boolean; onCanAsk: (on: boolean) => void; onCanBeAsked: (on: boolean) => void }) {
  return (
    <PageSection page="agents" title="Other agents">
      <label className="check">
        <input type="checkbox" checked={props.canAsk} onChange={(e) => props.onCanAsk(e.target.checked)} /> Can ask: it may ask the agents that can be asked
      </label>
      <label className="check">
        <input type="checkbox" checked={props.canBeAsked} onChange={(e) => props.onCanBeAsked(e.target.checked)} /> Can be asked: agents that can ask may ask it
      </label>
    </PageSection>
  );
}

type GivenItem = { id: string; name: string; about: string };
export const skillItems = (skills: Skill[]): GivenItem[] => skills.map((s) => ({ id: s.id, name: s.name, about: s.description }));
export const templateItems = (templates: PageTemplate[]): GivenItem[] => templates.map((t) => ({ id: t.id, name: t.name, about: t.matches.join(', ') }));

// Skills or site templates to give it, by name, each with what it is.
export function GivenList({ page, title, items, given, none, onChange }: { page: string; title: string; items: GivenItem[]; given: string[]; none: string; onChange: (given: string[]) => void }) {
  return (
    <PageSection page={page} title={title} count={given.length} summary={nameList(given, `No ${title.toLowerCase()}.`)}>
      {items.length ? items.map((i) => (
        <label key={i.id} className="tool-row" title={i.about}>
          <input type="checkbox" checked={given.includes(i.name)}
            onChange={(e) => onChange(e.target.checked ? [...given, i.name].sort() : given.filter((n) => n !== i.name))} />
          <span className="tool-name">{i.name}</span>
          <span className="tool-desc">{i.about}</span>
        </label>
      )) : <p className="hint">{none}</p>}
    </PageSection>
  );
}

// Its sites, each with its policy: the chat opens with it there. It uses every other site with the
// site's policy (Website access), unless it uses only its own. The browser must also allow the
// extension to reach them.
export function AgentSites({ sites, only, onOnly, onChange }: { sites: Record<string, SitePolicy>; only: boolean; onOnly: (only: boolean) => void; onChange: (host: string, policy: SitePolicy | undefined) => void }) {
  const hosts = Object.keys(sites).sort();
  const site = useSiteInput((draft) => {
    try {
      const host = siteHost(draft);
      if (!isHost(host)) throw new Error('not a host');
      onChange(host, sites[host] ?? 'ask');
      return undefined;
    } catch {
      return 'Not a valid site';
    }
  });
  return (
    <div className="custom-params">
      <div className="field-label">Its sites ({hosts.length}): the chat opens with it on them, and it uses its policy there</div>
      <label className="check">
        <input type="checkbox" checked={only} onChange={(e) => onOnly(e.target.checked)} /> Only its sites: it uses no other, not even to read the page you are on
      </label>
      {hosts.map((host) => (
        <div key={host} className="row">
          <span className="host-name">{host}</span>
          <PolicySelect label={`Policy on ${host}`} value={sites[host]} onChange={(p) => onChange(host, p)} />
          {isHost(host) && <MissingAccess origins={[originPattern(`https://${host}`)]} name={host} />}
          <button className="icon-button warn" aria-label={`Remove ${host}`} title="Remove" onClick={() => onChange(host, undefined)}>✕</button>
        </div>
      ))}
      <SiteInput site={site} placeholder="Add a site… e.g. jira.example.com" label="Add a site" />
    </div>
  );
}
