// The cards that ask you in the chat: allow an action, allow reading a site, what a user tool asks, or
// whether a sub-agent out of steps goes on.
import { useLayoutEffect, useRef, useState } from 'react';
import type { AccessRequest, ActionDetail } from '../../core/types';
import type { Decision } from '../../policy/engine';
import { MenuButton } from '../../ui/MenuButton';
import { useSeen } from '../../ui/useSeen';
import type { Agent, Confirmation } from './useAgent';
import { UserCard } from './UserCards';
import { askOrigins } from '../../ui/ask-permission';
import { isEnter } from '../../ui/enter';
import { ADDED, REMOVED } from '../../tools/line-diff';

// The questions waiting for you, each as its card.
export function ConfirmationCards({ agent }: { agent: Pick<Agent, 'confirmations' | 'respond' | 'respondAccess' | 'respondUser' | 'respondMore'> }) {
  const { confirmations, respond, respondAccess, respondUser, respondMore } = agent;
  return (
    <>
      {confirmations.map((c) =>
        c.kind === 'action' ? (
          <ConfirmCard key={c.id} confirmation={c} onDecide={(d, comment, edits) => respond(c.id, d, comment, edits)} />
        ) : c.kind === 'access' ? (
          <AccessCard key={c.id} request={c} onDecide={(granted) => respondAccess(c.id, granted)} />
        ) : c.kind === 'more-steps' ? (
          <MoreStepsCard key={c.id} request={c} onDecide={(more) => respondMore(c.id, more)} />
        ) : (
          <UserCard key={c.id} request={c.request} onReply={(reply) => respondUser(c.id, reply)} />
        ),
      )}
    </>
  );
}

// A field longer than this goes in a box of its own, under its label: where it starts and ends shows.
const BOXED_FROM = 20;

// The comment, if any, goes to the model with whichever answer: why it was denied, or what to do next.
// A save's main fields can be edited first (ActionDetail.edit): Allow sends the values changed. Asked
// again because they could not be saved, it opens editing them, saying why.
function ConfirmCard({ confirmation, onDecide }: { confirmation: Extract<Confirmation, { kind: 'action' }>; onDecide: (d: Decision, comment: string, edits?: Record<string, string>) => void }) {
  const { summary, details = [], host, agent, problem, edited } = confirmation;
  const [comment, setComment] = useState('');
  const editable = details.some((d) => d.edit);
  const [editing, setEditing] = useState(Boolean(edited));
  const [values, setValues] = useState<Record<string, string>>(edited ?? {});
  const seen = useSeen();
  const changed = () => {
    const edits = Object.fromEntries(details.flatMap(({ edit }) => (edit && values[edit.field] !== undefined && values[edit.field] !== edit.value ? [[edit.field, values[edit.field]!]] : [])));
    return Object.keys(edits).length ? edits : undefined;
  };
  const decide = (d: Decision) => (seen || d === 'deny') && onDecide(d, comment.trim(), editing && d !== 'deny' ? changed() : undefined);
  const cancelEditing = () => {
    setValues({});
    setEditing(false);
  };
  const shown = editing ? details : details.filter((d) => !d.editOnly);
  return (
    <div className="confirm" role="alertdialog" aria-label="Confirm action">
      <div className="confirm-title">{agent && <span className="confirm-agent">{agent}: </span>}Allow this action{host ? ` on ${host}` : ''}?</div>
      {/* One field per row, the action first; code (a text, a template) and long values in a block of their own. */}
      <dl className="confirm-details">
        <div className="confirm-action">
          <dt>Action</dt>
          <dd>{summary}</dd>
        </div>
        {shown.map((d, i) => {
          const edit = editing && d.edit;
          const boxed = edit ? Boolean(edit.lines) : d.code || d.diff || d.value.length > BOXED_FROM;
          return (
            <div key={i} className={boxed ? 'code' : undefined}>
              <dt>{d.label}</dt>
              <dd>
                {edit ? (
                  <FieldInput label={d.label} edit={edit} code={d.code} value={values[edit.field] ?? edit.value} onChange={(v) => setValues({ ...values, [edit.field]: v })} />
                ) : boxed ? <FieldBox value={d.value} code={d.code} diff={d.diff} /> : d.value}
              </dd>
            </div>
          );
        })}
      </dl>
      {problem && <div className="confirm-problem" role="alert">{problem}</div>}
      <input className="confirm-comment" value={comment} placeholder="Comment for the model (optional)…" aria-label="Comment for the model"
        onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => isEnter(e) && e.preventDefault()} />
      <div className="row">
        <button className="primary" disabled={!seen} onClick={() => decide('allow')}>Allow</button>
        {host && (
          <MenuButton label={`Allow on ${host}`} disabled={!seen} items={[
            { label: 'In this conversation', onSelect: () => decide('session') },
            { label: 'Always (site policy)', onSelect: () => decide('always') },
          ]} />
        )}
        {editable && (editing ? <button onClick={cancelEditing}>Cancel editing</button> : <button onClick={() => setEditing(true)}>Edit</button>)}
        <button className="danger" onClick={() => decide('deny')}>Deny</button>
      </div>
      {!seen && <NotSeen />}
    </div>
  );
}

