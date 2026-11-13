// The pieces the Settings screens of stored items share (skills, site templates, agents, memory,
// custom tools, actions): their table, the badge of what the model saved, and the editor's footer.
import { Fragment, useState, type ReactNode } from 'react';
import { errorText } from '../core/errors';
import { InlineConfirm } from './InlineConfirm';
import { useAttempt } from './useAttempt';

// Why a built-in item (skill, site template) is not exported, nor chosen to be: it comes with the extension.
export const builtIn = (item: { builtin?: boolean }) => (item.builtin ? 'Built in: it comes with the extension' : undefined);

export const ByModelBadge = ({ by }: { by?: string }) =>
  by === 'model' ? <span className="badge" title="Saved by the model after you approved it">by the model</span> : null;

// On or off, drawn as a switch so that it is never taken for a selection (a checkbox underneath).
export const Switch = ({ checked, label, title, disabled, onChange }: { checked: boolean; label: string; title?: string; disabled?: boolean; onChange: (on: boolean) => void }) => (
  <input type="checkbox" role="switch" className="switch-input" checked={checked} disabled={disabled} title={title} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
);

// While selecting (ui/collection/selection): the rows' keys selected, a row's box and the head's
// (every row shown that can be chosen), and why a row cannot be.
export interface TableSelect<T> {
  selected: Set<string>;
  onSelect: (key: string, on: boolean) => void;
  onSelectShown: (keys: string[], on: boolean) => void;
  cannot: (row: T) => string | undefined;
}

// A cell of the table: its head (`title`: what pointing at it shows) and what it shows for a row.
interface Column<T> {
  head: ReactNode;
  title?: string;
  label?: string; // of a head that shows no text
  className?: string; // of the head and the cells ("switch": a checkbox's)
  cell: (row: T) => ReactNode;
}

interface TableProps<T> {
  className?: string; // its own, beside collection-table
  rows: T[];
  rowKey: (row: T) => string;
  name: (row: T) => string; // what the switch and the link are labelled after
  nameHead: string; // "Skill"
  // What the link shows (default: its name), what pointing at it shows; none: no editor, the name alone.
  link?: (row: T) => ReactNode;
  linkTitle?: (row: T) => string | undefined;
  onOpen: (row: T) => (() => void) | undefined;
  onTitle: string; // what on means
  isOn: (row: T) => boolean;
  // Switched on or off (why it failed shown under the table); `fixed`: a row always on (what
  // pointing at its switch shows).
  onToggle: (row: T, on: boolean) => Promise<unknown>;
  fixed?: (row: T) => string | undefined;
  tags?: (row: T) => ReactNode;
  columns?: Column<T>[]; // after Tags
  description?: (row: T) => ReactNode;
  descriptionTitle?: (row: T) => string | undefined;
  after?: Column<T>[]; // after Description
  // Rows in groups, under a heading row each while there is more than one (`group`: its title).
  group?: (row: T) => string;
  groupTitle?: (group: string) => string;
  // Its own row around the cells (`lead` is the head of a first cell it adds), e.g. a row that is dragged.
  row?: (row: T, index: number, cells: ReactNode) => ReactNode;
  lead?: Omit<Column<never>, 'cell'>;
  select?: TableSelect<T>; // while selecting: a first column of checkboxes
}

