// Settings → Agents: agents the chat can talk to (agents/profiles), each with its own instructions
// and model, and only the tools, skills and sites given here.
import { useState } from 'react';
import { agentLabel, agentOffers, browserAgentLabel, movedAgent, orderedAgentIds, agentStore, newAgentProfile } from '../../agents/profiles';
import { builderOn } from '../../agents/builder';
import { DEFAULT_AGENT_ID, DEFAULT_AGENT_NAME, EMPTY_AGENT } from '../../agents/builtins';
import type { Settings } from '../../storage/settings';
import { useSitePolicies } from '../useSitePolicies';
import { exportAgents, importAgents } from '../../agents/io';
import { CollectionIO } from '../collection/CollectionIO';
import { tableSelect, useSelection } from '../collection/selection';
import { useToolCatalog } from '../Tools';
import { CollectionTable, EmptyCollection, FilterBox, NoSuchItem, Switch, useFilter } from '../Collection';
import { DragRow } from '../DragRow';
import { useAttempt } from '../useAttempt';
import { useCollectionScreen } from '../useCollectionScreen';
import { PageModelTexts } from '../PageModelTexts';
import { plural } from '../../core/util';
import type { SettingsUpdate } from '../useSettings';
import { AgentEditor } from './AgentEditor';
import { BrowserEditor } from './BrowserEditor';

export interface AgentsProps {
  settings: Settings;
  onChange: SettingsUpdate;
}

