// A custom tool's editor, as a guide: what it is (or a request pasted), then its parts in the order
// they are made (the request before its parameters), a test, and last its name and description for
// the model. Each step folds to a line once done; problems show beside their fields once the user
// has been through them, and the side card counts what is left.
import { useState } from 'react';
import type { ToolInfo } from '../../core/protocol';
import { plural } from '../../core/util';
import { baseParams, customSchema } from '../../tools/custom/runtime';
import { suggestName } from '../../tools/custom/suggest-name';
import { VALUE, type CustomTool, type ParamRule } from '../../tools/custom/types';
import type { IssueField } from '../../tools/custom/validate';
import { customToolStore } from '../../tools/custom/store';
import { toWireName } from '../../core/tool-registry';
import { Code } from '../CodeView';
import { BackToList, EditorFooter, Switch } from '../Collection';
import { Segmented } from '../Segmented';
import { ParamHead } from '../fields';
import { ModelLabel } from '../ToModel';
import { toolGroupLabel } from '../Tools';
import { toolGroup } from '../../core/tool-groups';
import { groupsOf, LabelsEditor } from './Labels';
import { FieldProblems, GuideStep, InlineAsk, KindCards, problemsAt as makeProblemsAt, TemplateInput, useGuide, type Asking, type ProblemsAt } from '../guide';
import { FixedValueInput, HttpEditor, InputsEditor, OwnParams, ScriptCode, ScriptReaches, type SetTyped } from './ParamEditors';
import { RequestParams } from './RequestParams';
import { KINDS, PasteRequest } from './Start';
import { TryRequest, TryScript, TryShortcut } from './Try';
import { useCustomToolDraft, type Kind } from './useCustomToolDraft';

const WHEN = 'with every request, as one of the tools offered';

type StepId = 'start' | 'request' | 'reaches' | 'params' | 'code' | 'test' | 'model' | 'organize';
const EVERY: StepId[] = ['start', 'request', 'reaches', 'params', 'code', 'test', 'model', 'organize'];

// The steps of each kind, in order.
const STEPS: Record<Kind | 'none', StepId[]> = {
  none: ['start'],
  http: ['start', 'request', 'params', 'test', 'model', 'organize'],
  tool: ['start', 'params', 'test', 'model', 'organize'],
  script: ['start', 'reaches', 'params', 'code', 'test', 'model', 'organize'],
};

// The step a field is in, for a kind.
const stepOf = (kind: Kind | undefined) => (field: IssueField): StepId => {
  if (field === 'name' || field === 'description') return 'model';
  if (field === 'base') return 'start';
  if (field === 'code') return 'code';
  if (field.startsWith('input:') || field.startsWith('param:')) return 'params';
  return kind === 'script' ? 'reaches' : 'request';
};

const TITLES: Record<StepId, string> = {
  start: 'What it is',
  request: 'The request',
  reaches: 'What it reaches',
  params: 'What the model fills',
  code: 'The script',
  test: 'Try it',
  model: 'Its name and description, for the model',
  organize: 'Organize (optional)',
};

