// The top of a settings section: the shortcuts that belong to it and the size limits that apply to it,
// set here as in Settings → Shortcuts and Settings → Limits (the same stored values; those pages list
// them all). Under the section's title and its hint.
import { useContext } from 'react';
import { LIMIT_DEFS, type LimitId } from '../core/limits';
import { LimitReset, LimitValue, limitChange, type LimitEdit } from './LimitsSettings';
import { SECTION_TOPS } from './section-tops';
import { SettingsContext } from './settings-context';
import { labelOf, PageKey, useShortcutTable } from './ShortcutsSettings';
import { GoTo } from './text-pages';

export function SectionTop({ page }: { page: string }) {
  const value = useContext(SettingsContext);
  const def = SECTION_TOPS[page];
  if (!def || !value) return null;
  const set = value.settings.limits ?? {};
  const change = limitChange(value.settings, value.update);
  const { shortcuts = [], limits = [], more = [] } = def;
  return (
    <div className="section-top">
      {shortcuts.length > 0 && <Shortcuts names={shortcuts} />}
      {limits.length > 0 && <LimitRows head="✂ Limits" ids={limits} set={set} change={change} />}
      {more.length > 0 && (
        <details className="settings-fold">
          <summary>{more.length} more limits</summary>
          <LimitRows ids={more} set={set} change={change} />
        </details>
      )}
      <div className="section-top-row section-top-links">
        {shortcuts.length > 0 && <GoTo hash="shortcuts" title="Shortcuts" />}
        {limits.length > 0 && <GoTo hash="limits" title="Limits" />}
      </div>
    </div>
  );
}

export function Shortcuts({ names }: { names: string[] }) {
  const table = useShortcutTable();
  return (
    <div className="section-top-group">
      <span className="section-top-head">Shortcuts</span>
      {names.map((name) => {
        const c = table.shortcuts.find((s) => s.name === name);
        return (
          <div key={name} className="section-top-row">
            <span className="section-top-label">{c ? labelOf(c) : name}</span>
            <span className="muted">Browser</span>
            {c?.shortcut ? <kbd>{c.shortcut}</kbd> : <span className="hint">not set</span>}
            <span className="muted">In pages</span>
            <PageKey name={name} table={table} />
          </div>
        );
      })}
    </div>
  );
}

function LimitRows({ head, ids, set, change }: { head?: string; ids: LimitId[] } & Omit<LimitEdit, 'id'>) {
  return (
    <div className="section-top-group">
      {head && <span className="section-top-head">{head}</span>}
      {ids.map((id) => (
        <div key={id} className="section-top-row" title={`Past it: ${LIMIT_DEFS[id].over}`}>
          <span className="section-top-label">{LIMIT_DEFS[id].label}</span>
          <LimitValue id={id} set={set} change={change} />
          <LimitReset id={id} set={set} change={change} />
        </div>
      ))}
    </div>
  );
}
