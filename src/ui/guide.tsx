// An editor as a guide (the custom tool editor, the page widget action editor): its steps one at a
// time, each done, open or still to come; a done one folded to a line; a step's problems shown beside
// their fields once the user has been through it; optional parts folded to a line until opened; the
// kinds of item as cards; and texts with values inserted by a click.
import { useId, useRef, useState, type ReactNode } from 'react';
import { NumberedStep } from './SectionParts';

export interface Guide<S extends string = string> {
  ids: S[];
  open: S | null;
  seen: ReadonlySet<S>; // been through: its problems show, and it folds to its summary
  show: (id: S) => void;
  next: (id: S, problems: number) => void;
  goTo: (id: S, past: S[]) => void; // past those steps (a request pasted: on to check it)
  restart: (keep?: S[]) => void; // another kind: its steps from the first, none been through but those kept
}

// A new item starts at its first step; one that exists opens with every step folded (`every`: all
// the steps any kind has). Next passes over the `optional` steps not opened yet.
export function useGuide<S extends string>(ids: S[], isNew: boolean, every: readonly S[], optional: readonly S[] = []): Guide<S> {
  const [open, setOpen] = useState<S | null>(isNew ? ids[0]! : null);
  const [seen, setSeen] = useState<Set<S>>(() => new Set(isNew ? [] : every));
  const see = (...more: S[]) => setSeen((s) => new Set([...s, ...more]));
  const show = (id: S) => {
    if (open) see(open);
    see(id);
    setOpen(id);
  };
  // A step first left with problems stays, showing them; once been through, Next goes on.
  const next = (id: S, problems: number) => {
    see(id);
    if (problems && !seen.has(id)) return;
    const after = ids.slice(ids.indexOf(id) + 1);
    setOpen(after.find((s) => !optional.includes(s) || seen.has(s)) ?? null);
  };
  const goTo = (id: S, past: S[]) => {
    see(...past);
    setOpen(id);
  };
  const restart = (keep: S[] = []) => {
    setSeen(new Set(keep));
    setOpen(every[0]!);
  };
  return { ids, open, seen, show, next, goTo, restart };
}

// One step of the guide: open with its fields and "Next"; done, as a line with "Change"; to come,
// its title with "Open" (an optional one with its line too). Its fields stay mounted while it is
// folded (what was typed or tried stays).
export function GuideStep<S extends string>({ guide, id, n, title, summary, problems, about, waiting, optional, children }: {
  guide: Guide<S>;
  id: S;
  n: number;
  title: string;
  summary: ReactNode;
  problems: number; // left in this step
  about?: ReactNode;
  waiting?: boolean; // no "Next" yet (no kind chosen)
  optional?: boolean; // Next passes over it: its line shows before it is opened
  children: ReactNode;
}) {
  const isOpen = guide.open === id;
  const seen = guide.seen.has(id);
  const last = guide.ids.at(-1) === id;
  const state = isOpen ? 'current' : seen ? 'done' : 'pending';
  const toFix = seen && problems > 0 ? <span className="badge accent">{problems} to fix</span> : null;
  const body = `guide-step-${id}`;
  return (
    <NumberedStep n={n} state={state} title={title}
      toggle={isOpen ? undefined : (
        <button type="button" className="link-button guide-change" aria-label={`${seen ? 'Change' : 'Open'}: ${title}`} aria-expanded={false} aria-controls={body} onClick={() => guide.show(id)}>
          {seen ? 'Change' : 'Open'}
        </button>
      )}>
      {!isOpen && (seen || optional) && <div className="guide-summary">{summary}{toFix}</div>}
      <div id={body} hidden={!isOpen} className="guide-step-fields">
        {about && <p className="hint">{about}</p>}
        {children}
        {!waiting && (
          <div className="row guide-next">
            <button type="button" className="primary" onClick={() => guide.next(id, problems)}>
              {seen && problems ? (last ? 'Done anyway' : 'Next anyway') : last ? 'Done' : 'Next'}
            </button>
            {toFix}
          </div>
        )}
      </div>
    </NumberedStep>
  );
}

