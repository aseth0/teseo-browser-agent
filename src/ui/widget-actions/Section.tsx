// Settings → Actions: the page widget's actions (widget/actions). Each is a button in a box on the
// pages it matches, which runs a tool that reads and shows the answer, cut into boxes; with a
// prompt, the model answers (with the tool's answer, if any).
import { actionOwner, newAction, type WidgetAction } from '../../widget/actions';
import { agentLabel, agentStore, type AgentProfile } from '../../agents/profiles';
import { exportActions, importActions } from '../../widget/io';
import { CollectionIO } from '../collection/CollectionIO';
import { tableSelect, useSelection } from '../collection/selection';
import { actionStore } from '../../widget/store';
import { useToolCatalog } from '../Tools';
import { useCollection } from '../useCollection';
import { ByModelBadge, CollectionTable, EmptyCollection, FilterBox, NoSuchItem, useFilter } from '../Collection';
import { useCollectionScreen } from '../useCollectionScreen';
import { ActionEditor } from './Editor';
import { PageModelTexts } from '../PageModelTexts';
import { SectionTop } from '../SectionTop';
import { GoTo } from '../text-pages';
import { useSettingsContext } from '../settings-context';
import { SectionHead, SectionTabs, StatStrip } from '../SectionParts';

export function ActionsSection() {
  const { settings } = useSettingsContext();
  const { items: actions, loaded, target, editing, missing, open, close } = useCollectionScreen(actionStore, { route: 'actions', fresh: newAction });
  const catalog = useToolCatalog();
  const agents = useCollection(agentStore);

  const { filter, setFilter, matches } = useFilter();
  const shown = actions.filter((a) => matches([a.name, a.tool, ...a.where]));
  const selection = useSelection(actions.map((a) => a.id));
  const where = (a: WidgetAction) => (a.where.length ? a.where.join(', ') : a.agent ? "Its agent's sites granted one by one" : 'Every site granted one by one');

  if (editing) return <ActionEditor key={editing.id} action={editing} actions={actions} catalog={catalog} agents={agents} settings={settings} onClose={close} />;
  if (missing) return <NoSuchItem route="actions" noun="action" target={target} />;
  if (target) return null; // still loading
  const missingTool = (a: WidgetAction) => !!a.tool && !catalog.some((t) => t.name === a.tool);
  const list = (
    <>
      {/* They come in off, replacing those of the same name. */}
      <CollectionIO noun={['action', 'actions']} label="Actions" fileName="actions.json" items={actions} shown={shown} id={(a) => a.id}
        exportJson={(items) => exportActions(items, agents)} read={(json) => importActions(json, actions, agents, settings.providers.map((p) => p.id))}
        save={(items) => actionStore.saveMany(items)} then="check them and switch them on" selection={selection}
        placeholder={'{ "actions": [ { "name": "Search Wikipedia", "tool": "wiki.search", … } ] }'}>
        <FilterBox label="Filter actions" value={filter} onChange={setFilter} />
        <button className="primary" onClick={() => open('new')}>＋ New action</button>
      </CollectionIO>
      <CollectionTable rows={shown} rowKey={(a) => a.id} name={(a) => a.name} link={(a) => `${a.icon ? `${a.icon} ` : ''}${a.name}`} nameHead="Action" select={tableSelect(selection)}
        onOpen={(a) => () => open(a.id)} onTitle="Shown in the page widget" isOn={(a) => a.enabled} onToggle={(a, on) => actionStore.update(a.id, { enabled: on })}
        tags={(a) => <>
          {a.tool && <span className="badge">{a.tool}</span>}
          {a.openChat ? <span className="badge" title="It opens the chat with its message">opens the chat</span>
            : a.prompt?.trim() && <span className="badge" title="The model answers">{a.model ?? 'model'}</span>}
          {a.when === 'load' && <span className="badge" title="It runs when the page loads (not on a site where the bubble is hidden)">on load</span>}
          <OwnerBadge action={a} agents={agents} />
          <ByModelBadge by={a.createdBy} />
          {missingTool(a) && <span className="badge accent" title="Not run while the tool is not available">tool missing</span>}
        </>}
        columns={[{ head: 'Shows up on', className: 'muted', cell: (a) => <span className="row-desc" title={where(a)}>{where(a)}</span> }]} />
      <EmptyCollection shown={shown.length} total={actions.length} one="action" many="actions" loaded={loaded} />
      <p className="hint">Where the widget shows, its bubble and where it opens the chat: <GoTo hash="bubble" title="Bubble" /></p>
    </>
  );
  const on = actions.filter((a) => a.enabled);
  return (
    <section className="actions-settings">
      <SectionHead title="Actions" about={<>
        Buttons in a small box (the page widget) on the pages you choose. Each runs a tool, with the text you type or select, and shows its answer
        there; with a prompt, the model answers too, only when you click. A tool that changes things asks you in the card first, as Website access
        says.
      </>} />
      <StatStrip stats={[
        { label: 'Actions', value: <>{actions.length} <span className="stat-of">· {on.length} on</span></>, sub: `${actions.filter((a) => a.agent).length} of other agents` },
        { label: 'On page load', value: actions.filter((a) => a.when === 'load').length, sub: 'The others on a click' },
        { label: 'With the model', value: actions.filter((a) => a.prompt?.trim() && !a.openChat).length, sub: `${actions.filter((a) => a.openChat).length} open the chat` },
        { label: 'Tool missing', value: actions.filter(missingTool).length, sub: 'Not run until it is back' },
      ]} />
      <SectionTabs label="Actions" tabs={[
        { id: 'list', label: 'Actions', render: () => list },
        { id: 'texts', label: 'Texts', render: () => <PageModelTexts page="actions" /> },
        { id: 'limits', label: 'Limits', render: () => <SectionTop page="actions" /> },
      ]} />
    </section>
  );
}

// The agent an action belongs to, when it is not Browser; flagged when that agent is off or gone.
function OwnerBadge({ action, agents }: { action: WidgetAction; agents: AgentProfile[] }) {
  if (!action.agent) return null;
  const owner = actionOwner(action, agents);
  const known = agents.find((a) => a.id === action.agent);
  if (owner) return <span className="badge" title="It runs with this agent's tools, on its sites">{agentLabel(owner)}</span>;
  return <span className="badge accent" title="Not shown while its agent is switched off or gone">{known ? `${agentLabel(known)} (off)` : 'agent gone'}</span>;
}
