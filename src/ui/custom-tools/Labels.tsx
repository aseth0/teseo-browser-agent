// The labels of custom tools (yours, with their colors) and their groups.
import { useState } from 'react';
import type { CustomTool } from '../../tools/custom/types';
import { KINDS, kindsOf, LABEL_COLORS, labelColor, labelName, loadLabelColors, onLabelColorsChanged, setLabelColor, type LabelColor, type LabelColors } from '../../tools/labels';
import { isEnter } from '../enter';
import { useLive } from '../useLive';

// The labels' colors, kept up to date.
const NO_COLORS: LabelColors = {};
export const useLabelColors = (): LabelColors => useLive(loadLabelColors, onLabelColorsChanged, NO_COLORS, '[label colors]');

// The groups the tools are in, those without one first (""), then by name.
export const groupsOf = (customs: CustomTool[]) => [...new Set(customs.map((c) => c.group?.trim() ?? ''))].sort((a, b) => (a && b ? a.localeCompare(b) : a ? 1 : -1));

// A label in its color; `own`: one of the user's (a kind is not).
export function Label({ color, text, own }: { color: LabelColor | 'tool' | 'model'; text: string; own?: boolean }) {
  return <span className={`label${own ? ' own' : ''}`} data-color={color}>{text}</span>;
}

// The kinds and labels the tools have: picking some shows only the tools that have all of them.
export function LabelFilter({ customs, colors, picked, onPick, shown }: { customs: CustomTool[]; colors: LabelColors; picked: { kinds: string[]; labels: string[] }; onPick: (p: { kinds: string[]; labels: string[] }) => void; shown: number }) {
  const kinds = KINDS.filter((k) => customs.some((c) => kindsOf(c).includes(k.id)));
  const labels = [...new Set(customs.flatMap((c) => c.labels ?? []))].sort();
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const any = picked.kinds.length + picked.labels.length > 0;
  return (
    <div className="label-filter" role="group" aria-label="Show only the tools with">
      {kinds.map((k) => (
        <button key={k.id} className="label" data-color={k.color} aria-pressed={picked.kinds.includes(k.id)} onClick={() => onPick({ ...picked, kinds: toggle(picked.kinds, k.id) })}>{k.label}</button>
      ))}
      {labels.map((l) => (
        <button key={l} className="label own" data-color={labelColor(l, colors)} aria-pressed={picked.labels.includes(l)} onClick={() => onPick({ ...picked, labels: toggle(picked.labels, l) })}>{l}</button>
      ))}
      {any && (
        <>
          <span className="muted small">{shown} of {customs.length}</span>
          <button className="icon-button" onClick={() => onPick({ kinds: [], labels: [] })}>Show all</button>
        </>
      )}
    </div>
  );
}

// The tool's labels: added by name (one it has, or a new one), each with its color, picked here for
// every tool that has it.
export function LabelsEditor({ labels, known, onChange }: { labels: string[]; known: string[]; onChange: (labels: string[]) => void }) {
  const colors = useLabelColors();
  const [typed, setTyped] = useState('');
  const [choosing, setChoosing] = useState<string | null>(null); // the label whose color is being picked
  const add = () => {
    const name = labelName(typed);
    if (name && !labels.includes(name)) onChange([...labels, name]);
    setTyped('');
  };
  return (
    <div className="labels-editor">
      <div className="field-label">Labels (yours, to find it in this list; the model does not see them)</div>
      <div className="row">
        {labels.map((l) => (
          <span key={l} className="label own" data-color={labelColor(l, colors)}>
            <button className="label-dot" title="Its color" aria-label={`Color of ${l}`} aria-expanded={choosing === l} onClick={() => setChoosing(choosing === l ? null : l)} />
            {l}
            <button className="label-remove" title="Remove" aria-label={`Remove the label ${l}`} onClick={() => onChange(labels.filter((x) => x !== l))}>✕</button>
          </span>
        ))}
        <input aria-label="New label" className="narrow-input" list="custom-tool-labels" value={typed} placeholder="work"
          onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => isEnter(e) && (e.preventDefault(), add())} />
        <datalist id="custom-tool-labels">{known.filter((k) => !labels.includes(k)).map((k) => <option key={k} value={k} />)}</datalist>
        <button onClick={add} disabled={!labelName(typed)}>Add</button>
      </div>
      {choosing && (
        <div className="row" role="radiogroup" aria-label={`Color of ${choosing}`}>
          {LABEL_COLORS.map((c) => (
            <button key={c} className="label-swatch" data-color={c} role="radio" aria-checked={labelColor(choosing, colors) === c} title={c} aria-label={c}
              onClick={() => void setLabelColor(choosing, c).then(() => setChoosing(null))} />
          ))}
        </div>
      )}
    </div>
  );
}
