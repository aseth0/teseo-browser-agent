// Settings → Limits: every size limit on what reaches the model, what happens past it, and the
// ones that can be changed. The chat and Layers mark with ✂ where a message was cut. A section shows
// the ones that apply to it at its top too (SectionTop), with the same fields.
import { useState } from 'react';
import { LIMIT_DEFS, limitFrom, type LimitId } from '../core/limits';
import type { Settings } from '../storage/settings';
import { FilterBox, useFilter } from './Collection';
import { FilterChips, SectionHead, SectionTabs, StatStrip } from './SectionParts';
import { SECTION_TOPS } from './section-tops';
import { GoTo } from './text-pages';
import type { PatchSectionProps as Props } from './useSettings';
import { withKey } from './edits';

const fmt = (n: number) => n.toLocaleString('en-US');
// What a tool returns, so the tool result limit cuts it too (the whole kept for tools__read_more).
const IN_TOOL_RESULT = new Set<LimitId>(['pageText', 'pageTextMax', 'structuredData', 'webmcpResult']);

// The limits by what they cap, one tab each.
const GROUPS = [
  { id: 'message', label: 'With your message', ids: ['pageBudget', 'pageElements', 'selection', 'imagesPerMessage', 'imageSize', 'attachedFile', 'mentions', 'recording', 'tabAudio', 'tabAudioMinutes', 'historyAttach'] },
  { id: 'reads', label: 'What the model reads', ids: ['toolResult', 'readPageElements', 'pageText', 'pageTextMax', 'actionPageText', 'structuredData', 'findInDomMatches', 'screenshotSize', 'webmcpTools', 'webmcpDescription', 'webmcpSchema', 'webmcpResult'] },
  { id: 'memory', label: 'Memory, skills and texts', ids: ['memory', 'pinnedMemory', 'siteMemoryItems', 'aboutUser', 'skillValue', 'skillItems', 'templateOutput', 'renderDepth', 'summaryText'] },
  { id: 'time', label: 'Time and runs', ids: ['waitFor', 'watches', 'watchMinutes', 'panelAgents', 'panelNotices', 'modelFirstByte', 'modelIdle', 'speakText', 'scriptTime', 'scriptSteps', 'scriptStepsTime', 'planReminder', 'planReminderAlways'] },
] as const satisfies readonly { id: string; label: string; ids: readonly LimitId[] }[];
// Every limit is in a group: the typecheck fails on one left out, naming it.
type None<T extends never> = T;
export type LimitsLeftOut = None<Exclude<LimitId, (typeof GROUPS)[number]['ids'][number]>>;

// The sections that show a limit at their top (SectionTop), to go there from it.
const sectionsOf = (id: LimitId) => Object.entries(SECTION_TOPS).filter(([, def]) => def.limits?.includes(id) || def.more?.includes(id)).map(([hash]) => hash);

type Limits = NonNullable<Settings['limits']>;
// A limit as set, and setting it (undefined: back to its default).
export interface LimitEdit {
  id: LimitId;
  set: Limits;
  change: (id: LimitId, value: number | undefined) => void;
}
export const limitChange = (settings: Settings, onChange: Props['onChange']) => (id: LimitId, value: number | undefined) =>
  onChange({ limits: withKey(settings.limits ?? {}, id, value) });

type Shown = 'changed' | 'fixed';

export function LimitsSection({ settings, onChange }: Props) {
  const set = settings.limits ?? {};
  const change = limitChange(settings, onChange);
  const ids = Object.keys(LIMIT_DEFS) as LimitId[];
  const changed = ids.filter((id) => set[id] !== undefined);
  const fixed = ids.filter((id) => !LIMIT_DEFS[id].range);
  const now = (id: LimitId) => <>{fmt(limitFrom(id, set[id]))} <span className="stat-of">{LIMIT_DEFS[id].unit}</span></>;
  return (
    <section className="limits-settings">
      <SectionHead title="Limits" about={<>
        What can reach the model in one part of a request, and what happens past it (✂). Where a message was cut, the chat (✂ on the
        tool call, the template chip, the context meter) and Layers say so; each section shows its own limits at its top too.
      </>} />
      <StatStrip stats={[
        { label: 'Limits', value: ids.length, sub: `${ids.length - fixed.length} can be changed · ${fixed.length} fixed` },
        { label: 'Changed', value: changed.length, sub: changed.length ? changed.slice(0, 2).map((id) => LIMIT_DEFS[id].label).join(', ') + (changed.length > 2 ? '…' : '') : 'All at their default' },
        { label: 'Page block', value: now('pageBudget'), sub: 'With each message' },
        { label: 'Tool result', value: now('toolResult'), sub: 'The rest kept for tools__read_more' },
      ]} />
      <SectionTabs label="Limits" tabs={GROUPS.map((g) => ({
        id: g.id, label: `${g.label} · ${g.ids.length}`, render: () => <LimitCards ids={g.ids} set={set} change={change} />,
      }))} />
    </section>
  );
}

