// Trying an action from its editor, unsaved.
import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { answersInJson, pageTextNames, type WidgetAction } from '../../widget/actions';
import { hasSteps, type StepTrace } from '../../widget/steps';
import type { ActionConfirm, CardDecision, WidgetRunReply } from '../../widget/protocol';
import { runAction } from '../../widget/client';
import { Markdown } from '../Markdown';

// Runs the action as it is in the editor, unsaved, with a value typed here, and shows its boxes;
// the model's answer as it comes.
// `upTo`: run only its first steps (a step's "Try up to here"), each time `run` changes.
// `onTried`: a line saying how the last whole run went (not one up to a step).
export function TryAction({ action, upTo, onTried, legend = 'Try' }: { action: WidgetAction; upTo?: { steps: number; run: number }; onTried?: (line: string) => void; legend?: string }) {
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [reply, setReply] = useState<WidgetRunReply | null>(null);
  const [live, setLive] = useState({ reasoning: '', text: '' });
  const [asking, setAsking] = useState<{ request: ActionConfirm; decide: (d: CardDecision) => void } | null>(null);
  // With steps, or reading {{page}}: the tab it runs on (its values read there); each step as it goes.
  const steps = hasSteps(action);
  const onTab = steps || pageTextNames(action).length > 0;
  const [tabs, setTabs] = useState<{ id: number; title: string }[]>([]);
  const [tabId, setTabId] = useState<number>();
  const [trace, setTrace] = useState<StepTrace[]>([]);
  useEffect(() => {
    if (!onTab) return;
    void browser.tabs.query({ url: ['http://*/*', 'https://*/*'] }).then((all) => {
      const open = all.filter((t) => t.id !== undefined).map((t) => ({ id: t.id!, title: `${t.title ?? ''} — ${t.url ?? ''}` }));
      setTabs(open);
      setTabId((id) => id ?? all.find((t) => t.active)?.id ?? open[0]?.id);
    });
  }, [onTab]);
  const box = useRef<HTMLFieldSetElement>(null);
  // One run at a time: a new one stops the one before, and closing the editor stops it.
  const run = useRef<AbortController>(undefined);
  useEffect(() => () => run.current?.abort(), []);
  const tryIt = async (tried = action, whole = true) => {
    run.current?.abort();
    const own = (run.current = new AbortController());
    setAsking(null);
    setRunning(true);
    setReply(null);
    setTrace([]);
    setLive({ reasoning: '', text: '' });
    const r = await runAction({ action: tried, input, ...(onTab && tabId !== undefined && { tabId }) }, {
      onStep: (step) => setTrace((t) => [...t.filter((x) => x.i !== step.i), step].sort((a, b) => a.i - b.i)),
      onDelta: (kind, text) => setLive((l) => ({ ...l, [kind]: l[kind] + text })),
      // A write is asked here, as the card would.
      onConfirm: (request) => new Promise((resolve) => setAsking({ request, decide: (d) => (setAsking(null), resolve(d)) })),
    }, own.signal);
    if (own.signal.aborted && run.current !== own) return; // another run took its place
    const got = r ?? { error: 'No answer from the extension.' };
    setReply(got);
    setRunning(false);
    if (whole) onTried?.('error' in got ? `Tried: ${got.error}` : 'Tried: it answered');
  };
  // Up to a step: its value shown whole, no badge.
  useEffect(() => {
    if (!upTo || !action.steps) return;
    const upToSteps = action.steps.slice(0, upTo.steps);
    box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    void tryIt({ ...action, when: undefined, steps: upToSteps, outputs: [{ label: upToSteps.at(-1)!.name }], badge: undefined }, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when asked again
  }, [upTo?.run]);
  return (
    <fieldset className="settings-block" ref={box}>
      <legend>{legend}</legend>
      {onTab && (
        <label>The tab it runs on (what it reads is read there; its tools act there)
          <select value={tabId ?? ''} onChange={(e) => setTabId(Number(e.target.value))}>
            {tabs.map((t) => <option key={t.id} value={t.id}>{t.title.slice(0, 120)}</option>)}
          </select>
        </label>
      )}
      <div className="row">
        {action.input !== 'none' && <input aria-label="Input to try" value={input} placeholder={action.placeholder ?? 'what the action takes'} onChange={(e) => setInput(e.target.value)} />}
        <button disabled={!(action.tool || action.prompt?.trim() || steps) || running || (action.input !== 'none' && !input.trim())} onClick={() => void tryIt()}>{running ? 'Running…' : 'Try'}</button>
      </div>
      {asking && (
        <div className="custom-param">
          <strong>{asking.request.summary}</strong>
          {asking.request.details?.map((d, i) => <div key={i}><span className="muted small">{d.label}</span>{d.code ? <pre className="widget-text">{d.value}</pre> : <div>{d.value}</div>}</div>)}
          <div className="row">
            <button className="primary" onClick={() => asking.decide('allow')}>Allow</button>
            {asking.request.host && <button onClick={() => asking.decide('always')}>Always on {asking.request.host}</button>}
            <button onClick={() => asking.decide('deny')}>Deny</button>
          </div>
        </div>
      )}
      {trace.length > 0 && <StepsTrace trace={trace} />}
      {live.reasoning && <details className="reasoning"><summary>Reasoning</summary><pre className="widget-text">{live.reasoning}</pre></details>}
      {running && live.text && !answersInJson(action) && !steps && <Markdown text={live.text} foldable />}
      {reply && ('error' in reply ? (
        <p className="error-text">{reply.error}</p>
      ) : (
        <div className="widget-try">
          {reply.badge && <p>Badge on the bubble: <strong>{reply.badge}</strong></p>}
          {reply.outputs.map((o, i) => (
            <div key={i}>
              <div className="field-label">{o.label}</div>
              {o.lines.length ? (
                <ul>{o.lines.map((l, j) => <li key={j}>{l.href ? <a href={l.href} target="_blank" rel="noopener noreferrer">{l.text}</a> : l.text}</li>)}</ul>
              ) : o.text ? (
                <Markdown text={o.text} foldable />
              ) : (
                <p className="muted">Nothing.</p>
              )}
            </div>
          ))}
        </div>
      ))}
    </fieldset>
  );
}

const shown = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 1));

