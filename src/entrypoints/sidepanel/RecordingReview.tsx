// A recording of the page's requests, reviewed before it goes (useRecording): a head with what it holds,
// then sections that each say where they stand (the calls ticked, the private values, what the model gets
// and its size), and the actions kept in view at the bottom. Make a tool… opens a step of its own first:
// what changes each time the tool runs (its variables).
import { Icon } from '../../ui/chat-icons';
import { useDeferredValue, useMemo, useState } from 'react';
import { hiddenLabel, hideValue, prettyBody, recordedCalls, showValue, shownUrl, withHidden, type RecordedCall, type Recording } from '../../recording/recording';
import { kindsFor, routeText, variablesOf, type Variable, type VariableEdit, type VariableKind } from '../../recording/variables';
import { Chip } from '../../ui/Chip';
import { grouped, reasonOf, reasonsOf, resolved, type Reason } from '../../recording/sensitive';
import { defaultName, domainsOf, hideNamed, privacySummary, riskyKey, shortChars, valuesOf } from '../../recording/review';
import { recordingPreview } from '../../recording/block';
import { hostOf, plural, secondsSince } from '../../core/util';
import { savePendingSecret } from '../../recording/pending-secrets';
import type { RecordedStep } from '../../recording/step-types';
import { matchesSearch, parseSearch } from '../../recording/search';

const MIN_HIDDEN = 3;
const NEAR_LIMIT = 0.8; // of the limit: the size turns to a warning

