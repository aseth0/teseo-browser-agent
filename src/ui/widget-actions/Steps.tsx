// An action's steps (widget/steps), edited as cards (read, tool, model) or as their JSON. Each
// card says the values it gives later steps, the boxes and the badge ({page.id}, {triage.priority}).
import { useEffect, useState } from 'react';
import { isObject } from '../../core/util';
import type { ToolInfo } from '../../core/protocol';
import { baseParams } from '../../tools/custom/runtime';
import { stepKind, type ActionStep, type FieldType, type ModelStep, type ReadStep, type StepKind, type ToolStep } from '../../widget/steps';
import type { ActionOutput, WidgetAction } from '../../widget/actions';
import { DrawnChoice, type DrawnOption } from '../DrawnChoice';
import { BadgeDrawing, FieldsDrawing, SHOW_VIEW_BOX, TextDrawing } from './ShowDrawings';
import { keyOf, patchAt, swapAt } from '../keys';
import { withKey } from '../edits';
import { Fold } from '../guide';

const STEPS_EXAMPLE = `[
  { "name": "page", "read": "{{url}}", "match": "https?://(?<domain>[^/]+)/browse/(?<id>[A-Z]+-\\\\d+)" },
  { "name": "ticket", "tool": "jira.issue", "args": { "key": "{page.id}" }, "extract": "fields" },
  { "name": "triage", "prompt": "Triage {page.id}: {ticket.summary}", "fields": { "priority": ["High", "Medium", "Low"], "urgent": "boolean" } }
]`;

const NEW_STEP: Record<StepKind, (name: string) => ActionStep> = {
  read: (name) => ({ name, read: '{{url}}' }),
  tool: (name) => ({ name, tool: '', args: {} }),
  model: (name) => ({ name, prompt: '' }),
};

// A name no step has: page, page2…
function freeStepName(steps: ActionStep[], kind: StepKind): string {
  const base = { read: 'page', tool: 'result', model: 'answer' }[kind];
  let name = base;
  for (let n = 2; steps.some((s) => s.name === name); n++) name = `${base}${n}`;
  return name;
}