// A field being edited: one line in an input, a list (one per line) or a long text in a box that grows with it.
function FieldInput({ label, edit, code, value, onChange }: { label: string; edit: NonNullable<ActionDetail['edit']>; code?: boolean; value: string; onChange: (v: string) => void }) {
  if (!edit.lines) return <input className="confirm-input" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => isEnter(e) && e.preventDefault()} />;
  return (
    <textarea className={`confirm-input${code ? ' code' : ''}`} aria-label={label} value={value} spellCheck={!code}
      placeholder={edit.lines === 'list' ? 'One per line' : undefined} onChange={(e) => onChange(e.target.value)} />
  );
}

// A diff's lines (tools/line-diff) colored by their mark: added, removed, or kept.
const diffLines = (value: string) =>
  value.split('\n').map((line, i) => (
    <div key={i} className={line.startsWith(ADDED) ? 'diff-added' : line.startsWith(REMOVED) ? 'diff-removed' : undefined}>{line}</div>
  ));

// A long field in its box: past about six lines it is collapsed, with a button to show it all (no
// scrolling inside the card). Measured, not counted: lines depend on the panel's width.
function FieldBox({ value, code, diff }: { value: string; code?: boolean; diff?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box || open) return;
    const measure = () => setOverflows(box.scrollHeight > box.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [value, open]);
  return (
    <>
      <div ref={ref} className={`confirm-box${code || diff ? ' code' : ''}${open ? '' : ' collapsed'}${overflows && !open ? ' clipped' : ''}`}>{diff ? diffLines(value) : value}</div>
      {(overflows || open) && (
        <button type="button" className="link-button confirm-box-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Show less' : 'Show all'}
        </button>
      )}
    </>
  );
}

// The agent needs to read a site the extension has no access to. "Allow" opens the browser's
// permission prompt, which only a click in an extension page can do.
function AccessCard({ request, onDecide }: { request: AccessRequest; onDecide: (granted: boolean) => void }) {
  const seen = useSeen();
  const allow = () =>
    seen && void askOrigins(request.origin).then(onDecide);
  return (
    <div className="confirm" role="alertdialog" aria-label="Allow reading a site">
      <div className="confirm-title">Allow reading {request.site}?</div>
      <div className="confirm-summary">{request.reason ?? `The agent wants to read the tab “${request.title}”.`}</div>
      <div className="row">
        <button className="primary" disabled={!seen} onClick={allow}>Allow reading {request.site}</button>
        <button className="danger" onClick={() => onDecide(false)}>Deny</button>
      </div>
      {!seen && <NotSeen />}
    </div>
  );
}

// A sub-agent stopped at its step limit, unfinished: Continue runs it on where it was, with as many
// steps again; Stop gives its caller what it has (also what stopping the chat does).
function MoreStepsCard({ request, onDecide }: { request: Extract<Confirmation, { kind: 'more-steps' }>; onDecide: (more: boolean) => void }) {
  return (
    <div className="confirm" role="alertdialog" aria-label="Continue the agent">
      <div className="confirm-title"><span className="confirm-agent">{request.agent}: </span>stopped after {request.steps} rounds of tool calls without finishing.</div>
      <div className="confirm-summary">Continue lets it go on for {request.steps} more; Stop gives what it has to the agent that asked it.</div>
      <div className="row">
        <button className="primary" onClick={() => onDecide(true)}>Continue</button>
        <button onClick={() => onDecide(false)}>Stop</button>
      </div>
    </div>
  );
}

const NotSeen = () => <div className="confirm-note">Allowing works only while the chat is in full view: nothing over it, not see-through.</div>;
