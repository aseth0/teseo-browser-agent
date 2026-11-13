// Memory (memory/store): Settings → Memory edits it all; the side panel's memory button lists it with
// pin and delete only. Pinning is the same in both: a pinned item goes whole with every request (with
// its sites, while one is open).
// Deleting is confirmed inside the page (a side panel shows no confirm()).
import { useMemo, useState } from 'react';
import { agentNameById, agentStore, type AgentProfile } from '../agents/profiles';
import { DEFAULT_AGENT_ID, DEFAULT_AGENT_NAME } from '../agents/builtins';
import { exportMemory, importMemory } from '../memory/io';
import { MAX_TITLE, memoryFor, memoryLabel, memoryStore, memoryTitle, newMemoryItem, onDomain, type MemoryItem } from '../memory/store';
import { domainsFrom, MEMORY_AUTO_DEFAULTS, memoryMatches, memoryProblems, searchMemory, withMeaning, type MeaningMatch } from '../memory/items';
import { MEANING_FAILED_NOTICE } from '../memory/query-meaning';
import { indexable, semanticTarget } from '../memory/semantic';
import { memoryBudget, memoryPicks } from '../memory/prompt';
import { AttachPlayground, AutoAttachCard, MATCH_LEVELS, PLAYGROUND_RESULTS, StepsCheck } from './AutoAttachBlock';
import { MeaningCard, SemanticSearchBlock } from './SemanticSearchBlock';
import { FilterChips, MatchCard, MatchCards, OfLimit, SectionHead, SectionTabs, StatStrip, ToneChip, TryBelow, type ChipTone } from './SectionParts';
import { limitFrom } from '../core/limits';
import { previewMeaning, rememberedMeaning } from './usePreviewMeaning';
import { Snippet } from './Snippet';
import type { Settings } from '../storage/settings';
import { memoryOn, withAutoAttach } from '../storage/settings-select';
import { autoInjectGlobal } from '../context/auto-inject';
import type { StepAttach } from '../storage/settings-types';
import { BackToList, ByModelBadge, CollectionTable, EditorFooter, EmptyCollection, NoSuchItem } from './Collection';
import { useAttempt } from './useAttempt';
import { useCollectionScreen } from './useCollectionScreen';
import { CollectionIO } from './collection/CollectionIO';
import { tableSelect, useSelection } from './collection/selection';
import { useCollection } from './useCollection';
import { InlineConfirm } from './InlineConfirm';
import { PageModelTexts } from './PageModelTexts';
import { Pin, Trash2 } from 'lucide';
import { LucideIcon } from './LucideIcon';
import type { SectionProps as Props, SettingsPatch } from './useSettings';
import { SectionTop } from './SectionTop';

export const useMemory = () => useCollection(memoryStore);

const agentName = (agents: AgentProfile[], id: string) => agentNameById(agents, id) ?? 'an agent no longer here';

// How one linked to sites goes while one is open. `matching`: only those that match go whole
// (Settings → Auto-inject).
const onItsSites = (m: MemoryItem, matching: boolean) =>
  m.pinned || !matching ? `whole on ${m.domains.join(', ')}` : `on ${m.domains.join(', ')}: whole if your message matches, else by its title`;

// Where it goes, in a few words: pinned, its sites, its agents.
export function memoryScope(m: MemoryItem, agents: AgentProfile[], matching: boolean): string {
  return [
    m.pinned ? (m.domains.length ? 'pinned' : 'pinned: every request') : '',
    m.domains.length ? onItsSites(m, matching) : m.pinned ? '' : 'every site, by its title',
    m.agents.length ? `for ${m.agents.map((id) => agentName(agents, id)).join(', ')}` : '',
  ].filter(Boolean).join(' · ');
}

// The ones that go with the next message first, whole or by title (for that agent and site), then the
// rest; latest first.
export function memoryOrder(items: MemoryItem[], agentId: string | undefined, host: string | undefined): MemoryItem[] {
  const now = new Set(memoryFor(items, agentId).filter((m) => (m.pinned && !m.domains.length) || onDomain(m, host)).map((m) => m.id));
  return [...items].sort((a, b) => Number(now.has(b.id)) - Number(now.has(a.id)) || b.updatedAt - a.updatedAt);
}