export function AgentsSection(props: AgentsProps) {
  const { items: agents, loaded, target, editing, missing, open, close } = useCollectionScreen(agentStore, { route: 'agents', fresh: newAgentProfile });
  // The rows' order, dragged by their handle (or moved with the arrow keys on it): the chat's agent menu follows it.
  const order = orderedAgentIds(agents, props.settings.agentOrder);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const { failed, attempt } = useAttempt(); // the Can ask and Can be asked switches'
  // Browser's tags: the tools it is offered (switched on in Tools; the creating ones are Builder's while
  // it is on), and how many sites have a policy of their own.
  const catalog = useToolCatalog();
  const browserTools = agentOffers(undefined, catalog, agents).filter((t) => !props.settings.disabledTools?.includes(t.name)).length;
  const browserSites = Object.keys(useSitePolicies()[0]).length;
  const move = (from: number, to: number) => props.onChange({ agentOrder: movedAgent(order, from, to) });
  const { filter, setFilter, matches } = useFilter();
  // Browser and EmptyAgent are rows of their own, always on.
  const agentOf = (id: string) => agents.find((x) => x.id === id);
  const fixed = (id: string) => id === DEFAULT_AGENT_ID || id === EMPTY_AGENT.id;
  const nameOf = (id: string) => (id === DEFAULT_AGENT_ID ? DEFAULT_AGENT_NAME : id === EMPTY_AGENT.id ? EMPTY_AGENT.name : agentOf(id)?.name ?? id);
  const descriptionOf = (id: string) =>
    id === DEFAULT_AGENT_ID ? `${props.settings.browserAgent?.description?.trim() || 'The chat as always: Tools, Skills and Website access'}${builderOn(agents) ? "; the tools that create things are Builder's while it is on" : ''}`
    : id === EMPTY_AGENT.id ? EMPTY_AGENT.description
    : agentOf(id)?.description ?? '';
  const rows = order.filter((id) => (fixed(id) || agentOf(id)) && matches([nameOf(id), descriptionOf(id)]));
  const selection = useSelection(agents.map((a) => a.id));
  if (target === DEFAULT_AGENT_ID) return <BrowserEditor {...props} onClose={close} />;
  if (editing) return <AgentEditor key={editing.id} {...props} agent={editing} agents={agents} onClose={close} />;
  if (missing) return <NoSuchItem route="agents" noun="agent" target={target} />;
  if (target) return null; // still loading
  return (
    <section>
      <h3>Agents</h3>
      <p className="hint">
        Agents you talk to in the chat (choose one next to the model). Each gets only what you give it here: its tools, its skills
        and its sites, so a page that tries to steer it can reach nothing else. <strong>Browser</strong> is the chat as always: every
        tool switched on in Tools, the skills switched on in Skills, the sites in Website access. <strong>EmptyAgent</strong> gets only
        your system prompt.
      </p>
      <PageModelTexts page="agents" />
      {/* They come in off, replacing those of the same name. */}
      <CollectionIO noun={['agent', 'agents']} label="Agents" fileName="agents.json" items={agents} shown={rows.flatMap((id) => agentOf(id) ?? [])} id={(a) => a.id}
        exportJson={exportAgents} read={(json) => importAgents(json, agents)} save={(items) => agentStore.saveMany(items)}
        then="check their tools and sites and switch them on" selection={selection}
        placeholder={'{ "agents": [ { "name": "jira", "tools": [ … ], "sites": { … } } ] }'}>
        <FilterBox label="Filter agents" value={filter} onChange={setFilter} />
        <button onClick={() => open('new')}>＋ New agent</button>
      </CollectionIO>
      <CollectionTable className="agents-table" rows={rows} rowKey={(id) => id} name={nameOf} nameHead="Agent"
        select={tableSelect(selection, (id: string) => (fixed(id) ? 'Comes with the extension' : undefined))}
        link={(id) => (id === DEFAULT_AGENT_ID ? browserAgentLabel(props.settings) : agentLabel(id === EMPTY_AGENT.id ? EMPTY_AGENT : agentOf(id)!))}
        onOpen={(id) => (id === EMPTY_AGENT.id ? undefined : () => open(id))}
        onTitle="Offered in the chat" isOn={(id) => fixed(id) || !!agentOf(id)?.enabled} fixed={(id) => (fixed(id) ? 'Always offered in the chat' : undefined)}
        onToggle={(id, on) => agentStore.update(id, { enabled: on })}
        tags={(id) => {
          if (id === DEFAULT_AGENT_ID) return <>
            <span className="badge" title="Switched on in Tools">{plural(browserTools, 'tool')}</span>
            <span className="badge" title={`Every site, with its policy in Site policies (${browserSites} set)`}>every site</span>
          </>;
          if (id === EMPTY_AGENT.id) return <><span className="badge">0 tools</span><span className="badge">0 sites</span></>;
          const a = agentOf(id)!;
          return <>
            <span className="badge">{plural(a.tools.length, 'tool')}</span>
            <span className="badge">{plural(Object.keys(a.sites).length, 'site')}{a.onlyItsSites ? ', only those' : ''}</span>
            {a.model && <span className="badge" title="Its own model">{a.model}</span>}
          </>;
        }}
        description={descriptionOf} descriptionTitle={(id) => agentOf(id)?.description}
        after={[
          { head: 'Can ask', className: 'switch', title: 'It may ask the agents that can be asked (agents.ask)', cell: (id) => {
            if (id === DEFAULT_AGENT_ID) return <Switch label="Browser can ask" checked={!!props.settings.defaultCanAsk} onChange={(on) => props.onChange({ defaultCanAsk: on || undefined })} />;
            const a = agentOf(id);
            return a && <Switch label={`${a.name} can ask`} checked={a.canAsk} onChange={(on) => attempt(agentStore.update(a.id, { canAsk: on }))} />;
          } },
          { head: 'Can be asked', className: 'switch', title: 'Agents that can ask may ask it', cell: (id) => {
            if (id === DEFAULT_AGENT_ID) return <Switch label="Browser can be asked" checked={!!props.settings.browserAgent?.canBeAsked} onChange={(on) => props.onChange({ browserAgent: { ...props.settings.browserAgent, canBeAsked: on || undefined } })} />;
            const a = agentOf(id);
            return a && <Switch label={`${a.name} can be asked`} checked={a.canBeAsked} onChange={(on) => attempt(agentStore.update(a.id, { canBeAsked: on }))} />;
          } },
        ]}
        lead={{ head: null, className: 'drag-col', label: 'Order' }}
        row={(id, _i, cells) => {
          const index = order.indexOf(id);
          const className = fixed(id) ? 'default-agent' : agentOf(id)?.enabled ? undefined : 'off';
          return <DragRow index={index} last={order.length - 1} name={nameOf(id)} className={className} dragging={dragging} over={over} onDrag={setDragging} onOver={setOver} onMove={move}>{cells}</DragRow>;
        }} />
      {failed && <p className="error-text" role="alert">{failed}</p>}
      <EmptyCollection shown={rows.length} total={order.length} one="agent" many="agents" loaded={loaded} />
    </section>
  );
}
