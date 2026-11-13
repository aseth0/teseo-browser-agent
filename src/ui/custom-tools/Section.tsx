// Settings → Custom tools: a tool of the catalog offered again with your name and description, some
// of its parameters set here and the rest filled by the model, an HTTP request, or a script for an API
// that takes several requests (tools/custom/runtime).
import { useState } from 'react';
import { hostOf, plural } from '../../core/util';
import { newCustomTool, VALUE, type CustomTool } from '../../tools/custom/types';
import { exportCustomTools, importCustomTools } from '../../tools/custom/io';
import { customToolStore } from '../../tools/custom/store';
import { customToolSourceStore } from '../../tools/custom/sources';
import { KINDS, kindsOf, labelColor, matches } from '../../tools/labels';
import { CollectionTable, EmptyCollection, FilterBox, NoSuchItem, useFilter } from '../Collection';
import { useCollectionScreen } from '../useCollectionScreen';
import { CustomToolSources } from '../CustomToolSources';
import { customToolSourcesAvailable } from '../../core/build';
import { FeatureNote } from '../FeatureNotice';
import { CollectionIO } from '../collection/CollectionIO';
import { tableSelect, useSelection } from '../collection/selection';
import { useToolCatalog } from '../Tools';
import { useCollection } from '../useCollection';
import { CustomToolEditor } from './Editor';
import { groupsOf, Label, LabelFilter, useLabelColors } from './Labels';
import { SectionTop } from '../SectionTop';
import { SectionHead, SectionTabs, StatStrip } from '../SectionParts';