// What a step gives the ones after it: its name, and the keys it knows of (a match's named groups,
// a model's fields).
const pathsOf = (step: ActionStep): string[] => {
  const groups = 'prompt' in step ? [] : [...(step.match ?? '').matchAll(/\(\?<([A-Za-z_]\w*)>/g)].map((m) => m[1]!);
  const keys = 'prompt' in step ? Object.keys(step.fields ?? {}) : groups;
  // A tool's matches are a list: its first item's keys.
  const at = 'tool' in step && (step.match || step.each) ? `${step.name}[0]` : step.name;
  return keys.length ? keys.map((k) => `${at}.${k}`) : [at];
};
const givesOf = (step: ActionStep) => pathsOf(step).map((p) => `{${p}}`);

// The tools to pick from (one that changes things asks first), and the one picked when it is not among them.
const asksFirst = (t: ToolInfo) => (t.effect === 'write' ? ' (asks first)' : '');
export const ToolOptions = ({ tools, picked }: { tools: ToolInfo[]; picked: string }) => (
  <>
    {tools.map((t) => <option key={t.name} value={t.name}>{t.name}{asksFirst(t)}</option>)}
    {picked && !tools.some((t) => t.name === picked) && <option value={picked}>{picked} (not available)</option>}
  </>
);

export function StepsEditor({ steps, tools, onChange, onBad, onTry }: { steps: ActionStep[] | undefined; tools: ToolInfo[]; onChange: (steps: ActionStep[] | undefined) => void; onBad: (problem: string | undefined) => void; onTry: (upTo: number) => void }) {
  const [asJson, setAsJson] = useState(false);
  const list = steps ?? [];
  const set = (next: ActionStep[]) => onChange(next.length ? next : undefined);
  const add = (kind: StepKind) => set([...list, NEW_STEP[kind](freeStepName(list, kind))]);
  const move = (i: number, by: number) => set(swapAt(list, i, by));
  return (
    <fieldset className="settings-block">
      <legend>Its steps, in order</legend>
      <div className="row">
        <button className={asJson ? '' : 'primary'} onClick={() => setAsJson(false)}>Steps</button>
        <button className={asJson ? 'primary' : ''} onClick={() => setAsJson(true)}>JSON</button>
      </div>
      {asJson ? (
        <StepsJson steps={steps} onChange={onChange} onBad={onBad} />
      ) : (
        <>
          {list.map((step, i) => (
            <div key={keyOf(step)}>
              <StepCard step={step} tools={tools} onChange={(change) => set(patchAt(list, i, change))}
                onRemove={() => set(list.filter((_, j) => j !== i))} onTry={() => onTry(i + 1)}
                {...(i > 0 && { onUp: () => move(i, -1) })} {...(i < list.length - 1 && { onDown: () => move(i, 1) })} />
              <p className="hint">↓ gives {givesOf(step).map((g) => <code key={g}>{g} </code>)}</p>
            </div>
          ))}
          <div className="row">
            <button className="custom-add step-read" onClick={() => add('read')}><span className="badge step-kind">＋ read</span> from the page</button>
            <button className="custom-add step-tool" onClick={() => add('tool')}><span className="badge step-kind">＋ tool</span></button>
            <button className="custom-add step-model" onClick={() => add('model')}><span className="badge step-kind">＋ model</span></button>
          </div>
        </>
      )}
    </fieldset>
  );
}

const KIND_LABEL: Record<StepKind, string> = { read: 'read', tool: 'tool', model: 'model' };

function StepCard({ step, tools, onChange, onRemove, onTry, onUp, onDown }: { step: ActionStep; tools: ToolInfo[]; onChange: (change: Partial<ActionStep>) => void; onRemove: () => void; onTry: () => void; onUp?: () => void; onDown?: () => void }) {
  const kind = stepKind(step);
  return (
    <div className={`custom-param step step-${kind}`}>
      <div className="custom-param-head">
        <span className="badge step-kind">{KIND_LABEL[kind]}</span>
        <input aria-label="Step name" className="narrow-input mono" value={step.name} placeholder="page" onChange={(e) => onChange({ name: e.target.value })} />
        <span className="spacer" />
        <button title="Run the action up to this step, below the steps" onClick={onTry}>▶ Try up to here</button>
        <button className="icon-button" title="Move up" aria-label="Move up" disabled={!onUp} onClick={onUp}>↑</button>
        <button className="icon-button" title="Move down" aria-label="Move down" disabled={!onDown} onClick={onDown}>↓</button>
        <button className="icon-button warn" title="Remove" aria-label={`Remove step ${step.name}`} onClick={onRemove}>✕</button>
      </div>
      {'read' in step && <ReadFields step={step} onChange={onChange} />}
      {'tool' in step && <ToolFields step={step} tools={tools} onChange={onChange} />}
      {'prompt' in step && <ModelFields step={step} tools={tools} onChange={onChange} />}
    </div>
  );
}

function ReadFields({ step, onChange }: { step: ReadStep; onChange: (change: Partial<ReadStep>) => void }) {
  return (
    <>
      <label>From the page: <code>{'{{url}}'}</code>, <code>{'{{page}}'}</code>, <code>{'{{selector:css}}'}</code>, <code>{'{{selector:css?attr}}'}</code>, <code>{'{{meta:name}}'}</code>
        <input className="mono" value={step.read} placeholder="{{url}}" onChange={(e) => onChange({ read: e.target.value })} />
      </label>
      <label>Match (optional): a regular expression; its named groups give an object, else its first group, else what matched
        <input className="mono" value={step.match ?? ''} placeholder="https?://(?<domain>[^/]+)/browse/(?<id>[A-Z]+-\d+)" onChange={(e) => onChange({ match: e.target.value || undefined })} />
      </label>
    </>
  );
}

function ToolFields({ step, tools, onChange }: { step: ToolStep; tools: ToolInfo[]; onChange: (change: Partial<ToolStep>) => void }) {
  const tool = tools.find((t) => t.name === step.tool);
  const params = tool ? baseParams(tool) : {};
  const setArg = (name: string, template: string) => onChange({ args: withKey(step.args, name, template || undefined) });
  return (
    <>
      <label>The tool (one that changes things asks you in the card first)
        <select value={step.tool} onChange={(e) => onChange({ tool: e.target.value, args: {} })}>
          <option value="">Choose a tool…</option>
          <ToolOptions tools={tools} picked={step.tool} />
        </select>
      </label>
      <label>For each item of (optional): a list a step before it gives; the tool runs once per item (at most 20), each as <code>{'{item}'}</code>, <code>{'{item.url}'}</code>
        <input className="mono" list="step-paths" value={step.each ?? ''} placeholder="results" onChange={(e) => onChange({ each: e.target.value || undefined })} />
      </label>
      {Object.entries(params).map(([name, prop]) => (
        <div key={name} className="custom-param-head">
          <code>{name}</code>
          <span className="badge">{prop.type ?? 'any'}</span>
          <input aria-label={`Value of ${name}`} className="mono" value={step.args?.[name] ?? ''} placeholder={step.each ? '{item.url}, or a fixed value' : '{page.id}, or a fixed value'} onChange={(e) => setArg(name, e.target.value)} />
        </div>
      ))}
      <label>Keep only (optional): a path into its answer, when it is JSON
        <input className="mono" value={step.extract ?? ''} placeholder="fields.{summary,description}" onChange={(e) => onChange({ extract: e.target.value || undefined })} />
      </label>
      <label>Match (optional): a regular expression for an answer in text; it gives a list, one item per match (named groups: an object each)
        <input className="mono" value={step.match ?? ''} placeholder="\[(?<id>\d+)\] (?<title>.+)" onChange={(e) => onChange({ match: e.target.value || undefined })} />
      </label>
    </>
  );
}

type FieldRow = { key: string; type: 'text' | 'number' | 'boolean' | 'options'; options: string };
const rowOf = ([key, type]: [string, FieldType]): FieldRow =>
  Array.isArray(type) ? { key, type: 'options', options: type.join(', ') } : { key, type, options: '' };
const fieldsOf = (rows: FieldRow[]): Record<string, FieldType> | undefined => {
  const named = rows.filter((r) => r.key.trim());
  if (!named.length) return undefined;
  return Object.fromEntries(named.map((r) => [r.key.trim(), r.type === 'options' ? r.options.split(',').map((o) => o.trim()).filter(Boolean) : r.type]));
};

// Its prompt and fields; the fields edited as rows, so that one being typed (or two with one name)
// is not lost: the step gets the named ones.
function ModelFields({ step, tools, onChange }: { step: ModelStep; tools: ToolInfo[]; onChange: (change: Partial<ModelStep>) => void }) {
  const [rows, setRows] = useState<FieldRow[]>(() => Object.entries(step.fields ?? {}).map(rowOf));
  const change = (next: FieldRow[]) => {
    setRows(next);
    onChange({ fields: fieldsOf(next) });
  };
  return (
    <>
      <label>Prompt: the values of the steps before it as <code>{'{page.id}'}</code>, <code>{'{ticket.summary}'}</code>
        <textarea rows={3} value={step.prompt} placeholder="Triage incident {page.id}: {ticket.summary}" onChange={(e) => onChange({ prompt: e.target.value })} />
      </label>
      <details>
        <summary>Tools it may call ({step.tools?.length ? step.tools.join(', ') : 'none'})</summary>
        {tools.map((t) => (
          <label key={t.name} className="check">
            <input type="checkbox" checked={!!step.tools?.includes(t.name)} onChange={(e) => {
              const next = e.target.checked ? [...(step.tools ?? []), t.name] : (step.tools ?? []).filter((n) => n !== t.name);
              onChange({ tools: next.length ? next : undefined });
            }} />
            <code>{t.name}</code>{asksFirst(t)}
          </label>
        ))}
      </details>
      <div className="field-label">Fields (none: its answer is a text; with fields, a JSON object checked against them, asked again once)</div>
      {rows.map((r, i) => (
        <div key={keyOf(r)} className="custom-param-head">
          <input aria-label={`Name of field ${i + 1}`} className="narrow-input mono" value={r.key} placeholder="priority" onChange={(e) => change(patchAt(rows, i, { key: e.target.value }))} />
          <select aria-label={`Type of field ${i + 1}`} value={r.type} onChange={(e) => change(patchAt(rows, i, { type: e.target.value as FieldRow['type'] }))}>
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="boolean">Yes / no</option>
            <option value="options">One of…</option>
          </select>
          {r.type === 'options' && <input aria-label={`Options of field ${i + 1}`} value={r.options} placeholder="High, Medium, Low" onChange={(e) => change(patchAt(rows, i, { options: e.target.value }))} />}
          <button className="icon-button warn" title="Remove" aria-label={`Remove field ${i + 1}`} onClick={() => change(rows.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button className="custom-add" onClick={() => change([...rows, { key: '', type: 'text', options: '' }])}>＋ Add a field</button>
    </>
  );
}

// A list of objects: what each one lacks, actionProblems says (stepProblems).
const isStepList = (v: unknown): v is ActionStep[] => Array.isArray(v) && v.every(isObject);

// The steps as JSON. Kept as typed while it does not parse; what it said is wrong goes with it
// (the cards show the steps it last parsed).
function StepsJson({ steps, onChange, onBad }: { steps: ActionStep[] | undefined; onChange: (steps: ActionStep[] | undefined) => void; onBad: (problem: string | undefined) => void }) {
  const [json, setJson] = useState(() => (steps?.length ? JSON.stringify(steps, null, 2) : ''));
  useEffect(() => () => onBad(undefined), [onBad]);
  const change = (value: string) => {
    setJson(value);
    if (!value.trim()) {
      onBad(undefined);
      return onChange(undefined);
    }
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!isStepList(parsed)) return onBad('The steps are a JSON list of objects: [ {…}, {…} ].');
      onBad(undefined);
      onChange(parsed);
    } catch (e) {
      onBad(`The steps are not valid JSON: ${(e as Error).message}`);
    }
  };
  return (
    <>
      <textarea aria-label="Steps" className="mono" rows={json ? Math.min(24, json.split('\n').length + 1) : 6} value={json} placeholder={STEPS_EXAMPLE} onChange={(e) => change(e.target.value)} />
      <p className="hint">
        Each step is <code>{'{ "name", "read", "match"? }'}</code>, <code>{'{ "name", "tool", "args"?, "extract"? }'}</code> or{' '}
        <code>{'{ "name", "prompt", "fields"? }'}</code>; a field is <code>"text"</code>, <code>"number"</code>, <code>"boolean"</code> or a list of options.
      </p>
    </>
  );
}

type ShowMode = 'fields' | 'text' | 'badge';
const SHOW_MODES: DrawnOption<ShowMode>[] = [
  { id: 'fields', label: 'Fields in the card', drawing: <FieldsDrawing /> },
  { id: 'text', label: 'A text in the card', drawing: <TextDrawing /> },
  { id: 'badge', label: 'Only a badge on the bubble', drawing: <BadgeDrawing /> },
];
const modeOf = (a: Pick<WidgetAction, 'outputs' | 'badge'>): ShowMode => (!a.outputs.length && a.badge ? 'badge' : a.outputs.length > 1 ? 'fields' : 'text');
const labelOf = (key: string) => key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
// A model step's fields, each a box of what the action shows.
const outputsOf = (m: ModelStep): ActionOutput[] => Object.keys(m.fields!).map((k) => ({ label: labelOf(k), from: `${m.name}.${k}` }));

// What an action with steps shows: one text, several fields in the card, or only a badge on the
// bubble; each a path into the steps' values, picked from those the steps say they give.
export function StepsShow({ action, onChange }: { action: Pick<WidgetAction, 'steps' | 'outputs' | 'badge' | 'chatButtons'>; onChange: (change: Partial<WidgetAction>) => void }) {
  const [mode, setMode] = useState<ShowMode>(() => modeOf(action));
  const steps = action.steps ?? [];
  const paths = steps.flatMap(pathsOf);
  const last = steps.at(-1);
  const withFields = steps.filter((s): s is ModelStep => 'prompt' in s && !!Object.keys(s.fields ?? {}).length);
  const setOutput = (i: number, change: Partial<ActionOutput>) => onChange({ outputs: patchAt(action.outputs, i, change) });
  const choose = (m: ShowMode) => {
    setMode(m);
    if (m === 'badge') return onChange({ outputs: [], badge: action.badge ?? paths.at(-1) });
    if (m === 'text') return onChange({ outputs: [{ label: action.outputs[0]?.label ?? 'Result', from: action.outputs[0]?.from }] });
    const model = withFields.at(-1);
    onChange({ outputs: model ? outputsOf(model) : action.outputs.length ? action.outputs : [{ label: 'Result' }] });
  };
  const badgeGuess = paths.find((p) => /urgent|count|total/.test(p)) ?? 'triage.urgent';
  const path = (value: string | undefined, set: (v: string | undefined) => void, label: string, placeholder: string) => (
    <input aria-label={label} className="mono" list="step-paths" value={value ?? ''} placeholder={placeholder} onChange={(e) => set(e.target.value || undefined)} />
  );
  return (
    <fieldset className="settings-block">
      <legend>What it shows</legend>
      <datalist id="step-paths">{paths.map((p) => <option key={p} value={p} />)}</datalist>
      <DrawnChoice name="show" size="small" viewBox={SHOW_VIEW_BOX} options={SHOW_MODES} value={mode} onChange={choose} />
      {mode === 'text' && (
        <label>From (none: the last step's{last ? `, ${last.name}` : ''})
          {path(action.outputs[0]?.from, (from) => setOutput(0, { from }), 'From', last?.name ?? 'triage')}
        </label>
      )}
      {mode === 'fields' && (
        <>
          {action.outputs.map((o, i) => (
            <div key={keyOf(o)} className="custom-param-head">
              <input aria-label={`Label of field ${i + 1}`} className="narrow-input" value={o.label} placeholder="Priority" onChange={(e) => setOutput(i, { label: e.target.value })} />
              {path(o.from, (from) => setOutput(i, { from }), `Path of field ${i + 1}`, 'triage.priority')}
              <button className="icon-button warn" title="Remove" aria-label={`Remove field ${i + 1}`} onClick={() => onChange({ outputs: action.outputs.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <div className="row">
            <button className="custom-add" onClick={() => onChange({ outputs: [...action.outputs, { label: '' }] })}>＋ Add a field</button>
            {withFields.map((m) => (
              <button key={m.name} className="custom-add" onClick={() => onChange({ outputs: outputsOf(m) })}>Use {m.name}'s fields</button>
            ))}
          </div>
        </>
      )}
      {mode === 'badge' ? (
        <label>Badge, on page load: a number as it is, true or false as ✓ or ✗
          {path(action.badge, (badge) => onChange({ badge }), 'Badge', badgeGuess)}
        </label>
      ) : (
        <>
          <Fold title="A badge on the bubble" summary={action.badge ? <code>{action.badge}</code> : 'None'}>
            <label>Also a badge on the bubble (optional), on page load: a number as it is, true or false as ✓ or ✗
              {path(action.badge, (badge) => onChange({ badge }), 'Badge', badgeGuess)}
            </label>
          </Fold>
          <label className="check">
            <input type="checkbox" checked={!!action.chatButtons} onChange={(e) => onChange({ chatButtons: e.target.checked || undefined })} />
            <span>Buttons to go on in the chat: 💬 floating here, ◨ in the side panel (the steps' values go with it)</span>
          </label>
        </>
      )}
      <p className="hint">A path starts with a step's name: {paths.length ? paths.map((p) => <code key={p}>{p} </code>) : <code>page.id</code>}. Lists go one item per line; deeper keys as <code>ticket.items[0].title</code>.</p>
    </fieldset>
  );
}
