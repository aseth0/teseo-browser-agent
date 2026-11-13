// The parts of a custom tool's editor: its own parameters, an HTTP request, a script.
import { usedSecrets } from '../../tools/custom/secrets';
import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { baseParams } from '../../tools/custom/runtime';
import { INPUT_TYPES, type CustomInput, type CustomTool, type InputType, type ParamRule } from '../../tools/custom/types';
import { HTTP_METHODS, type HttpRequest } from '../../tools/http';
import { AccessEditor } from '../AccessEditor';
import { CodeArea } from '../CodeArea';
import { ParamHead } from '../fields';
import { keyOf, patchAt } from '../keys';
import { isEnter } from '../enter';
import { withKey } from '../edits';
import { FieldProblems, TemplateInput, type ProblemsAt } from '../guide';
import type { IssueField } from '../../tools/custom/validate';

type Params = ReturnType<typeof baseParams>;
// The values typed in the editor, by parameter, as text.
export type SetTyped = Dispatch<SetStateAction<Record<string, string>>>;

// A parameter's fixed value, typed as text (read as its type when saved).
export function FixedValueInput({ name, type, typed, setTyped }: { name: string; type?: string; typed: Record<string, string>; setTyped: SetTyped }) {
  return (
    <input aria-label={`Fixed value of ${name}`} className="mono" value={typed[name] ?? ''} placeholder={type === 'string' || !type ? 'text' : type}
      onChange={(e) => setTyped((t) => ({ ...t, [name]: e.target.value }))} />
  );
}

// An input's default as text (empty: none).
export const defaultText = (input: CustomInput) => (input.default === undefined ? '' : String(input.default));

// The chips that insert the tool's inputs into a template.
export const inputChips = (inputs: CustomInput[]) => inputs.filter((i) => /^[a-z][a-z0-9_]*$/.test(i.name)).map((i) => `{${i.name}}`);

// Its own parameters, then how each of the tool it runs gets its own: left out, fixed, or made from
// them.
export function OwnParams(props: {
  draft: CustomTool;
  params: Params;
  typed: Record<string, string>;
  setTyped: SetTyped;
  patch: (change: Partial<CustomTool>) => void;
  setRule: (name: string, rule: ParamRule | undefined) => void;
  problemsAt: ProblemsAt<IssueField>;
}) {
  const { draft, params, typed, setTyped, patch, setRule, problemsAt } = props;
  const inputs = draft.inputs ?? [];
  return (
    <>
      <InputsEditor draft={draft} patch={patch} problemsAt={problemsAt} />
      <div className="field-label">How {draft.base} gets its parameters</div>
      <p className="hint">Click an input to put it where the caret is: <code>https://{'{lang}'}.wiki.example.com/wiki/{'{title}'}</code>. Just <code>{'{limit}'}</code> passes it as it is.</p>
      {Object.entries(params).map(([name, prop]) => {
        const rule = draft.params[name];
        const mode = rule?.mode === 'fixed' || rule?.mode === 'built' ? rule.mode : 'none';
        return (
          <div key={name} className="custom-param">
            <ParamHead name={name} type={prop.type}>
              <select aria-label={`How ${name} is filled`} value={mode}
                onChange={(e) => setRule(name, e.target.value === 'fixed' ? { mode: 'fixed', value: '' } : e.target.value === 'built' ? { mode: 'built', template: '' } : undefined)}>
                <option value="none">Left out</option>
                <option value="fixed">Fixed: set here</option>
                <option value="built">Made from its inputs</option>
              </select>
              <span className="muted small">{prop.description}</span>
            </ParamHead>
            {rule?.mode === 'fixed' && (
              <FixedValueInput name={name} type={prop.type} typed={typed} setTyped={setTyped} />
            )}
            {rule?.mode === 'built' && (
              <TemplateInput label={`How ${name} is made`} value={rule.template} placeholder={`{${inputs[0]?.name || 'title'}}`} chips={inputChips(inputs)}
                onChange={(template) => setRule(name, { mode: 'built', template })} />
            )}
            <FieldProblems problems={problemsAt(`param:${name}`)} />
          </div>
        );
      })}
    </>
  );
}