export function CustomToolsSection() {
  const { items: customs, loaded, target, editing, missing, open, close } = useCollectionScreen(customToolStore, { route: 'custom-tools', fresh: newCustomTool });
  const sources = useCollection(customToolSourceStore);
  const sourceHost = (id: string) => hostOf(sources.find((s) => s.id === id)?.url) || 'a source';
  const catalog = useToolCatalog();
  const colors = useLabelColors();
  const [picked, setPicked] = useState<{ kinds: string[]; labels: string[] }>({ kinds: [], labels: [] });
  const { filter, setFilter, matches: typed } = useFilter();
  // In their groups, those without one first.
  const groups = groupsOf(customs);
  const shown = customs.filter((c) => matches(c, picked) && typed([c.name, c.description, c.base]))
    .sort((a, b) => groups.indexOf(a.group?.trim() ?? '') - groups.indexOf(b.group?.trim() ?? ''));

  const selection = useSelection(customs.map((c) => c.id));
  const [needs, setNeeds] = useState(false); // only those that need a look
  const [tab, setTab] = useState('tools');

  // The tools come in off, replacing those of the same name.
  const read = (json: string) => {
    const { rows, needSession } = importCustomTools(json, customs, catalog);
    return { rows, notes: needSession.map((n) => `${n} takes a cookie in a header: tick "Send the browser's session for this site" in it (a file never turns it on).`) };
  };

  if (editing) return <CustomToolEditor key={editing.id} custom={editing} customs={customs} catalog={catalog} onClose={close} />;
  if (missing) return <NoSuchItem route="custom-tools" noun="custom tool" target={target} />;
  if (target) return null; // still loading
  const baseMissing = (c: CustomTool) => !c.http && !catalog.some((t) => t.name === c.base);
  const needsLook = (c: CustomTool) => !!c.source?.changed || baseMissing(c);
  const listed = needs ? shown.filter(needsLook) : shown;
  const kinds = (k: string) => customs.filter((c) => kindsOf(c).includes(k)).length;
  const fromSources = customs.filter((c) => c.source);
  const tools = (
    <>
      <CollectionIO noun={['custom tool', 'custom tools']} label="Custom tools" fileName="custom-tools.json" items={customs} shown={listed} id={(c) => c.id}
        exportJson={(items, o) => exportCustomTools(items, !!o.withKeys)} read={read} save={(items) => customToolStore.saveMany(items)}
        then="check them and switch them on" selection={selection} sourceLabel={sourceHost}
        options={[{ key: 'withKeys', label: 'Include header values (API keys)', title: 'Header values hold API keys: left out unless you want them' }]}
        placeholder={'{ "customTools": [ { "name": "forum.search", "base": "web.search", … } ] }'}>
        <FilterBox label="Filter custom tools" value={filter} onChange={setFilter} />
        <button className="primary" onClick={() => open('new')}>＋ New custom tool</button>
      </CollectionIO>
      {customs.length > 1 && (
        <div className="custom-filters">
          <LabelFilter customs={customs} colors={colors} picked={picked} onPick={setPicked} shown={listed.length} />
          {customs.some(needsLook) && (
            <button type="button" className="tone-chip tone-always" aria-pressed={needs} title="Changed by its source, or the tool it runs is missing" onClick={() => setNeeds(!needs)}>
              Needs a look · {customs.filter(needsLook).length}
            </button>
          )}
        </div>
      )}
      <CollectionTable rows={listed} rowKey={(c) => c.id} name={(c) => c.name} nameHead="Tool" onOpen={(c) => () => open(c.id)} select={tableSelect(selection)}
        onTitle="Offered to the model" isOn={(c) => c.enabled}
        onToggle={(c, on) => customToolStore.update(c.id, (now) => ({ ...now, enabled: on, ...(on && now.source?.changed && { source: { ...now.source, changed: undefined } }) }))}
        group={(c) => c.group?.trim() ?? ''} groupTitle={(g) => g || 'No group'}
        tags={(c) => <>
          {kindsOf(c).map((k) => {
            const kind = KINDS.find((x) => x.id === k)!;
            const text = k === 'http' && c.http ? `${c.http.method} request` : k === 'derived' ? `from ${c.base}` : kind.label;
            return <Label key={k} color={kind.color} text={text} />;
          })}
          {(c.labels ?? []).map((l) => <Label key={l} color={labelColor(l, colors)} text={l} own />)}
          {c.source && <Label color="gray" text={`from ${sourceHost(c.source.id)}`} />}
          {c.source?.changed && <span className="badge accent" title="Its source changed its request or code: check it, then switch it on">changed</span>}
          {baseMissing(c) && <span className="badge accent" title="Not offered while the tool it runs is not available">base missing</span>}
        </>}
        description={(c) => c.description} descriptionTitle={(c) => c.description} />
      <EmptyCollection shown={listed.length} total={customs.length} one="custom tool" many="custom tools" loaded={loaded} />
    </>
  );
  return (
    <section className="custom-tools-settings">
      <SectionHead title="Custom tools" about={<>
        Tools of your own: a tool you have with some of its parameters set (<code>forum.search</code>: <code>web.search</code> with the query
        inside <code>{`${VALUE} site:forum.example.com`}</code>), a request to a web API, or a script of several. They run as the tools they are
        made from: the same confirmation and site policy.
      </>} />
      <StatStrip stats={[
        { label: 'Custom tools', value: <>{customs.length} <span className="stat-of">· {customs.filter((c) => c.enabled).length} on</span></>, sub: groups.filter(Boolean).length ? `In ${plural(groups.filter(Boolean).length, 'group')}` : 'No groups' },
        { label: 'Made from a tool', value: kinds('derived'), sub: customs.some(baseMissing) ? `${customs.filter(baseMissing).length} whose tool is missing` : 'Each runs as its tool' },
        { label: 'Requests and scripts', value: kinds('http') + kinds('script'), sub: `${plural(kinds('http'), 'HTTP request')} · ${plural(kinds('script'), 'script')}` },
        { label: 'From sources', value: fromSources.length, sub: fromSources.some((c) => c.source?.changed) ? `${fromSources.filter((c) => c.source?.changed).length} changed: check them` : plural(sources.length, 'source') },
      ]} />
      <SectionTabs label="Custom tools" open={tab} onOpen={setTab} tabs={[
        { id: 'tools', label: 'Tools', render: () => tools },
        { id: 'sources', label: `Sources · ${sources.length}`, render: () => null },
        { id: 'texts', label: 'Limits and texts', render: () => <SectionTop page="custom-tools" /> },
      ]} />
      {/* Mounted in every tab: its sources sync once as this section opens. */}
      {/* A build that leaves sources out (core/build STORE_LEAVES_OUT) says why instead. */}
      <div hidden={tab !== 'sources'}>{customToolSourcesAvailable() ? <CustomToolSources customs={customs} catalog={catalog} /> : <FeatureNote id="customToolSources" />}</div>
    </section>
  );
}