// Pin and delete (asked first), as both lists show them, and why the last one failed.
export function MemoryActions({ item }: { item: MemoryItem }) {
  const title = memoryLabel(item);
  const { failed, attempt } = useAttempt();
  return (
    <InlineConfirm label={`Confirm: delete ${title}`} onConfirm={() => attempt(memoryStore.remove(item.id))}>
      {(ask) => (
        <span className="memory-actions">
          {failed && <span className="error-text" role="alert">{failed}</span>}
          <button className="icon-button" aria-pressed={item.pinned} aria-label={`${item.pinned ? 'Unpin' : 'Pin'} ${title}`}
            title={item.pinned ? 'Pinned: goes whole with every request (with its sites: while one is open). Click to unpin' : 'Pin: it goes whole with every request (with its sites: while one is open), not only its title'}
            onClick={() => attempt(memoryStore.update(item.id, { pinned: !item.pinned }))}><LucideIcon node={Pin} size={14} /></button>
          <button className="icon-button warn" title="Delete" aria-label={`Delete ${title}`} onClick={ask}><LucideIcon node={Trash2} size={14} /></button>
        </span>
      )}
    </InlineConfirm>
  );
}

// How an item reaches the model, as its chip in Settings → Memory says. `matching`: only those that
// match go whole on their site (Settings → Auto-inject).
type MemoryReach = 'always' | 'site' | 'match' | 'title';
const memoryReach = (m: MemoryItem, matching: boolean): MemoryReach =>
  m.domains.length ? (m.pinned || !matching ? 'site' : 'match') : m.pinned ? 'always' : 'title';

const REACH: Record<MemoryReach, { label: string; tone: ChipTone; about: string }> = {
  always: { label: '📌 Always', tone: 'always', about: 'Whole with every request' },
  site: { label: '◉ On its sites', tone: 'site', about: 'Whole while one of its sites is open' },
  match: { label: '◎ Site, if it matches', tone: 'match', about: 'While one of its sites is open: whole if your message matches it, else by its title' },
  title: { label: '≡ By title', tone: 'title', about: 'One line in the index, its title: the model reads it when it needs it' },
};
const REACH_ORDER: MemoryReach[] = ['always', 'site', 'match', 'title'];

// Under its title in the list: its sites and its agents.
const whereFor = (m: MemoryItem, agents: AgentProfile[]) =>
  [m.domains.length ? m.domains.join(', ') : 'Every site', m.agents.length ? `for ${m.agents.map((id) => agentName(agents, id)).join(', ')}` : ''].filter(Boolean).join(' · ');