// `onMakeTool`: attaches it, with a message asking for a tool that makes its calls; `anotherWaits`: one
// stopped meanwhile, which opens once this review ends.
export function RecordingReview({ recording: r, anotherWaits = false, onChange, onAttach, onMakeTool, onDiscard }: { recording: Recording; anotherWaits?: boolean; onChange: (r: Recording) => void; onAttach: () => void; onMakeTool: () => void; onDiscard: () => void }) {
  const [toolStep, setToolStep] = useState(false);
  const [filter, setFilter] = useState('');
  const terms = useMemo(() => parseSearch(filter), [filter]);
  const shown = r.calls.filter((c) => matchesSearch(c, terms));
  const tick = (ids: string[], included: boolean) => onChange({ ...r, calls: r.calls.map((c) => (ids.includes(c.id) ? { ...c, included } : c)) });
  // The text selected in the panel, hidden in every call; what went wrong otherwise.
  const hideSelected = (): string => {
    const value = String(getSelection() ?? '').trim();
    if (!value) return 'Select a value in a call first.';
    // A letter or two would be hidden in every word.
    if (value.length < MIN_HIDDEN) return `Select at least ${MIN_HIDDEN} characters.`;
    onChange(hideValue(r, value));
    return '';
  };
  const ticked = recordedCalls(r);
  // The model's numbers (#1, #2…): the calls ticked, in order.
  const numbers = new Map(ticked.map((c, i) => [c.id, i + 1]));
  const privacy = useMemo(() => privacySummary(r), [r]);
  const vars = useMemo(() => variablesOf(r), [r]);
  // Without variables there is nothing to choose: the tool makes the calls as recorded.
  const makeTool = () => (vars.length ? setToolStep(true) : onMakeTool());
  if (toolStep) return <ToolStep r={r} ticked={ticked} vars={vars} onChange={onChange} onBack={() => setToolStep(false)} onMakeTool={onMakeTool} />;
  return (
    <div className="overlay-panel recording-review" role="dialog" aria-label="Recording review">
      <div className="recording-head">
        <strong className="recording-title"><Icon name="record" /> Recording · {r.site}</strong>
        <div className="recording-meta muted small">{plural(r.calls.length, 'call')} · {secondsSince(r)} s{r.preset ? ` · ${r.preset}` : ''}{r.leftOut ? ` · ${r.leftOut} left out` : ''}</div>
        {r.stopped && <div className="muted small">Stopped by itself: {r.stopped}.</div>}
      </div>
      {anotherWaits && <p className="recording-waits" role="status">Another recording waits for review: it opens when you finish this one.</p>}
      <div className="recording-sections">
        {(r.notes ?? []).map((n) => <p key={n} className="hint">{n}</p>)}
        <details className="recording-section" data-section="calls" open>
          <summary><strong>Calls</strong><span className="muted small">{ticked.length} of {r.calls.length} ticked</span></summary>
          <div className="recording-tools">
            <input type="search" placeholder="Filter calls… (method:POST, -domain:…)" aria-label="Filter calls" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <button onClick={() => tick(shown.map((c) => c.id), true)}>Tick shown</button>
            <button onClick={() => tick(shown.map((c) => c.id), false)}>Untick shown</button>
          </div>
          <Domains calls={r.calls} />
          {!r.calls.length && <p className="hint">The page made no calls while recording.</p>}
          {inOrder(shown, terms.length ? [] : (r.steps ?? [])).map((item) =>
            'kind' in item ? <Step key={`s${item.at}${item.kind}${item.target ?? ''}`} step={item} />
            : <Call key={item.id} call={item} n={numbers.get(item.id)} r={r} onTick={(on) => tick([item.id], on)} onChange={onChange} onHideSelected={hideSelected} />)}
        </details>
        <details className="recording-section" data-section="privacy">
          <summary><strong>Private values</strong><span className={`small${privacy.warn ? ' warn' : ' muted'}`}>{privacy.text}</span></summary>
          <p className="hint">The model sees a hidden value as ••••, or ••••[name]. Select it in a call, then <strong>Hide selected value</strong>; or open a call's <strong>Values</strong> and click <strong>Hide…</strong>, where <strong>Save it for a tool</strong> keeps it in the extension for a tool's {'{{secret:name}}'}.</p>
          {r.hidden.length > 0 && (
            <div className="recording-hidden">
              {r.hidden.map((v) => (
                <Chip key={v} remove={{ label: `Show ${v} again`, title: 'Show it again', onClick: () => onChange(showValue(r, v)) }}>
                  {r.hiddenNames?.[v] ? `${r.hiddenNames[v]}: ` : ''}{v.length > 40 ? `${v.slice(0, 40)}…` : v}
                </Chip>
              ))}
            </div>
          )}
        </details>
        <ModelPreview r={r} tool={false} />
      </div>
      <div className="recording-actions">
        <div className="recording-buttons">
          <button className="primary" onClick={onAttach} disabled={!ticked.length}>Attach {plural(ticked.length, 'call')}</button>
          <button onClick={makeTool} disabled={!ticked.length} title="Choose what changes each time the tool runs, then attach it with a message asking the model for the tool">Make a tool…</button>
          <span className="spacer" />
          <button className="link-button small" onClick={onDiscard}>Discard</button>
        </div>
        <div className="hint">Nothing is sent until you send your message.</div>
      </div>
    </div>
  );
}

// What the model gets, exactly: the block as sent, its size against the limit, and how many calls go
// without their bodies. `tool`: with its variables (Make a tool…). The block is built again only when
// the recording changes, and after the change shows: a big one is a multi-MB build, and a tick or a
// variable's name typed must not wait for it.
function ModelPreview({ r, tool }: { r: Recording; tool: boolean }) {
  const shown = useDeferredValue(r);
  const preview = useMemo(() => recordingPreview({ ...shown, tool }), [shown, tool]);
  return (
    <details className="recording-section" data-section="model">
      <summary>
        <strong>What the model gets</strong>
        <span className={`small${preview.cut || preview.size > preview.max * NEAR_LIMIT ? ' warn' : ' muted'}`}>
          {shortChars(preview.size)} of {shortChars(preview.max)} characters{preview.cut ? ` · ${plural(preview.cut, 'call')} without their bodies` : ''}
        </span>
        <meter className="recording-size" min={0} max={preview.max} low={preview.max * NEAR_LIMIT} high={preview.max} optimum={0} value={Math.min(preview.size, preview.max)} />
      </summary>
      <p className="hint">Exactly what goes with your message, hidden values as the model sees them. Its limit is in Settings → Limits.</p>
      <pre className="recording-preview">{preview.text}</pre>
    </details>
  );
}

