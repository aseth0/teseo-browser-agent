// What goes with your message on its own (Settings → Bookmarks, Memory, History): the switch, the match
// needed and how many, on a card of the section's Matching tab (in the side panel's history, as plain
// fields); and under the card, a message tried as you would send it, with what it matches and what would
// be attached: the same picks the chat makes (bookmarks/auto, memory/prompt, history/auto), so moving
// the bar or the maximum shows its effect at once.
import { Fragment, useEffect, useEffectEvent, useState, type ReactNode } from 'react';
import type { AttachDefaults, MatchAttach } from '../storage/settings-types';
import { SearchedAs } from './SearchPlayground';
import { errorText } from '../core/errors';
import { MatchCard } from './SectionParts';


// One result of the search tried: its match (0 to 1) and what to show of it.
interface AutoHit {
  id: string;
  match: number;
  meaning?: number; // how close in meaning (0 to 1), where meaning counts too
  title: ReactNode;
  detail?: ReactNode;
  badges?: ReactNode;
  // Why it never goes on its own, whatever its match (a memory item linked to a site, a pinned one).
  never?: string;
}

// The named levels of a match (every Auto-attach bar, and Memory's search): the value each sets and, on
// the bars, where its range starts.
const MIN = 20;
export const MATCH_LEVELS = [
  { name: 'Broad', from: MIN, value: 40, about: 'a word or two in common is enough: it attaches often, also what does not fit' },
  { name: 'Moderate', from: 55, value: 65, about: 'most of your message must be in it' },
  { name: 'Precise', from: 75, value: 80, about: 'nearly all of your message must be in it' },
  { name: 'Strict', from: 90, value: 95, about: 'all of your message: it attaches rarely' },
];
// How many results a playground shows.
export const PLAYGROUND_RESULTS = 8;

// How long after the last key the results with meaning are asked for.
const REFINE_DELAY_MS = 600;

const bandOf = (v: number) => MATCH_LEVELS.findLast((b) => v >= b.from) ?? MATCH_LEVELS[0]!;

interface ControlsProps {
  auto: MatchAttach;
  defaults: AttachDefaults;
  label: string;
  rangeLabel?: string;
  onChange: (change: Partial<MatchAttach>) => void;
  children?: ReactNode;
  // Under the switch: what a section adds (Memory's and Bookmarks' "between the model's steps").
  after?: ReactNode;
}

// The bar of a match needed and, under it, its named ranges as wide as their part of it: a click sets
// a range's usual value.
function MatchRange({ threshold, label, onChange }: { threshold: number; label: string; onChange: (change: { threshold: number }) => void }) {
  return (
    <>
      <input type="range" min={MIN} max={100} step={5} value={threshold} aria-label={label} onChange={(e) => onChange({ threshold: Number(e.target.value) })} />
      <div className="match-bands" role="group" aria-label="Match ranges">
        {MATCH_LEVELS.map((b, i) => {
          const to = MATCH_LEVELS[i + 1]?.from ?? 101;
          return (
            <button key={b.name} type="button" className={bandOf(threshold) === b ? 'on' : undefined} style={{ flexGrow: to - b.from }}
              title={`${b.from}–${to - 1}%: ${b.about}. Sets ${b.value}%.`} onClick={() => onChange({ threshold: b.value })}>
              {b.name}
            </button>
          );
        })}
      </div>
    </>
  );
}