// An optional part of a step, folded to its title and a line saying what it has, until opened. Its
// fields stay mounted while folded.
export function Fold({ title, summary, initiallyOpen = false, children }: { title: string; summary: ReactNode; initiallyOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(initiallyOpen);
  const id = useId();
  return (
    <div className={`guide-fold${open ? ' open' : ''}`}>
      <button type="button" className="guide-fold-head" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <span className="guide-fold-arrow" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <strong>{title}</strong>
        {!open && <span className="guide-fold-summary">{summary}</span>}
      </button>
      <div id={id} hidden={!open} className="guide-fold-body">{children}</div>
    </div>
  );
}

// The kinds of item, as cards: the first step's choice.
export interface KindCard<K extends string> {
  id: K;
  title: string;
  about: string;
  example?: string;
}
export function KindCards<K extends string>({ kinds, kind, label, onChoose }: { kinds: readonly KindCard<K>[]; kind: K | undefined; label: string; onChoose: (k: K) => void }) {
  return (
    <div className="kind-cards" role="radiogroup" aria-label={label}>
      {kinds.map((k) => (
        <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} className="kind-card" onClick={() => onChoose(k.id)}>
          <strong>{k.title}</strong>
          <span className="muted small">{k.about}</span>
          {k.example && <span className="muted small kind-card-example">e.g. {k.example}</span>}
        </button>
      ))}
    </div>
  );
}

// A question asked inline before a click replaces what the user wrote. The safe answer has the focus:
// Enter keeps what is there.
export interface Asking {
  question: string;
  action: string;
  run: () => void;
}
export function InlineAsk({ asking, onDone }: { asking: Asking | undefined; onDone: () => void }) {
  if (!asking) return null;
  return (
    <p className="inline-confirm" role="group" aria-label={asking.question}>
      {asking.question}
      <button type="button" className="danger" onClick={() => { onDone(); asking.run(); }}>{asking.action}</button>
      <button type="button" autoFocus onClick={onDone}>Keep it</button>
    </p>
  );
}

// The problems of a field, beside it (empty until its step has been gone through).
export function FieldProblems({ problems }: { problems: string[] }) {
  return problems.length ? <ul className="problems field-problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul> : null;
}

// The problems of a field, if its step shows them yet: `stepOf` tells the step of a field.
export function problemsAt<F extends string, S extends string>(issues: { field: F; text: string }[], seen: ReadonlySet<S>, stepOf: (field: F) => S) {
  return (field: F) => (seen.has(stepOf(field)) ? issues.filter((i) => i.field === field).map((i) => i.text) : []);
}
export type ProblemsAt<F extends string = string> = (field: F) => string[];

// A text box for a template, with values (the tool's inputs, {value}, {input}) as chips that insert
// themselves where the caret is.
export function TemplateInput({ value, onChange, chips, label, placeholder, rows, className }: {
  value: string;
  onChange: (value: string) => void;
  chips: string[];
  label: string;
  placeholder?: string;
  rows?: number; // a text area
  className?: string;
}) {
  const box = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const insert = (chip: string) => {
    const el = box.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + chip + value.slice(end));
    // After React writes the value: the caret after what was put in.
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + chip.length, start + chip.length);
    });
  };
  const props = { ref: box, 'aria-label': label, className: `mono ${className ?? ''}`.trim(), value, placeholder, onChange: (e: { target: { value: string } }) => onChange(e.target.value) };
  return (
    <div className="template-input">
      {rows ? <textarea rows={rows} {...props} /> : <input {...props} />}
      {chips.length > 0 && (
        <div className="row insert-chips" role="group" aria-label={`Insert into ${label}`}>
          <span className="muted small">Insert:</span>
          {chips.map((c) => (
            <button key={c} type="button" className="insert-chip mono" onClick={() => insert(c)}>{c}</button>
          ))}
        </div>
      )}
    </div>
  );
}