export function MemorySection({ settings, onChange }: Props) {
  const { items, loaded, target, editing, missing, open, close } = useCollectionScreen(memoryStore, { route: 'memory', fresh: newMemoryItem });
  const agents = useCollection(agentStore);
  const [query, setQuery] = useState('');
  const [reach, setReach] = useState<MemoryReach | 'all'>('all');
  const on = memoryOn(settings);
  const matching = autoInjectGlobal(settings, 'memorySiteMatch');
  const searched = useMemo(() => (query.trim() ? searchMemory(items, query, { prefix: true }) : [...items].sort((a, b) => b.updatedAt - a.updatedAt)), [items, query]);
  const shown = reach === 'all' ? searched : searched.filter((m) => memoryReach(m, matching) === reach);

  const selection = useSelection(items.map((m) => m.id));
  if (editing) return <MemoryEditor key={editing.id} item={editing} items={items} agents={agents} onClose={close} />;
  if (missing) return <NoSuchItem route="memory" noun="memory item" target={target} />;
  if (target) return null; // still loading
  const budget = memoryBudget(items);
  const pinnedMax = limitFrom('pinnedMemory', settings.limits?.pinnedMemory);
  const indexMax = limitFrom('memory', settings.limits?.memory);
  const off = items.filter((m) => !m.enabled).length;
  const byModel = items.filter((m) => m.source === 'model').length;
  const itemsTab = (
    <>
      <CollectionIO noun={['memory item', 'memory items']} label="Memory" fileName="memory.json" items={items} shown={shown} id={(m) => m.id}
        exportJson={(chosen) => exportMemory(chosen, agents)} read={(json) => importMemory(json, items, agents)} save={(chosen) => memoryStore.saveMany(chosen)}
        selection={selection} placeholder={'{ "memory": [ { "text": "Answer in English.", "pinned": true } ] }'}>
        <input className="grow" type="search" value={query} placeholder='Search memory… ("a phrase" in quotes)' aria-label="Search memory" onChange={(e) => setQuery(e.target.value)} />
        <button onClick={() => open('new')}>＋ New item</button>
      </CollectionIO>
      <FilterChips label="Show the items that go" value={reach} onChange={setReach} total={searched.length}
        filters={REACH_ORDER.map((r) => ({ id: r, label: REACH[r].label, tone: REACH[r].tone, title: REACH[r].about, count: searched.filter((m) => memoryReach(m, matching) === r).length }))} />
      <CollectionTable className="memory-table" rows={shown} rowKey={(m) => m.id} name={(m) => memoryLabel(m)} nameHead="Item" select={tableSelect(selection)}
        onOpen={(m) => () => open(m.id)} linkTitle={(m) => m.text}
        onTitle="Switched on: it reaches the model" isOn={(m) => m.enabled} onToggle={(m, on) => memoryStore.update(m.id, { enabled: on })}
        tags={(m) => {
          const r = REACH[memoryReach(m, matching)];
          return <><ToneChip tone={r.tone} title={r.about}>{r.label}</ToneChip><ByModelBadge by={m.source} /></>;
        }}
        description={(m) => whereFor(m, agents)}
        after={[{ head: '', className: 'switch', cell: (m) => <MemoryActions item={m} /> }]} />
      <EmptyCollection shown={shown.length} total={items.length} one="item" many="memory" none="No memory yet: add one, or ask the model to remember something." loaded={loaded} />
      <p className="hint reach-legend">{REACH_ORDER.map((r) => `${REACH[r].label}: ${REACH[r].about.toLowerCase()}.`).join(' ')}</p>
      {items.length > 0 && <p className="hint">The export holds whatever you or the model wrote in memory, personal details too: keep the file private.</p>}
    </>
  );
  return (
    <section className="memory-settings">
      <SectionHead title="Memory" about="Rules and facts the model keeps across conversations. It saves or deletes one only once you approve it."
        toggle={{ label: 'Use memory', on, title: 'Off: neither the items nor the memory tools reach the model. Your items stay.', onChange: (enabled) => onChange({ memory: { ...settings.memory, enabled } }) }} />
      <StatStrip stats={[
        { label: 'Items', value: items.length, sub: `${off} switched off · ${byModel} saved by the model` },
        { label: 'Pinned, with every request', value: <OfLimit used={budget.pinned} max={pinnedMax} unit="characters" />, meter: { used: budget.pinned, max: pinnedMax } },
        { label: 'Index of titles', value: <OfLimit used={budget.index} max={indexMax} unit="characters" />, meter: { used: budget.index, max: indexMax }, sub: 'Past it, the rest is left out; the model\'s search still finds them' },
      ]} />
      <SectionTabs label="Memory" tabs={[
        { id: 'items', label: 'Items', render: () => itemsTab },
        { id: 'matching', label: 'Matching', render: () => <><MemoryMatching settings={settings} onChange={onChange} /><TryBelow><MemoryTry settings={settings} items={items} agents={agents} /></TryBelow></> },
        { id: 'semantic', label: 'Semantic search', render: () => <SemanticSearchBlock settings={settings} onChange={onChange} /> },
        { id: 'limits', label: 'Limits and texts', render: () => <><SectionTop page="memory" /><PageModelTexts page="memory" /></> },
      ]} />
    </section>
  );
}

// The least match a result of memory__search needs (BM25: how much of the query an item covers, the
// rare words weighing more), from 0 (any item with a word of the query) to 1. Stored in %.
const THRESHOLD_PRESETS: [string, number][] = MATCH_LEVELS.map((l) => [l.name, l.value / 100]);
// As the other matches show (Auto-attach, the playground): a whole percent.
const pctOf = (v: number) => `${Math.round(v * 100)}%`;
const presetOf = (v: number) => (v === 0 ? 'Off' : (THRESHOLD_PRESETS.find(([, p]) => Math.abs(p - v) < 0.001)?.[0] ?? 'Custom'));
const minMatchOf = (settings: Settings) => (settings.memory?.minMatch ?? 0) / 100;
const setMinMatch = (settings: Settings, onChange: SettingsPatch, v: number) =>
  onChange({ memory: { ...settings.memory, minMatch: Math.round(v * 100) || undefined } });