// The groups of the Make a tool step: what happens to a value when the tool runs.
const GROUPS: { title: string; kinds: VariableKind[] }[] = [
  { title: "You give it each time · the tool's inputs", kinds: ['parameter'] },
  { title: 'The tool fills them in', kinds: ['answer', 'computed'] },
  { title: 'Always as recorded', kinds: ['fixed'] },
];

// Make a tool…, before the recording is attached: the calls ticked (the numbers the variables use), the
// variables by what happens to them when the tool runs, each renamed or of another kind, and what the
// model gets with them. Each variable takes two lines, to fit the side panel.
function ToolStep({ r, ticked, vars, onChange, onBack, onMakeTool }: { r: Recording; ticked: RecordedCall[]; vars: Variable[]; onChange: (r: Recording) => void; onBack: () => void; onMakeTool: () => void }) {
  const edit = (value: string, change: VariableEdit) => onChange({ ...r, vars: { ...r.vars, [value]: { ...r.vars?.[value], ...change } } });
  return (
    <div className="overlay-panel recording-review" role="dialog" aria-label="Make a tool">
      <div className="recording-head">
        <strong className="recording-title">
          <button className="icon-button" aria-label="Back to the review" title="Back to the review" onClick={onBack}><Icon name="back" /></button> Make a tool · what changes each run
        </strong>
        <div className="recording-meta muted small">Recording · {r.site} · {plural(ticked.length, 'call')}</div>
      </div>
      <div className="recording-sections">
        <div className="recording-section" data-section="variables">
          <ol className="recording-call-list mono small">
            {ticked.map((c, i) => <li key={c.id}>#{i + 1} {c.method} {withHidden(shownUrl(c.url, r.site), r.hidden, r.hiddenNames)}</li>)}
          </ol>
          {GROUPS.map((g) => {
            const shown = vars.filter((v) => g.kinds.includes(v.kind));
            return shown.length > 0 && (
              <div key={g.title}>
                <div className="recording-var-group small">{g.title}</div>
                {shown.map((v) => (
                  <div className="recording-var" key={v.value}>
                    <div className="recording-var-line">
                      <input className="mono" aria-label={`Name of ${v.value}`} value={r.vars?.[v.value]?.name ?? v.name} onChange={(e) => edit(v.value, { name: e.target.value })} />
                      <select aria-label={`Kind of ${v.name}`} value={v.kind} onChange={(e) => edit(v.value, { kind: e.target.value as VariableKind })}>
                        {kindsFor(v).map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                      </select>
                    </div>
                    <div className="recording-var-line small">
                      <span className="mono recording-var-value" title={v.value}>{v.value}</span>
                      <span className="muted">{routeText(v)}</span>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        <ModelPreview r={r} tool />
      </div>
      <div className="recording-actions">
        <div className="recording-buttons">
          <button onClick={onBack}>Back</button>
          <span className="spacer" />
          <button className="primary" onClick={onMakeTool} title="Attaches it with a message asking the model for a tool that makes these calls: you send it, or change it first">Make the tool</button>
        </div>
        <div className="hint">Nothing is sent until you send your message.</div>
      </div>
    </div>
  );
}

// The sites the recording touched, with how many calls each.
function Domains({ calls }: { calls: RecordedCall[] }) {
  const domains = domainsOf(calls);
  if (domains.length < 2) return null;
  return (
    <p className="recording-domains small">
      Sites:{' '}
      {domains.map((d, i) => (
        <span key={d.host}>{i ? ', ' : ''}<span className="recording-host">{d.host}</span> {d.calls}</span>
      ))}
    </p>
  );
}

// The calls and the user's steps (a tab change, a click, typing), in the order they happened.
const inOrder = (calls: RecordedCall[], steps: RecordedStep[]): (RecordedCall | RecordedStep)[] => [...calls, ...steps].sort((x, y) => x.at - y.at);

function Step({ step: s }: { step: RecordedStep }) {
  const text =
    s.kind === 'tab' ? `→ ${s.target ?? 'another tab'}`
    : s.kind === 'click' ? `Clicked ${s.target ?? 'the page'}`
    : s.text === undefined ? `Typed into ${s.target ?? 'a field'} (text not kept)`
    : `Typed "${s.text}" into ${s.target ?? 'a field'}`;
  return <div className={`recording-step${s.kind === 'tab' ? ' recording-tab' : ''}`}>{s.kind === 'tab' ? <strong>{text}</strong> : <span className="muted small">{text}</span>}</div>;
}

const REASON: Record<Reason['kind'], string> = {
  'secret-key': 'a secret-looking key', card: 'a card number', email: 'an email', phone: 'a phone number', ip: 'an IP address', token: 'a token',
  unread: 'named fields the review cannot read: read the body yourself before ticking, or hide it whole',
  'auth-header': 'sends your Authorization header (its value is not kept)', 'cookie-header': 'sends your cookies (their value is not kept)',
};
const times = (n: number) => (n > 1 ? ` ×${n}` : '');

// `n`: its number for the model, when ticked; `onHideSelected`: hides the text selected, or says what is wrong.
function Call({ call: c, n, r, onTick, onChange, onHideSelected }: { call: RecordedCall; n?: number; r: Recording; onTick: (on: boolean) => void; onChange: (r: Recording) => void; onHideSelected: () => string }) {
  const [tab, setTab] = useState<'request' | 'response' | 'values'>('request');
  const url = withHidden(shownUrl(c.url, r.site), r.hidden, r.hiddenNames);
  // Every call says its site: a recording across tabs touches several.
  const host = hostOf(c.url);
  const path = withHidden(shownUrl(c.url, host), r.hidden, r.hiddenNames);
  // Worked out again only when the call changes (each network event re-renders the list).
  const reasons = useMemo(() => reasonsOf(c, c.headerNames), [c]);
  const values = reasons.filter((x) => 'value' in x);
  const notes = reasons.filter((x) => !('value' in x));
  const ok = resolved(reasons, r.hidden);
  const mark = values.length ? (ok ? '✓' : '⚠') : notes.length ? 'ⓘ' : '';
  return (
    <details className={`recording-call${c.included ? '' : ' off'}`}>
      <summary>
        <input type="checkbox" checked={c.included} aria-label={`Send ${c.method} ${url}`} onClick={(e) => e.stopPropagation()} onChange={(e) => onTick(e.target.checked)} />
        <span className="muted small recording-n">{n ? `#${n}` : ''}</span>
        <span className="mono recording-method">{c.method}</span>
        <span className="recording-host">{host}</span>
        <span className="mono recording-url" title={c.url}>{path}</span>
        <span className="muted small">{c.status ?? (c.error ? 'failed' : '…')}</span>
        {mark && <span className={`recording-mark${mark === '⚠' ? ' warn' : ''}`} title={mark === '⚠' ? 'Looks sensitive: hide its values or leave it out' : mark === '✓' ? 'Its sensitive values are hidden' : 'A note'}>{mark}</span>}
      </summary>
      {values.length > 0 && (
        <p className={`recording-why${ok ? '' : ' warn'}`}>
          {ok ? '✓ Resolved: ' : '⚠ Looks sensitive: '}
          {grouped(values).map((x) => `${REASON[x.kind]} (${x.where})${times(x.count)}`).join(', ')}.{ok ? '' : ' Hide them in Values, or leave the call out.'}
        </p>
      )}
      {grouped(notes).map((x) => <p key={`${x.kind} ${x.where}`} className="hint">ⓘ {REASON[x.kind]}{x.kind === 'ip' && ` (${x.where})${times(x.count)}`}</p>)}
      <div className="recording-tabs" role="tablist">
        {(['request', 'response', 'values'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t[0]!.toUpperCase() + t.slice(1)}</button>
        ))}
      </div>
      {tab === 'request' && (c.requestBody ? <Body label="Sent" text={c.requestBody} r={r} onHideSelected={onHideSelected} /> : <p className="hint">Nothing sent but the URL.</p>)}
      {tab === 'response' && (c.frames ? <Body label="Frames" text={c.frames.map((f) => `${f.dir === 'sent' ? '→' : '←'} ${f.text}`).join('\n')} r={r} onHideSelected={onHideSelected} />
        : c.responseBody !== undefined ? <Body label={`Answer${c.responseType ? ` · ${c.responseType}` : ''}`} text={c.responseBody} r={r} onHideSelected={onHideSelected} />
        : <p className="hint">Answer not seen (binary, or made before the page was hooked).</p>)}
      {tab === 'values' && <CallValues call={c} r={r} onChange={onChange} />}
    </details>
  );
}

// Every value of a call, each hidden (••••) under a name on request: hidden in every call, and a
// tool built from the recording takes it from the user ({{secret:name}}), never from the model.
function CallValues({ call: c, r, onChange }: { call: RecordedCall; r: Recording; onChange: (r: Recording) => void }) {
  const [naming, setNaming] = useState<{ value: string; name: string; save: boolean; risky: boolean }>();
  // A password or a card number is better not saved, even for a tool.
  const risky = (key: string, value: string) => riskyKey(key) || reasonOf(key, value) === 'card';
  const values = valuesOf(c).filter((v) => v.value.length >= MIN_HIDDEN);
  if (!values.length) return <p className="hint">No values to hide in this call.</p>;
  return (
    <table className="recording-values">
      <tbody>
        {values.map((v) => {
          const hidden = r.hidden.includes(v.value);
          return (
            <tr key={`${v.where}${v.key}`}>
              <td className="small muted">{v.where}</td>
              <td className="mono">{v.key}</td>
              <td className="mono recording-var-value">{hidden ? hiddenLabel(r.hiddenNames?.[v.value]) : v.value}</td>
              <td>
                {hidden ? <button onClick={() => onChange(showValue(r, v.value))}>Show</button>
                  : naming?.value === v.value ? (
                    <span>
                      <input className="mono" aria-label={`Name of the hidden ${v.key}`} value={naming.name} onChange={(e) => setNaming({ ...naming, name: e.target.value })} />
                      <label className="check small" title="A tool made from this recording sends it as {{secret:name}}: you save it once, the model never sees it">
                        <input type="checkbox" checked={naming.save} onChange={(e) => setNaming({ ...naming, save: e.target.checked })} /> Save it for a tool
                      </label>
                      {naming.risky && <span className="hint warn"> A password or card number: better not saved.</span>}
                      <button onClick={() => {
                        const name = naming.name.trim();
                        onChange(hideNamed(r, v.value, name));
                        if (naming.save && name) void savePendingSecret(name, v.value, r.site);
                        setNaming(undefined);
                      }}>Hide</button>
                    </span>
                  ) : <button title="Hide it in every call: the model sees ••••[name]" onClick={() => { const danger = risky(v.key, v.value); setNaming({ value: v.value, name: defaultName(v.key), save: !danger, risky: danger }); }}>Hide…</button>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// What a call sent or got, with the values hidden; text selected in it is hidden in every call.
function Body({ label, text, r, onHideSelected }: { label: string; text: string; r: Recording; onHideSelected: () => string }) {
  const [note, setNote] = useState('');
  return (
    <div className="recording-body">
      <div className="recording-body-head">
        <span className="muted small">{label}</span>
        <button className="link-button small" title="Hides the text selected below in every call: it does not reach the model" onClick={() => setNote(onHideSelected())}>Hide selected value</button>
        {note && <span className="muted small">{note}</span>}
      </div>
      <pre>{withHidden(prettyBody(text), r.hidden, r.hiddenNames)}</pre>
    </div>
  );
}
