// An HTTP request's parameters, once its request is written: the values found in its URL and body,
// each fixed, filled by the model (then an input, whose description is asked right there) or a saved
// value (sent only to its site, never seen by the model); and the inputs it has.
import { useMemo, useState } from 'react';
import { fixAgain, fixSecret, foundValues, keepAsSecret, letModelFill, whoSets, type FixedValue, type FoundValue, type Who } from '../../tools/custom/found-values';
import { uniqueName } from '../../tools/custom/names';
import { decode } from '../../tools/custom/request-url';
import { placeholdersOf } from '../../tools/custom/values';
import type { CustomTool } from '../../tools/custom/types';
import { Segmented } from '../Segmented';
import type { ProblemsAt } from '../guide';
import type { IssueField } from '../../tools/custom/validate';
import { InputsEditor } from './ParamEditors';

const WHERE = { path: 'in the path', query: 'in the query', body: 'in the body' } as const;
const INPUT_NAME = /^[a-z][a-z0-9_]*$/;

const valueLabel = (f: FoundValue) => (f.where === 'query' ? `?${f.label}=` : f.where === 'body' ? `"${f.label}":` : `/${f.label ? `${f.label}/` : ''}`);
const pathWhat = (f: FoundValue) => (f.minor ? `the path part ${f.value}` : `the ${f.suspect ? 'key' : 'id'} ${f.label ? `after ${f.label}` : 'in the path'}`);
const whoLabel = (f: FoundValue) => `Who sets ${f.where === 'path' ? pathWhat(f) : f.label}`;

// What a value fixed again reads as.
const shownValue = (was: FixedValue) => (was.inJson.startsWith('"') ? (JSON.parse(was.inJson) as string) : decode(was.inUrl));

export function RequestParams({ draft, patch, problemsAt }: { draft: CustomTool; patch: (change: Partial<CustomTool>) => void; problemsAt: ProblemsAt<IssueField> }) {
  const http = draft.http!;
  const inputs = draft.inputs ?? [];
  // The values made inputs here, by the input's name: to fix them again (kept while the step folds).
  const [madeFrom, setMadeFrom] = useState<Record<string, FixedValue>>({});
  const found = useMemo(() => foundValues(http), [http]);
  const [main, minor] = useMemo(() => [found.filter((f) => !f.minor), found.filter((f) => f.minor)], [found]);
  const used = useMemo(() => new Set([...placeholdersOf(http.url), ...(http.method === 'GET' ? [] : placeholdersOf(http.body ?? ''))]), [http.url, http.body, http.method]);

  const choose = (f: FoundValue, who: Who) => {
    if (who === whoSets(f)) return;
    if (who === 'model') {
      const name = uniqueName(INPUT_NAME.test(f.name) ? f.name : 'value', new Set(inputs.map((i) => i.name)));
      const made = letModelFill(http, f, name);
      patch({ http: made.http, inputs: [...inputs, { name, type: f.type, description: '', required: true }] });
      if (made.was) setMadeFrom((m) => ({ ...m, [name]: made.was! }));
    } else if (who === 'secret') {
      patch({ http: keepAsSecret(http, f, uniqueName(f.name, new Set(Object.keys(http.secrets ?? {})))) });
    } else patch({ http: fixSecret(http, f) });
  };
  const fix = (name: string) => {
    patch({ http: fixAgain(http, name, madeFrom[name]!), inputs: inputs.filter((i) => i.name !== name) });
    setMadeFrom(({ [name]: _, ...rest }) => rest);
  };
  // A name changed (once its box is left): {old} written {new} in the request, unless the new name is
  // another input's (their places would merge) or the old one is still another's.
  const renamed = (from: string, to: string, at: number): Partial<CustomTool> => {
    const others = inputs.filter((_, j) => j !== at).map((i) => i.name);
    if (!INPUT_NAME.test(from) || !INPUT_NAME.test(to) || from === to || others.includes(to) || others.includes(from)) return {};
    if (madeFrom[from]) setMadeFrom(({ [from]: was, ...rest }) => ({ ...rest, [to]: was! }));
    const swap = (t: string) => t.split(`{${from}}`).join(`{${to}}`);
    return { http: { ...http, url: swap(http.url), ...(http.body !== undefined && { body: swap(http.body) }) } };
  };

  return (
    <>
      {main.length > 0 && <div className="field-label">Values in the request</div>}
      {main.map((f) => <FoundRow key={f.id} f={f} choose={choose} />)}
      {minor.length > 0 && (
        <details className="settings-fold">
          <summary>Other parts of the path ({minor.length}): to make one a saved value</summary>
          {minor.map((f) => <FoundRow key={f.id} f={f} choose={choose} />)}
        </details>
      )}
      <div className="field-label">{inputs.length ? 'What the model fills' : 'The model fills nothing yet'}</div>
      {!inputs.length && !found.length && <p className="hint">Add an input, then put it in the request (step 2) with a click on it.</p>}
      <InputsEditor draft={draft} patch={patch} problemsAt={problemsAt} renamed={renamed}
        extra={(input) => (
          <div className="row input-origin">
            {madeFrom[input.name] && (
              <Segmented label={`Who sets ${input.name}`} className="compact" value="model" onChange={(v) => v === 'fixed' && fix(input.name)}
                options={[{ value: 'fixed', label: `Fixed: ${shownValue(madeFrom[input.name]!)}` }, { value: 'model', label: 'The model fills it' }]} />
            )}
            {input.name && !used.has(input.name) && <span className="muted small">Not in the request yet: insert {`{${input.name}}`} in its URL or body.</span>}
          </div>
        )} />
    </>
  );
}

// A value found in the request, and who sets it.
function FoundRow({ f, choose }: { f: FoundValue; choose: (f: FoundValue, who: Who) => void }) {
  return (
    <div className="custom-param">
      <div className="custom-param-head">
        <code>{valueLabel(f)}</code>
        <span className="mono found-value-text" title={f.secret ? undefined : f.value}>{f.secret ? `saved value ${f.secret}` : f.value}</span>
        <span className="muted small">{WHERE[f.where]}</span>
        {f.suspect && <span className="badge accent" title="The model reads a fixed value with the request: make it a saved value">looks like a key</span>}
        <span className="spacer" />
        <Segmented label={whoLabel(f)} className="compact" value={whoSets(f)} onChange={(who) => choose(f, who)}
          options={[
            { value: 'fixed', label: 'Fixed' },
            { value: 'model', label: 'The model fills it' },
            { value: 'secret', label: 'Saved value', title: 'Sent only to its site, never shown to the model; the tool then asks you every time it runs' },
          ]} />
      </div>
    </div>
  );
}