const MostField = ({ auto, defaults, onChange }: Pick<ControlsProps, 'auto' | 'defaults' | 'onChange'>) => (
  <label>At most, per message
    <select value={auto.max ?? defaults.max} onChange={(e) => onChange({ max: Number(e.target.value) })}>
      {Array.from({ length: defaults.most }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
    </select>
  </label>
);

// The switch, the match needed and how many per message (and what a section adds, as History's scope),
// as fields: the side panel's history.
export function AutoAttachControls({ auto, defaults, label, rangeLabel = 'Match needed', onChange, children, after }: ControlsProps) {
  const threshold = auto.threshold ?? defaults.threshold;
  return (
    <div className="auto-attach-fields">
      <label className="check">
        <input type="checkbox" checked={auto.enabled ?? false} onChange={(e) => onChange({ enabled: e.target.checked })} />
        {label}
      </label>
      {after}
      <div className="auto-attach-bar">
        <div className="auto-attach-range">
          <label><span>Match needed: <strong>{threshold}%</strong> · {bandOf(threshold).name} — of your message's words (the rare ones weigh more)</span>
            <MatchRange threshold={threshold} label={rangeLabel} onChange={onChange} />
          </label>
        </div>
        <MostField auto={auto} defaults={defaults} onChange={onChange} />
        {children}
      </div>
    </div>
  );
}

// The same on a card of a section's Matching tab: what it compares, the switch in its head, the match
// needed large, its bar, how many per message and what the section adds.
export function AutoAttachCard({ auto, defaults, label, rangeLabel = 'Match needed', onChange, children, after, about }: ControlsProps & { about: ReactNode }) {
  const threshold = auto.threshold ?? defaults.threshold;
  return (
    <MatchCard title="Auto-attach" about={about} off={!auto.enabled} value={<>{threshold}% <span className="match-card-unit">{bandOf(threshold).name}</span></>}
      toggle={{ on: auto.enabled ?? false, label, title: label, onChange: (enabled) => onChange({ enabled }) }}>
      <div className="auto-attach-fields">
        <MatchRange threshold={threshold} label={rangeLabel} onChange={onChange} />
        <MostField auto={auto} defaults={defaults} onChange={onChange} />
        {children}
        {after}
      </div>
    </MatchCard>
  );
}

interface PlaygroundProps {
  auto: MatchAttach;
  defaults: AttachDefaults;
  nouns: [one: string, many: string];
  searchLabel: string;
  // The results for a message, best first, and the ids the chat would attach with it.
  search: (query: string) => Promise<{ hits: AutoHit[]; picked: string[] }>;
  // Where meaning counts too (memory): the % it needs, and the results with it, asked for once the typing
  // stops, as they call a provider. `note`: why they come by words only.
  meaningThreshold?: number;
  refine?: (query: string) => Promise<{ hits: AutoHit[]; picked: string[]; note?: string }>;
  // Changes that should search again besides the message and these settings (the items, an agent).
  refresh?: unknown;
  // Beside the box (Memory's agent).
  searchExtra?: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}

// One score against what it needs: labelled where there are two. No value: not indexed.
function Meter({ label, value, needed, title }: { label?: string; value?: number; needed: number; title: string }) {
  const bar = (
    <div className="playground-meter" title={title}>
      <span style={{ width: `${value ?? 0}%` }} />
      <i style={{ left: `${needed}%` }} />
    </div>
  );
  return label ? <div className="playground-score"><span>{label}</span>{bar}<span>{value === undefined ? '–' : `${value}%`}</span></div> : bar;
}

// A message tried as you would send it: what it matches, against the match needed, and what would go.
export function AttachPlayground(props: PlaygroundProps) {
  const { auto, defaults, nouns, searchLabel, search, refresh, searchExtra, hint, disabled, meaningThreshold, refine } = props;
  const threshold = auto.threshold ?? defaults.threshold;
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ hits: AutoHit[]; picked: Set<string> }>();
  const [error, setError] = useState('');
  const [note, setNote] = useState<string>();
  // The latest search function, without searching again on every render.
  const runSearch = useEffectEvent((q: string) => search(q));
  const runRefine = useEffectEvent((q: string) => refine?.(q));
  const settingsKey = JSON.stringify(auto);
  useEffect(() => {
    setNote(undefined);
    if (!query.trim()) return setFound(undefined);
    let current = true;
    const timer = setTimeout(() => {
      runSearch(query).then(
        ({ hits, picked }) => current && (setFound({ hits, picked: new Set(picked) }), setError('')),
        (e: unknown) => current && setError(errorText(e)),
      );
    }, 150);
    const refining = setTimeout(() => {
      void runRefine(query)?.then(
        (r) => current && (setFound({ hits: r.hits, picked: new Set(r.picked) }), setNote(r.note)),
        (e: unknown) => current && setError(errorText(e)),
      );
    }, REFINE_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
      clearTimeout(refining);
    };
  }, [query, settingsKey, refresh]);
  const count = found?.picked.size ?? 0;
  return (
    <fieldset className="auto-attach-block attach-playground" disabled={disabled}>
      {hint && <p className="hint">{hint}</p>}
      <div className="search-playground">
        <div className="row">
          <input className="grow" type="search" value={query} placeholder="A message, as you would send it" aria-label={searchLabel} onChange={(e) => setQuery(e.target.value)} />
          {searchExtra}
        </div>
        <SearchedAs query={query} />
        {error && <p className="error-text">{error}</p>}
        {note && <p className="hint">{note}</p>}
        {found && !found.hits.length && <p className="muted">Nothing matches.</p>}
        {found?.hits.map((hit, i) => {
          const pct = Math.round(hit.match * 100);
          const meaning = hit.meaning === undefined ? undefined : Math.round(hit.meaning * 100);
          const both = meaningThreshold !== undefined;
          const over = pct >= threshold || (both && meaning !== undefined && meaning >= meaningThreshold);
          // The match needed, between those that reach it and those that do not. With meaning too, the
          // order is of both and each meter has its own mark.
          const line = !both && !over && (i === 0 || Math.round(found.hits[i - 1]!.match * 100) >= threshold);
          return (
            <Fragment key={hit.id}>
              {line && <div className="playground-threshold">{threshold}% needed</div>}
              <div className={`playground-hit${over && !hit.never ? '' : ' under'}`}>
                <div className="playground-head">
                  <strong>{hit.title}</strong>
                  {!both && <span className="badge" title="How much of your message it covers, the rare words weighing more">{pct}% match</span>}
                  {found.picked.has(hit.id) && <span className="badge accent" title={`Auto-attach is on, at ${threshold}%`}>would be attached</span>}
                  {hit.never && <span className="badge warn" title="Auto-attach leaves it out, whatever its match">never on its own: {hit.never}</span>}
                  {hit.badges}
                </div>
                {both ? (
                  <>
                    <Meter label="Words" value={pct} needed={threshold} title="How much of your message it covers, the rare words weighing more" />
                    <Meter label="Meaning" value={meaning} needed={meaningThreshold} title="How close in meaning to your message, on this model's own scale" />
                  </>
                ) : (
                  <Meter value={pct} needed={threshold} title={`${pct}% of the ${threshold}% needed`} />
                )}
                {hit.detail}
              </div>
            </Fragment>
          );
        })}
        {found && (
          <p className="hint auto-attach-sum">
            {!auto.enabled ? 'Auto-attach is off: nothing would be attached.'
              : `This message would get ${count || 'no'} ${count === 1 ? nouns[0] : nouns[1]}. In a chat, one already attached there, or mentioned, does not go again.`}
          </p>
        )}
      </div>
    </fieldset>
  );
}

// Memory's and Bookmarks' switch for what the model writes between its steps (context/step-attach).
export const StepsCheck = ({ on, off, onChange }: { on: boolean; off?: boolean; onChange: (on: boolean) => void }) => (
  <label className="check auto-attach-sub" title="Before calling a tool, what the model wrote is matched too (not its reasoning nor its calls), with the same match needed and maximum, per step; what matches goes after that tool's result">
    <input type="checkbox" checked={on} disabled={off} onChange={(e) => onChange(e.target.checked)} />
    Also check the model's replies between its steps
  </label>
);
