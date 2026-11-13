// The toolbar of a Settings list of stored items (skills, site templates, custom tools, actions,
// agents, memory): the section's own buttons, then Select, Import ▾ (a file, pasted JSON, a URL, each
// through a preview) and Export ▾ (all, those shown, or those chosen with Select; to a file or
// copied). While selecting, a bar of what is selected and its export takes their place. Selecting is
// apart from on/off: export never looks at that.
import { useRef, useState, type ReactNode } from 'react';
import { errorText } from '../../core/errors';
import { readImportFile } from '../import-file';
import type { ImportRow } from '../../storage/import';
import { exportSubset, type ExportScope } from '../../storage/transfer';
import { downloadText } from '../download';
import { writeClip } from '../icons';
import { imported } from '../ImportExport';
import { MenuButton, type MenuItem } from '../MenuButton';
import { PasteJson } from '../PasteJson';
import { ImportPreview } from './ImportPreview';
import { hiddenCount, type Selection } from './selection';
import { UrlImport } from './UrlImport';

// A choice of what an export holds (custom tools: their header values), off until ticked.
export interface ExportOption {
  key: string;
  label: string;
  title?: string;
}

export interface ImportRead<T> {
  rows: ImportRow<T>[];
  notes?: string[];
}

export interface CollectionIOProps<T> {
  noun: [one: string, many: string]; // ['skill', 'skills']
  label: string; // 'Skills': what the file input and the paste box are named after
  fileName: string; // of the export
  items: T[];
  shown: T[]; // those the filter shows
  id: (item: T) => string;
  cannot?: (item: T) => string | undefined; // why it is not exported (built-in…)
  none?: string; // why Export is off when nothing can be exported
  exportJson: (items: T[], options: Record<string, boolean>) => string;
  options?: ExportOption[];
  read: (json: string) => ImportRead<T>; // throws why it cannot
  save: (items: T[], read: ImportRead<T>) => Promise<void>; // `read`: the preview they were picked in
  then?: string; // what to do with them once imported (imported())
  said?: (names: string[], leftOut: string[], notes: string[]) => string; // what an import says, for items without on/off (default: imported())
  pasteLabel?: string; // of the paste box (default: "<label> JSON (as exported here)")
  previewHint?: string; // under the preview (default: they come in off)
  previewExtra?: (read: ImportRead<T>) => ReactNode; // more in the preview, before its buttons (Speak: a list's provider and model)
  placeholder: string; // of the paste box
  selection: Selection;
  sourceLabel?: (sourceId: string) => string; // custom tools: the host of a source
  children?: ReactNode; // first in the row: the filter, ＋ New…
}

// What shows under the toolbar: the paste box, the URL box, or an import's preview.
type Panel<I> = { kind: 'paste' } | { kind: 'url' } | { kind: 'preview'; from: string; read: ImportRead<I>; seq: number };

