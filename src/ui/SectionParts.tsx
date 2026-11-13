// The pieces the RAG sections of Settings share (memory, bookmarks, history, skills, site templates):
// a head with the section's main switch, a strip of figures, tabs, filter chips, and a card for a match
// needed. Each section composes them; none of them knows about a section.
import { useId, useState, type ReactNode } from 'react';
import { Switch } from './Collection';

// The title, one sentence on what the section is, and its main switch on the right.
export function SectionHead({ title, about, toggle }: { title: string; about: ReactNode; toggle?: { label: string; on: boolean; title?: string; onChange: (on: boolean) => void } }) {
  return (
    <div className="section-head">
      <div>
        <h3>{title}</h3>
        <p className="section-about">{about}</p>
      </div>
      {toggle && (
        <label className="section-head-switch" title={toggle.title}>
          {toggle.label}
          <Switch checked={toggle.on} label={toggle.label} onChange={toggle.onChange} />
        </label>
      )}
    </div>
  );
}

// A figure: its name, its value, a line under it, and how full it is against a limit (amber past 75%).
export interface Stat {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  meter?: { used: number; max: number };
}

export function StatStrip({ stats }: { stats: Stat[] }) {
  return (
    <div className="stat-strip">
      {stats.map((s) => {
        const share = s.meter ? Math.min(1, s.meter.used / Math.max(1, s.meter.max)) : 0;
        return (
          <div key={s.label} className="stat">
            <div className="stat-label">{s.label}</div>
            <div className="stat-value">{s.value}</div>
            {s.meter && (
              <div className={`stat-meter${share > 0.75 ? ' near' : ''}`} role="meter" aria-label={s.label} aria-valuemin={0} aria-valuemax={s.meter.max} aria-valuenow={s.meter.used}>
                <i style={{ width: `${share * 100}%` }} />
              </div>
            )}
            {s.sub && <div className="stat-sub">{s.sub}</div>}
          </div>
        );
      })}
    </div>
  );
}

// "1,240 / 8,000 characters": a figure against its limit.
export const OfLimit = ({ used, max, unit }: { used: number; max: number; unit: string }) => (
  <>{used.toLocaleString('en-US')} <span className="stat-of">/ {max.toLocaleString('en-US')} {unit}</span></>
);

export interface SectionTab {
  id: string;
  label: string;
  render: () => ReactNode;
}

// The section's tabs: the first open at first; only the open one is drawn. With `open` and `onOpen`
// the section keeps which one is open (Appearance: in the hash).
export function SectionTabs({ tabs, label, open: shown, onOpen }: { tabs: SectionTab[]; label: string; open?: string; onOpen?: (id: string) => void }) {
  const [own, setOwn] = useState(tabs[0]!.id);
  const open = shown ?? own;
  const setOpen = onOpen ?? setOwn;
  const base = useId();
  const current = tabs.find((t) => t.id === open) ?? tabs[0]!;
  return (
    <>
      <div className="section-tabs" role="tablist" aria-label={label}>
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" id={`${base}-${t.id}`} aria-selected={t === current} aria-controls={`${base}-panel`}
            className={t === current ? 'on' : undefined} onClick={() => setOpen(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="section-tab" role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-${current.id}`}>
        {current.render()}
      </div>
    </>
  );
}

// The kinds a chip is coloured by: how an item reaches the model, or where it comes from.
export type ChipTone = 'always' | 'site' | 'match' | 'title' | 'plain';

export const ToneChip = ({ tone, children, title }: { tone: ChipTone; children: ReactNode; title?: string }) => (
  <span className={`tone-chip tone-${tone}`} title={title}>{children}</span>
);

export interface ChipFilter<K extends string> {
  id: K;
  label: string;
  tone: ChipTone;
  count: number;
  title?: string;
}

// Chips over a list that show only its rows of a kind; All first. One with no rows is left out.
export function FilterChips<K extends string>({ filters, value, onChange, total, label }: { filters: ChipFilter<K>[]; value: K | 'all'; onChange: (id: K | 'all') => void; total: number; label: string }) {
  return (
    <div className="filter-chips" role="group" aria-label={label}>
      <button type="button" className="tone-chip tone-plain" aria-pressed={value === 'all'} onClick={() => onChange('all')}>All · {total}</button>
      {filters.filter((f) => f.count || value === f.id).map((f) => (
        <button key={f.id} type="button" className={`tone-chip tone-${f.tone}`} aria-pressed={value === f.id} title={f.title} onClick={() => onChange(value === f.id ? 'all' : f.id)}>
          {f.label} · {f.count}
        </button>
      ))}
    </div>
  );
}

// A match needed, on a card: what it compares, its value large, its control under it, and its switch
// (when it has one) in the head. A card switched off is dimmed, its control still there.
export function MatchCard({ title, about, value, toggle, off, children }: { title: string; about: ReactNode; value: ReactNode; toggle?: { on: boolean; label: string; disabled?: boolean; title?: string; onChange: (on: boolean) => void }; off?: boolean; children?: ReactNode }) {
  return (
    <div className={`match-card${off ? ' off' : ''}`}>
      <div className="match-card-head">
        <strong>{title}</strong>
        {toggle && <Switch checked={toggle.on} label={toggle.label} disabled={toggle.disabled} title={toggle.title} onChange={toggle.onChange} />}
      </div>
      <div className="match-card-about">{about}</div>
      <div className="match-card-value">{value}</div>
      {children}
    </div>
  );
}

export const MatchCards = ({ children }: { children: ReactNode }) => <div className="match-cards">{children}</div>;

// Under the cards of a match needed, a message tried against them: moving a bar shows its effect at once.
export const TryBelow = ({ children }: { children: ReactNode }) => (
  <div className="try-below">
    <h4>Try a message</h4>
    {children}
  </div>
);

// A step of a list done in order (<ol className="numbered-steps">): its number, its title (and a
// switch beside it), a line on it, and what is set in it. `fixed`: one with nothing to set, dimmed.
// `state`: in a guided editor, where the step stands (done, the one open, still to come).
export function NumberedStep({ n, title, about, toggle, fixed, state, children }: { n: number; title: ReactNode; about?: ReactNode; toggle?: ReactNode; fixed?: boolean; state?: 'done' | 'current' | 'pending'; children?: ReactNode }) {
  return (
    <li className={`numbered-step${fixed ? ' fixed' : ''}${state ? ` ${state}` : ''}`} aria-current={state === 'current' ? 'step' : undefined}>
      <span className="numbered-step-n" aria-hidden="true">{state === 'done' ? '✓' : n}</span>
      <div className="numbered-step-body">
        <h4>{title}{toggle}</h4>
        {about && <p className="hint">{about}</p>}
        {children}
      </div>
    </li>
  );
}