export function CustomToolEditor({ custom, customs, catalog, onClose }: { custom: CustomTool; customs: CustomTool[]; catalog: ToolInfo[]; onClose: () => void }) {
  const d = useCustomToolDraft(custom, customs, catalog, onClose);
  const ids = STEPS[d.kind ?? 'none'];
  const guide = useGuide(ids, d.isNew, EVERY);
  const [tried, setTried] = useState<string | undefined>();
  const [pasteNote, setPasteNote] = useState<string | undefined>();
  // A request replaced starts its parameters' step afresh (the values its inputs replaced are gone).
  const [requestRound, setRequestRound] = useState(0);
  // What the model is offered is built on the tool it runs; a request or a script has only its own.
  const offeredOn = d.draft.http ? { inputSchema: {} } : d.base;
  const toStep = stepOf(d.kind);
  const problemsAt = makeProblemsAt(d.issues, guide.seen, toStep);
  const left = (id: StepId) => d.issues.filter((i) => toStep(i.field) === id).length;
  const draft = d.draft;
  const step = (id: StepId) => ({ guide, id, n: ids.indexOf(id) + 1, title: TITLES[id], problems: left(id) });

  // What would replace the tool's request, script or parameters, asked first when there are any.
  const [asking, setAsking] = useState<Asking>();
  const hasWork = !!(draft.http?.url.trim() || draft.http?.body || draft.http?.headers?.length || draft.script?.trim() || draft.inputs?.length || Object.keys(draft.params).length || draft.uses?.length);
  const guard = (question: string, action: string, run: () => void) => (hasWork ? setAsking({ question, action, run }) : run());
  const startRequest = (http: NonNullable<CustomTool['http']>, inputs: NonNullable<CustomTool['inputs']>, note?: string) =>
    guard('This replaces its request and parameters as they are now.', 'Replace', () => {
      d.startRequest(http, inputs);
      setRequestRound((n) => n + 1);
      setPasteNote(note);
      setTried(undefined);
      guide.goTo('request', ['start']);
    });
  const chooseKind = (k: Kind) => {
    if (k === d.kind) return;
    const run = () => {
      d.chooseKind(k);
      setTried(undefined);
      guide.restart();
    };
    if (d.kind) guard(`Make it ${KINDS.find((x) => x.id === k)!.title.toLowerCase()}? What it has now for ${KINDS.find((x) => x.id === d.kind)!.title.toLowerCase()} is cleared.`, 'Change it', run);
    else run();
  };

  return (
    <section className="editor custom-tool-editor">
      <BackToList route="custom-tools" title="Custom tools" />
      <div className="custom-editor-head">
        <h3>{d.isNew ? 'New custom tool' : custom.name}</h3>
        <span className="section-head-switch" title="Offered to the model">
          Offered <Switch checked={draft.enabled} label="Offered to the model" onChange={(enabled) => d.patch({ enabled })} />
        </span>
      </div>
      {custom.source && (
        <p className={custom.source.changed ? 'error-text' : 'hint'}>
          {custom.source.changed ? 'Its source changed its request or code: check it before you switch it on. ' : ''}
          From a source (Sources): its next sync replaces what you change here, except your header values, the session and
          read-only.
        </p>
      )}
      <div className="custom-editor-layout">
        <ol className="numbered-steps">
          <GuideStep {...step('start')} waiting={!d.kind} summary={<>{KINDS.find((k) => k.id === d.kind)?.title ?? 'Not chosen'}{d.kind === 'tool' && draft.base ? <>: <code>{draft.base}</code></> : null}</>}>
            <KindCards kinds={KINDS} label="What it is" kind={d.kind} onChoose={chooseKind} />
            <InlineAsk asking={asking} onDone={() => setAsking(undefined)} />
            {d.kind === 'tool' && (
              <label>The tool it runs
                <select value={draft.base} onChange={(e) => d.chooseBase(e.target.value)}>
                  <option value="">Choose a tool…</option>
                  {Object.entries(Object.groupBy(d.bases, toolGroup)).map(([group, list]) => (
                    <optgroup key={group} label={toolGroupLabel(group)}>
                      {list!.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
                    </optgroup>
                  ))}
                </select>
              </label>
            )}
            <FieldProblems problems={problemsAt('base')} />
            {(d.kind === undefined || d.kind === 'http') && (d.isNew || !draft.http?.url.trim()) && <PasteRequest onRequest={startRequest} />}
          </GuideStep>

          {d.kind === 'http' && draft.http && (
            <GuideStep {...step('request')} summary={<code className="guide-line">{draft.http.method} {draft.http.url || '(no URL)'}</code>}
              about="Where it goes and what it sends. Your keys and sign-in stay yours: the model never sees them.">
              {pasteNote && <p className="hint">{pasteNote}</p>}
              <HttpEditor http={draft.http} inputs={draft.inputs ?? []} onChange={(http) => d.patch({ http })} problemsAt={problemsAt} />
            </GuideStep>
          )}

          {d.kind === 'script' && draft.http && (
            <GuideStep {...step('reaches')} summary={reachesLine(draft)}>
              <ScriptReaches draft={draft} patch={d.patch} tools={d.bases.map((t) => t.name).filter((n) => n !== 'agents.ask')} problemsAt={problemsAt} />
            </GuideStep>
          )}

          {d.kind && d.kind !== 'tool' && draft.http && (
            <GuideStep {...step('params')} summary={inputsLine(draft)}
              about={d.kind === 'http' ? 'Each value the model should choose becomes an input, with a description it reads to fill it.' : 'What the script gets in input, each with a description the model reads to fill it.'}>
              {d.kind === 'http' ? <RequestParams key={requestRound} draft={draft} patch={d.patch} problemsAt={problemsAt} /> : <InputsEditor draft={draft} patch={d.patch} problemsAt={problemsAt} />}
            </GuideStep>
          )}

          {d.kind === 'tool' && (
            <GuideStep {...step('params')} summary={presetLine(draft)}>
              {d.base ? (
                <>
                  <Segmented label="The parameters the model fills" className="compact" value={draft.inputs ? 'own' : 'same'}
                    onChange={(v) => d.patch(v === 'own' ? { inputs: [], params: keepRules(draft.params, 'built') } : { inputs: undefined, params: keepRules(draft.params, 'model') })}
                    options={[{ value: 'same', label: `The same as ${d.base.name}` }, { value: 'own', label: `Inputs of its own, ${d.base.name}'s made from them` }]} />
                  {draft.inputs ? (
                    <OwnParams draft={draft} params={d.params} typed={d.typed} setTyped={d.setTyped} patch={d.patch} setRule={d.setRule} problemsAt={problemsAt} />
                  ) : (
                    <BaseParams draft={draft} params={d.params} typed={d.typed} setTyped={d.setTyped} setRule={d.setRule} problemsAt={problemsAt} />
                  )}
                </>
              ) : (
                <p className="hint">Choose the tool it runs first (step 1).</p>
              )}
            </GuideStep>
          )}

          {d.kind === 'script' && draft.http && (
            <GuideStep {...step('code')} summary={draft.script?.trim() ? plural(draft.script.trim().split('\n').length, 'line') : 'Not written yet'}>
              <ScriptCode draft={draft} patch={d.patch} problemsAt={problemsAt} />
            </GuideStep>
          )}

          {d.kind && (
            <GuideStep {...step('test')} summary={d.kind === 'tool' ? 'Shows the call it makes' : <>{tried ?? 'Not tried yet'}{draft.http?.extract ? <> · answer cut to <code>{draft.http.extract}</code></> : ''}</>}
              about={d.kind === 'http' ? 'Send it with values of your own (nothing is saved), then click the keys of the answer the model needs.' : d.kind === 'tool' ? 'The call it would make with the values below: it runs from the chat, once saved.' : 'Run it with values of your own; nothing is saved.'}>
              {d.kind === 'http' && draft.http && <TryRequest draft={draft} onTried={setTried} onExtract={(extract) => d.patch({ http: { ...draft.http!, extract } })} />}
              {d.kind === 'script' && draft.http && <TryScript draft={draft} onTried={setTried} />}
              {d.kind === 'tool' && (d.base ? <TryShortcut draft={draft} base={d.base} typed={d.typed} /> : <p className="hint">Choose the tool it runs first (step 1).</p>)}
            </GuideStep>
          )}

          {d.kind && (
            <GuideStep {...step('model')} summary={<><code>{draft.name || '(no name)'}</code>{draft.description ? ` · ${short(draft.description)}` : ''}</>}
              about="Last, now that it works: the model decides from these alone when to call it.">
              <NameField draft={draft} customs={customs} onName={(name) => d.patch({ name })} problems={problemsAt('name')} />
              <label><ModelLabel text="Description: what it does and when to use it (the model decides from it alone)" when={WHEN} />
                <textarea rows={3} value={draft.description} placeholder="e.g. Searches the forum. Use it when the user asks what people say about something." onChange={(e) => d.patch({ description: e.target.value })} />
              </label>
              <FieldProblems problems={problemsAt('description')} />
            </GuideStep>
          )}

          {d.kind && (
            <GuideStep {...step('organize')} summary={organizeLine(draft)} about="Only for you: the model sees none of it.">
              <label>Group: its section here and in the tools menus
                <input aria-label="Group" className="narrow-input" list="custom-tool-groups" value={draft.group ?? ''} placeholder="e.g. Chat"
                  onChange={(e) => d.patch({ group: e.target.value || undefined })} />
                <datalist id="custom-tool-groups">{groupsOf(customs).filter(Boolean).map((g) => <option key={g} value={g} />)}</datalist>
              </label>
              <LabelsEditor labels={draft.labels ?? []} known={[...new Set(customs.flatMap((c) => c.labels ?? []))]} onChange={(labels) => d.patch({ labels: labels.length ? labels : undefined })} />
            </GuideStep>
          )}
        </ol>
        <aside className="custom-editor-side">
          {offeredOn && <SeenByModel draft={draft} base={offeredOn} />}
          <div className="custom-side-card">
            <h4>Checks</h4>
            {!d.kind ? (
              <p className="muted">Choose what it is to start.</p>
            ) : d.issues.length ? (
              <>
                <p>{d.issues.length === 1 ? '1 thing left' : `${d.issues.length} things left`} before it can be saved:</p>
                <ul className="guide-left">
                  {ids.filter((id) => left(id)).map((id) => (
                    <li key={id}>
                      <button type="button" className="link-button" onClick={() => guide.show(id)}>{TITLES[id]}</button> · {left(id)}
                      {/* What they are, once the step has been gone through (a problem may have no field shown). */}
                      {guide.seen.has(id) && <ul className="problems">{d.issues.filter((i) => toStep(i.field) === id).map((i) => <li key={i.text}>{i.text}</li>)}</ul>}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="custom-checks-ok">✓ Ready to save</p>
            )}
            {(d.kind === 'http' || (d.kind === 'script' && !draft.uses?.length)) && (
              <p className="muted small">{tried ? `Tried: ${tried}` : 'Not tried yet'}</p>
            )}
          </div>
        </aside>
      </div>
      <div className="editor-sticky-footer">
        <EditorFooter problems={d.problems} quiet isNew={d.isNew} onSave={d.save} onDelete={() => customToolStore.remove(custom.id)} onClose={onClose} />
      </div>
    </section>
  );
}

// The name, with one suggested from what the tool is (its site and what it does there).
function NameField({ draft, customs, onName, problems }: { draft: CustomTool; customs: CustomTool[]; onName: (name: string) => void; problems: string[] }) {
  const suggested = suggestName(draft, customs.filter((c) => c.id !== draft.id).map((c) => c.name));
  return (
    <>
      <label><ModelLabel text="Name: words in lowercase joined by dots" when={WHEN} />
        <input className="mono" value={draft.name} placeholder={suggested ? `e.g. ${suggested}` : 'e.g. forum.search'} onChange={(e) => onName(e.target.value)} />
      </label>
      {suggested && suggested !== draft.name && (
        <div className="row insert-chips">
          <span className="muted small">Suggested:</span>
          <button type="button" className="insert-chip mono" onClick={() => onName(suggested)}>{suggested}</button>
        </div>
      )}
      <FieldProblems problems={problems} />
    </>
  );
}

const short = (text: string) => (text.length > 80 ? `${text.slice(0, 80)}…` : text);

const inputsLine = (c: CustomTool) => {
  const inputs = (c.inputs ?? []).filter((i) => i.name);
  return inputs.length ? <span className="mono">{inputs.map((i) => `${i.name}${i.required ? '' : '?'}`).join(', ')}</span> : 'Nothing: every value is fixed';
};

const reachesLine = (c: CustomTool) =>
  [c.uses?.length ? `Calls ${c.uses.join(', ')}` : '', c.http?.url ? `Requests to ${c.http.url}` : ''].filter(Boolean).join(' · ') || 'Nothing yet';

const presetLine = (c: CustomTool) => {
  const fixed = Object.values(c.params).filter((r) => r.mode === 'fixed').length;
  const own = c.inputs ? `Its own: ${c.inputs.map((i) => i.name).filter(Boolean).join(', ') || 'none'}` : `The same as ${c.base || 'the tool'}`;
  return `${own}${fixed ? ` · ${fixed} fixed` : ''}`;
};

const organizeLine = (c: CustomTool) =>
  [c.group ? `Group ${c.group}` : '', c.labels?.length ? `Labels ${c.labels.join(', ')}` : ''].filter(Boolean).join(' · ') || 'No group or labels';

// The tool as the model is offered it, built on `base`'s parameters: its name, description and
// parameters, and the whole definition as JSON.
function SeenByModel({ draft, base }: { draft: CustomTool; base: Parameters<typeof customSchema>[1] }) {
  const schema = customSchema(draft, base) as { properties?: Record<string, { type?: string }>; required?: string[] };
  const props = Object.entries(schema.properties ?? {});
  return (
    <div className="custom-side-card">
      <h4>As the model sees it</h4>
      <div className="custom-seen">
        <span className="item-name">{toWireName(draft.name || 'its.name')}</span>
        <span>{draft.description || <span className="muted">No description yet</span>}</span>
        <span className="mono small muted">
          {props.length ? props.map(([n, p]) => `${n}${schema.required?.includes(n) ? '' : '?'}: ${p.type ?? 'any'}`).join(' · ') : 'No parameters'}
        </span>
      </div>
      <details className="text-block">
        <summary>The whole definition (JSON)</summary>
        <pre><Code lang="json" source={JSON.stringify({ name: toWireName(draft.name || 'name'), description: draft.description, parameters: schema }, null, 2)} /></pre>
      </details>
    </div>
  );
}

// The base tool's parameters, each filled by the model (with a text around it and a description of
// its own, optional) or fixed here.
function BaseParams({ draft, params, typed, setTyped, setRule, problemsAt }: {
  draft: CustomTool;
  params: ReturnType<typeof baseParams>;
  typed: Record<string, string>;
  setTyped: SetTyped;
  setRule: (name: string, rule: ParamRule | undefined) => void;
  problemsAt: ProblemsAt<IssueField>;
}) {
  return Object.entries(params).map(([name, prop]) => {
    const rule = draft.params[name];
    return (
      <div key={name} className="custom-param">
        <ParamHead name={name} type={prop.type}>
          <select aria-label={`How ${name} is filled`} value={rule?.mode ?? 'model'}
            onChange={(e) => setRule(name, e.target.value === 'fixed' ? { mode: 'fixed', value: '' } : undefined)}>
            <option value="model">The model fills it</option>
            <option value="fixed">Fixed: set here</option>
          </select>
          <span className="muted small">{prop.description}</span>
        </ParamHead>
        {rule?.mode === 'fixed' ? (
          <FixedValueInput name={name} type={prop.type} typed={typed} setTyped={setTyped} />
        ) : (
          <div className="row">
            {(prop.type === 'string' || !prop.type) && (
              <TemplateInput label={`Text around the model's ${name}`} value={rule?.mode === 'model' ? (rule.template ?? '') : ''} placeholder={`${VALUE} site:forum.example.com (optional)`} chips={[VALUE]}
                onChange={(template) => setRule(name, { ...(rule as ModelRule), mode: 'model', template: template || undefined })} />
            )}
            <input aria-label={`Description of ${name} for the model`} value={rule?.mode === 'model' ? (rule.description ?? '') : ''} placeholder="Its description for the model (optional)"
              onChange={(e) => setRule(name, { ...(rule as ModelRule), mode: 'model', description: e.target.value || undefined })} />
          </div>
        )}
        <FieldProblems problems={problemsAt(`param:${name}`)} />
      </div>
    );
  });
}

type ModelRule = Extract<ParamRule, { mode: 'model' }>;

// Switching how the model fills them: the fixed values stay, and the rules of the mode chosen.
const keepRules = (params: Record<string, ParamRule>, mode: 'model' | 'built') =>
  Object.fromEntries(Object.entries(params).filter(([, r]) => r.mode === 'fixed' || r.mode === mode));