// Settings → Memory → Matching: the three matches needed side by side, each on a card: what auto-attach
// needs of your message, what meaning needs (semantic search), and what the model's own search needs.
function MemoryMatching({ settings, onChange }: Props) {
  const auto = settings.memory?.autoAttach ?? {};
  const setAuto = (change: Partial<StepAttach>) => onChange(withAutoAttach(settings, 'memory', change));
  const least = minMatchOf(settings);
  const setLeast = (v: number) => setMinMatch(settings, onChange, Math.min(1, Math.max(0, v)));
  return (
    <>
      <MatchCards>
        <AutoAttachCard auto={auto} defaults={MEMORY_AUTO_DEFAULTS} onChange={setAuto} label="Attach the items your message matches well enough on their own" rangeLabel="Memory match needed"
          about="Your message → the items neither pinned nor linked to a site"
          after={<StepsCheck on={auto.steps ?? false} off={!auto.enabled} onChange={(steps) => setAuto({ steps })} />} />
        <MeaningCard settings={settings} onChange={onChange} />
        <MatchCard title="Model's search" about="The least match the results of memory__search need" value={least ? pctOf(least) : 'Off'} off={!least}>
          <input type="range" min={0} max={1} step={0.05} value={least} aria-label="memory__search minimum match"
            aria-valuetext={`${pctOf(least)}, ${presetOf(least)}`} onChange={(e) => setLeast(Number(e.target.value))} />
          <div className="match-bands" role="group" aria-label="Model's search levels">
            {([['Off', 0], ...THRESHOLD_PRESETS] as [string, number][]).map(([name, v]) => (
              <button key={name} type="button" className={presetOf(least) === name ? 'on' : undefined} onClick={() => setLeast(v)}>{name}</button>
            ))}
          </div>
          <p className="hint">Off: any item with one of the query's words. Raise it when its searches bring back too much that does not fit.</p>
        </MatchCard>
      </MatchCards>
      <p className="hint">
        The auto-attach match also decides which items of the open site go whole, even with it off (Settings → Auto-inject → Only those that match).
        Under your message, a small memory pill says how many went (a click lists them).
      </p>
    </>
  );
}