// The value used when the model leaves the parameter out, as its type.
function DefaultField({ input, onChange }: { input: CustomInput; onChange: (value: CustomInput['default']) => void }) {
  if (input.type === 'boolean') {
    return (
      <select aria-label={`Default of ${input.name}`} value={defaultText(input)}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value === 'true')}>
        <option value="">no default</option>
        <option value="true">default: true</option>
        <option value="false">default: false</option>
      </select>
    );
  }
  return (
    <input aria-label={`Default of ${input.name}`} className="narrow-input" type={input.type === 'number' ? 'number' : 'text'} placeholder="default (optional)"
      value={defaultText(input)}
      onChange={(e) => onChange(e.target.value === '' ? undefined : input.type === 'number' ? Number(e.target.value) : e.target.value)} />
  );
}

// The tool's own parameters: name, type, required, default and description, with their problems.
// `renamed`: what else changes once a name is changed and its box left (a request's {old} written
// {new}); `extra`: more on an input's row (where its value came from).
export function InputsEditor({ draft, patch, problemsAt, renamed, extra }: {
  draft: CustomTool;
  patch: (change: Partial<CustomTool>) => void;
  problemsAt?: ProblemsAt<IssueField>;
  renamed?: (from: string, to: string, at: number) => Partial<CustomTool>;
  extra?: (input: CustomInput, i: number) => React.ReactNode;
}) {
  const inputs = draft.inputs ?? [];
  const setInput = (i: number, change: Partial<CustomInput>) => patch({ inputs: patchAt(inputs, i, change) });
  // The name as it was when its box was entered.
  const before = useRef<string | undefined>(undefined);
  const left = (i: number) => {
    const from = before.current;
    before.current = undefined;
    const to = inputs[i]?.name;
    if (renamed && from !== undefined && to !== undefined && from !== to) patch(renamed(from, to, i));
  };
  return (
    <>
      {inputs.map((input, i) => (
        <div key={keyOf(input)} className="custom-param">
          <div className="custom-param-head">
            <input aria-label="Parameter name" className="mono narrow-input" value={input.name} placeholder="title"
              onFocus={() => (before.current = input.name)} onBlur={() => left(i)} onChange={(e) => setInput(i, { name: e.target.value.trim() })} />
            <select aria-label={`Type of ${input.name || 'the parameter'}`} value={input.type}
              onChange={(e) => setInput(i, { type: e.target.value as InputType, default: undefined })}>
              {INPUT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <label className="check"><input type="checkbox" checked={input.required ?? false} onChange={(e) => setInput(i, { required: e.target.checked || undefined })} /> required</label>
            <DefaultField input={input} onChange={(value) => setInput(i, { default: value })} />
            <span className="spacer" />
            <button className="icon-button warn" title="Remove" aria-label={`Remove ${input.name || 'the parameter'}`} onClick={() => patch({ inputs: inputs.filter((_, j) => j !== i) })}>✕</button>
          </div>
          {extra?.(input, i)}
          <input aria-label={`Description of ${input.name || 'the parameter'} for the model`} value={input.description} placeholder="What it is, for the model: e.g. The words to search for"
            onChange={(e) => setInput(i, { description: e.target.value })} />
          <FieldProblems problems={problemsAt?.(`input:${i}`) ?? []} />
        </div>
      ))}
      <button className="custom-add" onClick={() => patch({ inputs: [...inputs, { name: '', type: 'string', description: '' }] })}>＋ Add a parameter</button>

    </>
  );
}

// The request: method, URL and body with the inputs in them (inserted by a click), then the keys and
// sign-in it goes with, folded (yours only: the model never sees them).
export function HttpEditor({ http, inputs, onChange, problemsAt }: { http: HttpRequest; inputs: CustomInput[]; onChange: (http: HttpRequest) => void; problemsAt: ProblemsAt<IssueField> }) {
  const set = (change: Partial<HttpRequest>) => onChange({ ...http, ...change });
  const example = `{${inputs[0]?.name || 'query'}}`;
  const chips = inputChips(inputs);
  const access = !!(http.headers?.length || http.session || http.readOnly || usedSecrets({ http }).length);
  return (
    <>
      <div className="custom-param-head">
        <select aria-label="Method" value={http.method} onChange={(e) => set({ method: e.target.value as HttpRequest['method'] })}>
          {HTTP_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <TemplateInput label="URL" className="http-url" value={http.url} placeholder={`https://api.example.com/search?q=${example}`} chips={chips} onChange={(url) => set({ url })} />
      </div>
      <FieldProblems problems={[...problemsAt('method'), ...problemsAt('url')]} />
      <p className="hint">
        {http.method === 'GET' ? 'GET only reads: it runs without asking.' : `${http.method} changes things: you confirm every call, as an action on the API's site.`} An
        input goes in the URL as {example}, encoded for it.
      </p>
      {http.method !== 'GET' && (
        <label>Body (JSON; an input goes as {example}, without quotes: it is written as a JSON value)
          <TemplateInput label="Body" rows={4} value={http.body ?? ''} placeholder={`{"q": ${example}}`} chips={chips} onChange={(body) => set({ body: body || undefined })} />
        </label>
      )}
      <FieldProblems problems={problemsAt('body')} />
      <details className="settings-fold" open={access || undefined}>
        <summary>Keys and sign-in{access ? '' : ' (none)'}</summary>
        <AccessEditor bare http={http} set={set} readsLabel={http.method === 'GET' ? undefined : `This request only reads (a search sent as ${http.method})`} />
        <SecretsEditor names={usedSecrets({ http })} http={http} set={set} />
      </details>
      <FieldProblems problems={problemsAt('headers')} />
    </>
  );
}

// The values it sends by {{secret:name}} (saved from a recording, or typed here): only you see them,
// they go only to its site, and a tool with any is confirmed every time it runs.
function SecretsEditor({ names, http, set }: { names: string[]; http: HttpRequest; set: (change: Partial<HttpRequest>) => void }) {
  if (!names.length) return null;
  const put = (name: string, value: string | undefined) => {
    const next = withKey(http.secrets, name, value);
    set({ secrets: Object.keys(next).length ? next : undefined });
  };
  return (
    <fieldset className="settings-block">
      <legend>Saved values</legend>
      <p className="hint">What it sends as {'{{secret:name}}'}: never shown to the model, sent only to its site; the tool asks you every time it runs.
        Type each one as it goes where it is written: encoded in a URL (<code>%2B</code> for +, <code>%26</code> for &amp;), escaped in a JSON text (<code>\"</code> for a quote).</p>
      {names.map((name) => (
        <div key={name} className="row">
          <label>{name}
            <input type="password" className="mono" aria-label={`Saved value ${name}`} value={http.secrets?.[name] ?? ''} placeholder="not saved: the tool cannot run"
              onChange={(e) => put(name, e.target.value || undefined)} />
          </label>
          {http.secrets?.[name] !== undefined && <button type="button" onClick={() => put(name, undefined)}>Delete</button>}
        </div>
      ))}
    </fieldset>
  );
}

const SCRIPT_EXAMPLE = `// input: this tool's parameters; request(method, path, body) → { status, ok, data }
const r = await request('GET', '/api/items');
if (!r.ok) throw new Error('items: ' + r.status);
return r.data;`;

const STEPS_EXAMPLE = `// input: this tool's parameters; tool(name, args, { report }) → { ok, text, data }
const found = await tool('browser.find', { query: 'textbox message' });
await tool('browser.type', { ref: found.data[0].ref, text: input.message, submit: true });
const answer = await tool('browser.wait_for', { gone: 'button stop', stableMs: 3000, returnText: true }, { report: true });
return answer.data.text;`;

// What a script reaches: the tools it calls, and a site's API with its access. `tools`: those it may
// call (the catalog's own).
export function ScriptReaches({ draft, patch, tools, problemsAt }: { draft: CustomTool; patch: (change: Partial<CustomTool>) => void; tools: string[]; problemsAt: ProblemsAt<IssueField> }) {
  const http = draft.http!;
  const set = (change: Partial<HttpRequest>) => patch({ http: { ...http, ...change } });
  const calls = !!draft.uses?.length;
  // Its site's API: on with a site, or with no tools to call (a plain script needs one).
  const [api, setApi] = useState(!!http.url.trim() || !calls);
  const toggleApi = (on: boolean) => {
    setApi(on);
    if (!on) set({ url: '', headers: undefined, session: undefined });
  };
  const access = !!(http.headers?.length || http.session || http.readOnly);
  return (
    <>
      <ToolsPicker uses={draft.uses ?? []} tools={tools} onChange={(uses) => patch({ uses: uses.length ? uses : undefined })} />
      <FieldProblems problems={problemsAt('uses')} />
      <label className="check">
        <input type="checkbox" checked={api} onChange={(e) => toggleApi(e.target.checked)} /> <span>It calls a site's API, with <code>request()</code></span>
      </label>
      {api && (
        <div className="script-site">
          <label>Its requests go only to
            <input aria-label="Site" className="mono" value={http.url} placeholder="https://app.example.com" onChange={(e) => set({ url: e.target.value })} />
          </label>
          <FieldProblems problems={problemsAt('site')} />
          <details className="settings-fold" open={access || undefined}>
            <summary>Keys and sign-in{access ? '' : ' (none)'}</summary>
            <AccessEditor bare http={http} set={set} readsLabel="This script only reads" />
          </details>
          <SecretsEditor names={usedSecrets({ script: draft.script, http })} http={http} set={set} />
          <FieldProblems problems={problemsAt('headers')} />
        </div>
      )}
      {!api && <FieldProblems problems={problemsAt('site')} />}
    </>
  );
}

// A script's code, with an example to start from (one that calls tools, or a site's API) and what it
// can use.
export function ScriptCode({ draft, patch, problemsAt }: { draft: CustomTool; patch: (change: Partial<CustomTool>) => void; problemsAt: ProblemsAt<IssueField> }) {
  const http = draft.http!;
  const calls = !!draft.uses?.length;
  const api = !!http.url.trim() || !calls;
  const inputs = (draft.inputs ?? []).filter((i) => i.name);
  return (
    <>
      <label>
        <span>The body of an async function; what it returns goes to the model</span>
        <CodeArea label="Code" lang="javascript" rows={14} value={draft.script ?? ''} placeholder={calls ? '// Its steps, with tool(name, args)…' : '// Its requests, with request(method, path, body)…'} onChange={(script) => patch({ script })} />
      </label>
      <div className="row">
        {!draft.script?.trim() && <button type="button" onClick={() => patch({ script: calls ? STEPS_EXAMPLE : SCRIPT_EXAMPLE })}>Insert example</button>}
        {inputs.length > 0 && <span className="muted small">Its inputs: {inputs.map((i) => <code key={i.name}>input.{i.name}</code>).reduce<React.ReactNode[]>((all, c) => (all.length ? [...all, ', ', c] : [c]), [])}</span>}
      </div>
      <FieldProblems problems={problemsAt('code')} />
      <details className="settings-fold">
        <summary>What the script can use</summary>
        <ul className="hint script-can">
          <li><code>input</code>: the parameters the model filled (<code>null</code> when not given); each also as a variable by its name.</li>
          {api && <li><code>{'request(method, path, body)'}</code> → <code>{'{ status, ok, data }'}</code>: a request to its site, with its access. At most 50.</li>}
          {calls && <li><code>{'tool(name, args, { report: true })'}</code> → <code>{'{ ok, text, data }'}</code>: one of the tools it calls, asked as when the model calls it. With <code>report</code>, the step goes to the model too.</li>}
          {calls && <li><code>note(text)</code>: a line for the model, and for you as it runs.</li>}
          <li>Nothing else: it runs in a sandbox, with no other site and no browser API, and never sees your headers' values nor your cookies.</li>
          <li>{calls ? 'At most the steps and time of Settings → Limits; it runs only from a chat.' : 'At most 30 s a call.'}{!http.readOnly && api ? ' Unless it only reads, every call is confirmed, as an action on the site.' : ''}</li>
        </ul>
      </details>
    </>
  );
}

// The tools a script calls, as chips: added from the tools there are (typed or picked), each removable.
function ToolsPicker({ uses, tools, onChange }: { uses: string[]; tools: string[]; onChange: (uses: string[]) => void }) {
  const [typed, setTyped] = useState('');
  const add = (name: string) => {
    const n = name.trim();
    if (n && !uses.includes(n)) onChange([...uses, n]);
    setTyped('');
  };
  const unknown = uses.filter((u) => !tools.includes(u));
  return (
    <div className="tools-picker">
      <div className="field-label">The tools it calls, with <code>tool()</code> (only these; none: it only calls its site)</div>
      <div className="row tools-picker-row">
        {uses.map((u) => (
          <span key={u} className={`chip-removable${unknown.includes(u) ? ' warn' : ''}`} title={unknown.includes(u) ? 'Not a tool you have now' : undefined}>
            <code>{u}</code>
            <button className="icon-button" aria-label={`Remove ${u}`} title="Remove" onClick={() => onChange(uses.filter((x) => x !== u))}>✕</button>
          </span>
        ))}
        <input aria-label="Add a tool it calls" className="mono narrow-input" list="script-tools" value={typed} placeholder="＋ browser.find"
          onChange={(e) => {
            setTyped(e.target.value);
            if (tools.includes(e.target.value)) add(e.target.value); // picked from the list
          }}
          onKeyDown={(e) => {
            if (isEnter(e) || e.key === ',') {
              e.preventDefault();
              add(typed);
            }
          }} />
        <datalist id="script-tools">{tools.filter((t) => !uses.includes(t)).map((t) => <option key={t} value={t} />)}</datalist>
      </div>
    </div>
  );
}