// Each step: what it was given and what it gave, or why it stopped.
function StepsTrace({ trace }: { trace: StepTrace[] }) {
  return (
    <div className="widget-try">
      {trace.map((t) => (
        <details key={t.i} open={t.status !== 'done' || t.kind !== 'model'}>
          <summary>
            {t.status === 'done' ? '✓' : t.status === 'error' ? '✗' : '…'} <span className={`badge step-kind step-${t.kind}`}>{t.kind}</span> <strong>{t.name}</strong>
            {t.attempt ? ` (asked again)` : ''}
            {t.ms !== undefined && <span className="muted small"> {t.ms} ms</span>}
            {t.of !== undefined && <span className="muted small"> (the first {t.calls?.length} of {t.of} items)</span>}
          </summary>
          {t.sent !== undefined && <><div className="field-label">{t.kind === 'read' ? 'Read' : t.kind === 'tool' ? 'Arguments' : 'Prompt'}</div><pre className="widget-text">{shown(t.sent)}</pre></>}
          {t.value !== undefined && <><div className="field-label">{t.status === 'done' ? 'Gives' : 'Answered'}</div><pre className="widget-text">{shown(t.value)}</pre></>}
          {t.calls?.map((c, j) => (
            <div key={j} className="custom-param step step-tool">
              <div><span className="badge step-kind">tool</span> <code>{c.tool}</code> {c.error ? '✗' : c.value !== undefined ? '✓' : '…'}</div>
              <pre className="widget-text">{shown(c.args)}</pre>
              {c.value !== undefined && <pre className="widget-text">{shown(c.value).slice(0, 2000)}</pre>}
              {c.error && <p className="error-text">{c.error}</p>}
            </div>
          ))}
          {t.error && <p className="error-text">{t.error}</p>}
        </details>
      ))}
    </div>
  );
}
