// What an import would do, before it does it: each item of the JSON new, replacing yours, leaving its
// source, or left out (why, on pointing at it); the ones to import ticked, then Import N or Cancel.
import { useState, type ReactNode } from 'react';
import type { ImportRow, ImportStatus } from '../../storage/import';

export interface PreviewProps<T> {
  rows: ImportRow<T>[];
  notes: string[];
  noun: [string, string];
  from: string; // where the JSON came from: a file's name, "the pasted JSON", a host
  sourceLabel?: (sourceId: string) => string;
  onImport: (items: T[]) => void;
  onCancel: () => void;
  hint?: string; // under the rows (default: they come in off)
  children?: ReactNode; // before the buttons
}

// Ticked at first: those new or replacing yours (one leaving its source is the user's call).
export const TICKED = new Set<ImportStatus>(['new', 'replaces']);

// What importing a row does, as a badge (Settings → Export and import shows them too).
export const StatusBadge = ({ row: r, source }: { row: ImportRow<unknown>; source?: (sourceId: string) => string }) =>
  r.status === 'new' ? <span className="badge">new</span>
  : r.status === 'replaces' ? <span className="badge accent">replaces yours</span>
  : r.status === 'leaves-source' ? <span className="badge accent">replaces a tool synced from {source?.(r.sourceId!) ?? 'a source'}: it leaves that source</span>
  : <span className="badge warn" title={r.why}>left out</span>;

export function ImportPreview<T>({ rows, notes, noun, from, sourceLabel, onImport, onCancel, hint = 'They come in off: review them, then switch them on.', children }: PreviewProps<T>) {
  const [ticked, setTicked] = useState(() => new Set(rows.flatMap((r, i) => (TICKED.has(r.status) ? [i] : []))));
  const tick = (i: number, on: boolean) => setTicked((t) => new Set(on ? [...t, i] : [...t].filter((x) => x !== i)));
  const what = (r: ImportRow<T>) => <StatusBadge row={r} source={sourceLabel} />;
  return (
    <div className="card import-preview">
      <strong>{rows.length} {rows.length === 1 ? noun[0] : noun[1]} in {from}</strong>
      <ul className="import-rows">
        {rows.map((r, i) => (
          <li key={i} className={r.status === 'left-out' ? 'muted' : undefined}>
            <label className="check">
              <input type="checkbox" aria-label={`Import ${r.name}`} disabled={r.status === 'left-out'} checked={ticked.has(i)} onChange={(e) => tick(i, e.target.checked)} />
              {r.name}
            </label>
            {what(r)}
          </li>
        ))}
      </ul>
      {notes.length > 0 && <ul className="hint">{notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      {hint && <p className="hint">{hint}</p>}
      {children}
      <div className="row">
        <button className="primary" disabled={!ticked.size} onClick={() => onImport([...ticked].sort((x, y) => x - y).map((i) => rows[i]!.item!))}>Import {ticked.size}</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