export function CollectionIO<I>(props: CollectionIOProps<I>) {
  const { noun, items, shown, id, selection, options = [] } = props;
  const [panel, setPanel] = useState<Panel<I> | null>(null);
  const [message, setMessage] = useState('');
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const file = useRef<HTMLInputElement>(null);
  const reads = useRef(0); // each preview starts afresh, even one replacing another
  const exportable = (item: I) => !props.cannot?.(item);
  const all = items.filter(exportable);
  const showing = shown.filter(exportable);
  const nouns = (n: number) => `${n} ${n === 1 ? noun[0] : noun[1]}`;

  const take = (scope: ExportScope) => props.exportJson(exportSubset(items, { scope, shown, selected: selection.selected, id, exportable }), chosen);
  const download = (scope: ExportScope) => downloadText(props.fileName, take(scope));
  const copy = (scope: ExportScope, count: number) =>
    void writeClip(take(scope)).then(() => setMessage(`Copied ${nouns(count)} as JSON.`), (e: unknown) => setMessage(`Error: ${errorText(e)}`));
  const optionItems: MenuItem[] = options.map((o) => ({ label: o.label, title: o.title, checked: !!chosen[o.key], onToggle: (on) => setChosen({ ...chosen, [o.key]: on }) }));

  // The JSON read into a preview, or why it could not be (the box it came from stays, with it).
  const preview = (json: string, from: string) => {
    setMessage('');
    try {
      setPanel({ kind: 'preview', from, read: props.read(json), seq: ++reads.current });
    } catch (e) {
      setMessage(`Error: ${errorText(e)}`);
    }
  };
  const importChosen = async (picked: I[], read: ImportRead<I>) => {
    try {
      await props.save(picked, read);
      const names = read.rows.filter((r) => picked.includes(r.item!)).map((r) => r.name);
      const leftOut = read.rows.flatMap((r) => (r.status === 'left-out' ? [r.why!] : []));
      setMessage(props.said ? props.said(names, leftOut, read.notes ?? []) : imported(names, leftOut, noun[1], props.then, read.notes).said);
      setPanel(null);
    } catch (e) {
      setMessage(`Error: ${errorText(e)}`);
    }
  };

  const shownIds = showing.map(id);
  const count = selection.selected.size;
  const hidden = hiddenCount(selection.selected, shownIds);
  return (
    <>
      <div className="row io-row">
        {props.children}
        <span className="spacer" />
        {!selection.selecting && (
          <>
            <button onClick={selection.start} title="Choose which to export">Select</button>
            <MenuButton label="Import" items={[
              { label: 'From file…', onSelect: () => file.current?.click() },
              { label: 'Paste JSON…', onSelect: () => setPanel({ kind: 'paste' }) },
              { label: 'From URL…', onSelect: () => setPanel({ kind: 'url' }) },
            ]} />
            <MenuButton label="Export" disabled={!all.length} title={all.length ? undefined : (props.none ?? `No ${noun[1]} to export yet.`)} items={[
              { label: `Download all (${all.length})`, onSelect: () => download('all') },
              { label: `Copy all as JSON (${all.length})`, onSelect: () => copy('all', all.length) },
              ...(showing.length > 0 && showing.length < all.length ? [
                { label: `Download shown (${showing.length})`, onSelect: () => download('shown') },
                { label: `Copy shown as JSON (${showing.length})`, onSelect: () => copy('shown', showing.length) },
              ] : []),
              { label: 'Choose which…', onSelect: selection.start },
              ...optionItems,
            ]} />
          </>
        )}
        <input ref={file} type="file" accept="application/json,.json" hidden aria-label={`${props.label} file`}
          onChange={(e) => {
            const chosenFile = e.target.files?.[0];
            if (chosenFile) void readImportFile(chosenFile).then((json) => preview(json, chosenFile.name), (err: unknown) => setMessage(`Error: ${errorText(err)}`));
            e.target.value = ''; // the same file can be chosen again
          }} />
      </div>
      {selection.selecting && (
        <div className="row selection-bar" role="toolbar" aria-label="Selection">
          <strong>{count} selected{hidden ? ` (${hidden} hidden by the filter)` : ''}</strong>
          <button onClick={() => selection.setShown(shownIds, true)} disabled={!shownIds.length}>Select all shown ({shownIds.length})</button>
          {options.map((o) => (
            <label key={o.key} className="check" title={o.title}>
              <input type="checkbox" checked={!!chosen[o.key]} onChange={(e) => setChosen({ ...chosen, [o.key]: e.target.checked })} /> {o.label}
            </label>
          ))}
          <span className="spacer" />
          <button disabled={!count} title={count ? undefined : 'Select some first.'} onClick={() => download('selected')}>Download</button>
          <button disabled={!count} title={count ? undefined : 'Select some first.'} onClick={() => copy('selected', count)}>Copy JSON</button>
          <button onClick={selection.stop}>Done</button>
        </div>
      )}
      {panel?.kind === 'paste' && (
        <PasteJson label={props.pasteLabel ?? `${props.label} JSON (as exported here)`} placeholder={props.placeholder} onClose={() => setPanel(null)}
          onImport={async (json) => {
            preview(json, 'the pasted JSON');
            return false; // the preview takes its place
          }} />
      )}
      {panel?.kind === 'url' && (
        <UrlImport placeholder={`https://raw.githubusercontent.com/example/repo/main/${props.fileName}`} onRead={(json, host) => preview(json, host)} onClose={() => setPanel(null)} />
      )}
      {panel?.kind === 'preview' && (
        <ImportPreview key={panel.seq} rows={panel.read.rows} notes={panel.read.notes ?? []} noun={noun} from={panel.from} sourceLabel={props.sourceLabel}
          hint={props.previewHint} onImport={(picked) => void importChosen(picked, panel.read)} onCancel={() => setPanel(null)}>
          {props.previewExtra?.(panel.read)}
        </ImportPreview>
      )}
      {message && <p className={message.startsWith('Error') ? 'error-text' : 'muted pre-line'} role="status">{message}</p>}
    </>
  );
}