// A tab's limits as cards, with a filter (over every tab while it has text) and chips for the changed and the fixed ones.
function LimitCards({ ids, set, change }: { ids: readonly LimitId[] } & Omit<LimitEdit, 'id'>) {
  const { filter, setFilter, matches } = useFilter();
  const [shown, setShown] = useState<Shown | 'all'>('all');
  const isChanged = (id: LimitId) => set[id] !== undefined;
  const isFixed = (id: LimitId) => !LIMIT_DEFS[id].range;
  const list = (filter ? (Object.keys(LIMIT_DEFS) as LimitId[]) : ids)
    .filter((id) => shown === 'all' || (shown === 'changed' ? isChanged(id) : isFixed(id)))
    .filter((id) => matches([LIMIT_DEFS[id].label, LIMIT_DEFS[id].over]));
  return (
    <>
      <div className="row limits-toolbar">
        <FilterBox label="Filter limits" value={filter} onChange={setFilter} />
        <FilterChips<Shown> label="Show" value={shown} onChange={setShown} total={ids.length} filters={[
          { id: 'changed', label: 'Changed', tone: 'match', count: ids.filter(isChanged).length },
          { id: 'fixed', label: 'Fixed', tone: 'title', count: ids.filter(isFixed).length },
        ]} />
      </div>
      {filter && <p className="hint">Matching in every tab.</p>}
      <div className="limit-cards">
        {list.map((id) => <LimitCard key={id} id={id} set={set} change={change} />)}
      </div>
      {!list.length && <p className="hint">No limit matches.</p>}
    </>
  );
}

// A limit on a card: what it caps, its value large, its field (or "fixed"), what happens past it, and
// the sections that show it (but `from`, the one it is shown in).
export function LimitCard({ id, set, change, from }: LimitEdit & { from?: string }) {
  const def = LIMIT_DEFS[id];
  const changed = set[id] !== undefined;
  const sections = sectionsOf(id).filter((hash) => hash !== from);
  return (
    <div className={`limit-card${changed ? ' changed' : ''}${def.range ? '' : ' fixed'}`}>
      <div className="limit-card-head">
        <strong>{def.label}</strong>
        {def.range ? <LimitReset id={id} set={set} change={change} /> : <span className="limit-fixed">fixed</span>}
      </div>
      <div className="limit-card-value">{fmt(limitFrom(id, set[id]))} <span className="limit-card-unit">{def.unit}</span></div>
      {def.range && <LimitValue id={id} set={set} change={change} unit={false} />}
      <p className="limit-card-over">✂ {def.over.charAt(0).toUpperCase() + def.over.slice(1)}<ToolResultFirst id={id} set={set} /></p>
      {sections.length > 0 && <div className="limit-card-where">{sections.map((hash) => <GoTo key={hash} hash={hash} title={SECTION_TOPS[hash]!.title} />)}</div>}
    </div>
  );
}

// ↺ back to the default, once changed.
export function LimitReset({ id, set, change }: LimitEdit) {
  const def = LIMIT_DEFS[id];
  if (set[id] === undefined) return null;
  return (
    <button className="icon-button" onClick={() => change(id, undefined)} title={`Changed: back to ${fmt(def.value)} ${def.unit}`} aria-label={`Reset ${def.label} to ${fmt(def.value)}`}>↺</button>
  );
}

// Its value: a field within its range (under it the range, the default once changed, and what a value
// out of the range comes to), or the value it always has. `unit`: its unit beside the field (a limit's
// card shows it beside its value instead).
export function LimitValue({ id, set, change, unit = true }: LimitEdit & { unit?: boolean }) {
  const def = LIMIT_DEFS[id];
  if (!def.range) return <>{fmt(def.value)} {def.unit}</>;
  const changed = set[id] !== undefined;
  const used = limitFrom(id, set[id]);
  return (
    <>
      <span className="limit-input">
        <input type="number" aria-label={`${def.label} limit`} min={def.range[0]} max={def.range[1]} value={set[id] ?? def.value}
          onChange={(e) => change(id, e.target.value === '' ? undefined : Number(e.target.value))} />
        {unit && def.unit}
      </span>
      <div className="muted small">{fmt(def.range[0])}–{fmt(def.range[1])}{changed ? ` · default ${fmt(def.value)}` : ''}{changed && used !== set[id] ? ` · uses ${fmt(used)}` : ''}</div>
    </>
  );
}

// Over the tool result limit, a tool's text is cut there first: said so.
function ToolResultFirst({ id, set }: Pick<LimitEdit, 'id' | 'set'>) {
  const most = limitFrom('toolResult', set.toolResult);
  if (!IN_TOOL_RESULT.has(id) || limitFrom(id, set[id]) <= most) return null;
  return <div className="small">Over the tool result limit ({fmt(most)} characters), that one cuts it first; the rest is kept for tools__read_more.</div>;
}