// The table of a Settings screen of stored items: on or off, the name that opens its editor, its
// tags, the screen's own columns and its description; a row switched off is dimmed. While selecting,
// a checkbox first in each row.
export function CollectionTable<T>(props: TableProps<T>) {
  const { rows, name, select } = props;
  const { failed, attempt } = useAttempt();
  const groups = props.group ? [...new Set(rows.map(props.group))] : [''];
  const width = 3 + Number(!!select) + Number(!!props.lead) + Number(!!props.description) + (props.columns?.length ?? 0) + (props.after?.length ?? 0);
  const choosable = select ? rows.filter((r) => !select.cannot(r)).map(props.rowKey) : [];
  const chosen = choosable.filter((k) => select?.selected.has(k)).length;
  const cells = (r: T) => {
    const open = props.onOpen(r);
    const fixed = props.fixed?.(r);
    const cannot = select?.cannot(r);
    return (
      <>
        {select && (
          <td className="select-col">
            <input type="checkbox" aria-label={`Select ${name(r)}`} disabled={!!cannot} title={cannot} checked={select.selected.has(props.rowKey(r))}
              onChange={(e) => select.onSelect(props.rowKey(r), e.target.checked)} />
          </td>
        )}
        <td className="switch">
          <Switch checked={props.isOn(r)} disabled={!!fixed} title={fixed ?? props.onTitle} label={`${name(r)}: on`} onChange={(on) => attempt(props.onToggle(r, on))} />
        </td>
        <td>
          {open
            ? <button className="link-button item-name" title={props.linkTitle?.(r)} onClick={open}>{props.link?.(r) ?? name(r)}</button>
            : <span className="item-name">{props.link?.(r) ?? name(r)}</span>}
        </td>
        <td><span className="row-tags">{props.tags?.(r)}</span></td>
        {props.columns?.map((c, i) => <td key={i} className={c.className}>{c.cell(r)}</td>)}
        {props.description && <td className="muted"><span className="row-desc" title={props.descriptionTitle?.(r)}>{props.description(r)}</span></td>}
        {props.after?.map((c, i) => <td key={i} className={c.className}>{c.cell(r)}</td>)}
      </>
    );
  };
  const head = (c: Omit<Column<never>, 'cell'>, i: number) => <th key={i} className={c.className} title={c.title} aria-label={c.label}>{c.head}</th>;
  return (
    <>
      <table className={`collection-table${props.className ? ` ${props.className}` : ''}`}>
        <thead>
          <tr>
            {props.lead && head(props.lead, -1)}
            {select && (
              <th className="select-col">
                <input type="checkbox" aria-label="Select all shown" disabled={!choosable.length} checked={chosen > 0 && chosen === choosable.length}
                  ref={(box) => void (box && (box.indeterminate = chosen > 0 && chosen < choosable.length))}
                  onChange={(e) => select.onSelectShown(choosable, e.target.checked)} />
              </th>
            )}
            <th className="switch" title={props.onTitle}>On</th>
            <th>{props.nameHead}</th>
            <th>Tags</th>
            {props.columns?.map(head)}
            {props.description && <th>Description</th>}
            {props.after?.map(head)}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const inGroup = props.group ? rows.filter((r) => props.group!(r) === g) : rows;
            return (
              <Fragment key={g}>
                {groups.length > 1 && <tr><th colSpan={width} className="custom-group-title">{props.groupTitle?.(g) ?? g}</th></tr>}
                {inGroup.map((r) => {
                  const index = rows.indexOf(r);
                  return props.row
                    ? <Fragment key={props.rowKey(r)}>{props.row(r, index, cells(r))}</Fragment>
                    : <tr key={props.rowKey(r)} className={props.isOn(r) ? undefined : 'off'}>{cells(r)}</tr>;
                })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {failed && <p className="error-text" role="alert">{failed}</p>}
    </>
  );
}

// Under the table: why it has no rows (none yet, or none matching the filter: `one` is its noun,
// `many` the plural).
export function EmptyCollection({ shown, total, one, many, none, loaded }: { shown: number; total: number; one: string; many: string; none?: string; loaded: boolean }) {
  if (!loaded || shown) return null;
  return <p className="hint">{total ? `No ${one} matches the filter.` : (none ?? `No ${many} yet.`)}</p>;
}

// The filter typed over a table: what is typed, and whether an item's texts have it.
export function useFilter() {
  const [filter, setFilter] = useState('');
  const query = filter.trim().toLowerCase();
  return { filter, setFilter, matches: (texts: (string | undefined)[]) => !query || texts.some((t) => t?.toLowerCase().includes(query)) };
}

export const FilterBox = ({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) => (
  <input className="grow" type="search" placeholder={`${label}…`} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
);

// At the top of an editor: back to its screen's list.
export const BackToList = ({ route, title }: { route: string; title: string }) => <p><a href={`#${route}`}>← {title}</a></p>;

// What the hash names when there is no such item.
export const NoSuchItem = ({ route, noun, target }: { route: string; noun: string; target: string }) => (
  <p className="hint">No {noun} "{target}". <a href={`#${route}`}>Back to the list</a></p>
);

// What keeps it from being saved, then Save, Cancel and (once saved, with `onDelete`) Delete, asked
// first; a built-in one only goes back. Each waited for, once at a time, and why it failed shown here.
// `quiet`: the problems are listed elsewhere (a custom tool's Checks); Save still waits for none.
export function EditorFooter(props: { problems: string[]; quiet?: boolean; readOnly?: boolean; isNew: boolean; onSave: () => unknown; onDelete?: () => Promise<void>; onClose: () => void }) {
  const { problems, quiet, readOnly, isNew, onDelete, onClose } = props;
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const attempt = async (what: () => unknown) => {
    if (working) return;
    setWorking(true);
    setError('');
    try {
      await what();
    } catch (e) {
      console.error('[editor]', e);
      setError(errorText(e));
    } finally {
      setWorking(false);
    }
  };
  return (
    <>
      {!readOnly && !quiet && problems.length > 0 && <ul className="problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="row">
        {!readOnly && <button className="primary" disabled={problems.length > 0 || working} onClick={() => void attempt(props.onSave)}>Save</button>}
        <button onClick={onClose}>{readOnly ? 'Back' : 'Cancel'}</button>
        {!readOnly && !isNew && onDelete && (
          <InlineConfirm question="Delete it?" onConfirm={() => attempt(async () => { await onDelete(); onClose(); })}>
            {(ask) => <button className="danger" disabled={working} onClick={ask}>Delete</button>}
          </InlineConfirm>
        )}
      </div>
    </>
  );
}