// Settings → Memory → Matching, under the cards (memory/prompt memoryAutoPicks): a message tried against an agent's memory,
// with what would go with it and how each item reaches the model otherwise.
function MemoryTry({ settings, items, agents }: Pick<Props, 'settings'> & { items: MemoryItem[]; agents: AgentProfile[] }) {
  const auto = settings.memory?.autoAttach ?? {};
  const minMatch = settings.memory?.minMatch ?? 0;
  const matching = autoInjectGlobal(settings, 'memorySiteMatch');
  const [agentId, setAgentId] = useState(DEFAULT_AGENT_ID);
  const theirs = memoryFor(items, agentId);
  // Searched again when the items, the agent or the model's search minimum change (one value, the same
  // between renders).
  const target = semanticTarget(settings);
  const refresh = useMemo(() => [items, agentId, minMatch, target?.threshold, target?.model, target?.provider.id], [items, agentId, minMatch, target?.threshold, target?.model, target?.provider.id]);
  const candidates = theirs.filter(indexable);
  // What the chat would do with it (memory/prompt): by words at once, with meaning once it is known.
  const resultsWith = (query: string, meaning: MeaningMatch | undefined) => {
    const ranked = withMeaning(memoryMatches(theirs, query), theirs, meaning);
    return {
      picked: memoryPicks(ranked, [], auto, meaning).map((r) => r.item.id),
      hits: ranked.slice(0, PLAYGROUND_RESULTS).map(({ item, match, meaning: closeness }) => {
        const r = REACH[memoryReach(item, matching)];
        return {
          meaning: closeness,
          id: item.id,
          match,
          never: item.domains.length ? 'linked to a site' : item.pinned ? 'pinned' : undefined,
          title: memoryLabel(item),
          badges: (
            <>
              <ToneChip tone={r.tone} title={r.about}>{r.label}</ToneChip>
              {match * 100 < minMatch && <span className="badge warn" title={`memory__search needs ${minMatch}% (Model's search, above)`}>below {minMatch}%: the model's search leaves it out</span>}
            </>
          ),
          detail: <Snippet text={item.text} query={query} prefix={false} cut={false} />,
        };
      }),
    };
  };
  const search = async (query: string) => resultsWith(query, rememberedMeaning(settings, query, candidates));
  const refine = async (query: string) => {
    const { meaning, failed } = await previewMeaning(settings, query, candidates);
    return { ...resultsWith(query, meaning), note: failed ? MEANING_FAILED_NOTICE : undefined };
  };
  return (
    <AttachPlayground auto={auto} defaults={MEMORY_AUTO_DEFAULTS} search={search} refresh={refresh}
      meaningThreshold={target?.threshold} refine={target ? refine : undefined}
      nouns={['memory item', 'memory items']} searchLabel="Try a memory search"
      searchExtra={
        <label className="inline-label">For
          <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            {[{ id: DEFAULT_AGENT_ID, name: DEFAULT_AGENT_NAME }, ...agents].map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      }
      hint="A message as you would send it, for an agent: how well each of its items matches, against the cards above, and which would go with it on their own." />
  );
}

function MemoryEditor({ item, items, agents, onClose }: { item: MemoryItem; items: MemoryItem[]; agents: AgentProfile[]; onClose: () => void }) {
  const [draft, setDraft] = useState(item);
  const [domains, setDomains] = useState(item.domains.join(', '));
  const patch = (change: Partial<MemoryItem>) => setDraft((d) => ({ ...d, ...change }));
  const isNew = !items.some((m) => m.id === item.id);
  const current = { ...draft, title: draft.title?.trim() || undefined, text: draft.text.trim(), domains: domainsFrom(domains.split(/[\s,]+/)) };
  const problems = memoryProblems(current);
  const choices = [{ id: DEFAULT_AGENT_ID, name: DEFAULT_AGENT_NAME }, ...agents];
  const toggleAgent = (id: string, on: boolean) => patch({ agents: on ? [...draft.agents, id] : draft.agents.filter((a) => a !== id) });
  return (
    <section className="editor">
      <BackToList route="memory" title="Memory" />
      <h3>{isNew ? 'New memory item' : `Edit ${item.id}`}</h3>
      <label>Title (what the model sees in the index and searches; empty: the text's first line)
        <input value={draft.title ?? ''} maxLength={MAX_TITLE} placeholder={memoryTitle(draft.text)} autoFocus onChange={(e) => patch({ title: e.target.value })} />
      </label>
      <label>Text (one rule or fact)
        <textarea rows={6} value={draft.text} onChange={(e) => patch({ text: e.target.value })} />
      </label>
      <label className="check">
        <input type="checkbox" checked={draft.pinned} onChange={(e) => patch({ pinned: e.target.checked })} />
        Pinned: it goes whole with every request (with sites: while one is open), not only its title
      </label>
      <label>Sites (hosts, comma-separated, their subdomains too; while one is open it goes whole if pinned or if your message matches it, else by its title; empty: every site)
        <input value={domains} placeholder="example.com, docs.example.org" onChange={(e) => setDomains(e.target.value)} />
      </label>
      <fieldset>
        <legend>Agents (none checked: every agent)</legend>
        {choices.map((a) => (
          <label key={a.id} className="check">
            <input type="checkbox" checked={draft.agents.includes(a.id)} onChange={(e) => toggleAgent(a.id, e.target.checked)} />
            {a.name}
          </label>
        ))}
      </fieldset>
      {!isNew && <p className="muted small">{item.source === 'model' ? 'Saved by the model after you approved it' : 'Written by you'} · created {new Date(item.createdAt).toLocaleString()} · edited {new Date(item.updatedAt).toLocaleString()}</p>}
      <EditorFooter problems={problems} isNew={isNew}
        onSave={() => memoryStore.save({ ...current, updatedAt: Date.now() }).then(onClose)}
        onDelete={() => memoryStore.remove(item.id)} onClose={onClose} />
    </section>
  );
}
