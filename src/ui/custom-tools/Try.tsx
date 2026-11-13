// Trying a custom tool from its editor, unsaved: a request or a script, with values typed here; a
// tool you have, preset, shows the call it makes.
import { InlineConfirm } from '../InlineConfirm';
import { writeClip } from '../icons';
import { useMemo, useState } from 'react';
import { AnswerPicker, charsText, cutAnswer, parseAnswer } from './AnswerPicker';
import { cutForReadMore } from '../../core/kept-results';
import { wrappedResultMax } from '../../core/limits';
import { originRuns, stripMarks, withMarkedValues } from '../../core/model-texts';
import { scriptRequest } from '../../script/request';
import { runScript } from '../../script/quickjs';
import { scriptInput, scriptResult } from '../../tools/custom/script-tool';
import { parseValue } from './parse-value';
import { defaultText, type SetTyped } from './ParamEditors';
import type { CustomInput, CustomTool } from '../../tools/custom/types';
import { answerText, hasFixedHost, httpResult, sendRequest } from '../../tools/http';
import { MarkedCode } from '../CodeView';
import { ORIGIN_INFO, originClass } from '../origins';
import { errorText } from '../../core/errors';
import { limit } from '../../core/limits';
import { askSite } from '../ask-permission';
import type { ToolInfo } from '../../core/protocol';
import { toWireName } from '../../core/tool-registry';
import { baseParams, customArgs, customSchema } from '../../tools/custom/runtime';

const HTTP_TRY_MS = 30_000; // a request tried from the editor

// Runs the request as it is in the editor, unsaved, with values typed here, and shows what the model
// would get: its status, time and size, and its JSON answer, whose keys are clicked to cut it
// (`onExtract`). A request that changes things asks first. `onTried`: a line saying how it went.
export function TryRequest({ draft, onExtract, onTried }: { draft: CustomTool; onExtract?: (extract: string | undefined) => void; onTried?: (line: string) => void }) {
  const inputs = draft.inputs ?? [];
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [tried, setResult] = useState<{ status?: number; url?: string; raw?: string; ms?: number; text: string; isError: boolean; of: string } | null>(null);
  const http = draft.http!;
  const writes = http.method !== 'GET';
  // A result is of the request it was tried with: changed since, it no longer shows. Not the cut of
  // its answer, which is picked from it.
  const of = JSON.stringify({ ...http, extract: undefined });
  const result = tried?.of === of ? tried : null;
  const tryIt = async () => {
    if (running) return;
    // Before the site is asked: a second click meanwhile would send it twice.
    setRunning(true);
    setResult(null);
    try {
      const args = typedArgs(inputs, typed);
      // Asked from this click: the browser shows its prompt only when the site is not allowed yet.
      await askSite(http.url.trim());
      const started = performance.now();
      const { status, url, answer, raw, result } = await sendRequest(draft, args, AbortSignal.timeout(HTTP_TRY_MS));
      const ms = Math.round(performance.now() - started);
      // Worded again with the answer marked, for the Layers color of what comes from the web.
      const shown = answer === undefined ? stripMarks(result.text) : withMarkedValues(() => httpResult(status, url, answer));
      setResult({ status, url, raw, ms, text: shown, isError: !!result.isError, of });
      onTried?.(`${result.isError ? '✗' : '✓'} ${status || 'No answer'} · ${ms} ms${raw === undefined ? '' : ` · ${charsText(raw.length)}`}`);
    } catch (e) {
      setResult({ text: errorText(e), isError: true, of });
      onTried?.(`✗ ${errorText(e)}`);
    } finally {
      setRunning(false);
    }
  };
  // The answer read once; then cut as the model gets it, with the cut as it is now (picked or typed
  // since the try), at the length a tool's answer has.
  const raw = result?.raw;
  const json = useMemo(() => parseAnswer(raw), [raw]);
  const cut = useMemo(() => (raw === undefined ? undefined : cutAnswer(json, raw, http.extract)), [json, raw, http.extract]);
  const text = useMemo(() => {
    if (raw === undefined || result?.status === undefined || !result.url) return result?.text;
    // Nothing at the path: the model is told so, with the keys there are (tools/http).
    const answer = cut ?? answerText(raw, http.extract);
    return withMarkedValues(() => httpResult(result.status!, result.url!, cutForReadMore(answer, 'toolResult', draft.name, { max: wrappedResultMax() }).text));
  }, [raw, cut, result?.status, result?.url, result?.text, http.extract, draft.name]);
  return (
    <div className="custom-try">
      <TryInputs inputs={inputs} typed={typed} setTyped={setTyped} />
      <div className="row">
        {/* One that changes things is asked first, here (its click also lets the browser ask for the site). */}
        <InlineConfirm question={`${http.method} changes things on the API's site. Send it?`} action="Send" onConfirm={tryIt}>
          {(ask) => (
            <button onClick={writes ? ask : () => void tryIt()} disabled={running || !hasFixedHost(http.url)}>
              {running ? 'Sending…' : writes ? `Try (sends a ${http.method})…` : 'Try'}
            </button>
          )}
        </InlineConfirm>
        {result && (
          <span className={`try-status ${result.isError ? 'bad' : 'good'}`} role="status">
            {result.isError ? '✗' : '✓'} {result.status ?? 'No answer'}
          </span>
        )}
        {result?.ms !== undefined && <span className="muted small">{result.ms} ms{raw !== undefined ? ` · ${charsText(raw.length)}` : ''}</span>}
        {!hasFixedHost(http.url) && <span className="muted small">Write its URL first.</span>}
      </div>
      {onExtract && (
        <label>Answer cut to (optional: a path into the JSON answer, so the model gets only that)
          <div className="custom-param-head">
            <input aria-label="Answer cut to" className="mono http-url" value={http.extract ?? ''} placeholder="the whole answer, or e.g. items[].{title,url}" onChange={(e) => onExtract(e.target.value || undefined)} />
            {http.extract && <button type="button" onClick={() => onExtract(undefined)}>Clear</button>}
          </div>
        </label>
      )}
      {onExtract && !result && (
        <p className="hint">
          Try it to pick the keys from its answer, or write the path: keys joined by dots (<code>data.user.name</code>), a
          position in a list (<code>items.0</code>), <code>[]</code> for each element (<code>items[].title</code>) and{' '}
          <code>{'{a,b}'}</code> to keep several keys.
        </p>
      )}
      {result && json !== undefined && raw !== undefined && onExtract && <AnswerPicker json={json} rawLength={raw.length} cutLength={cut?.length} extract={http.extract ?? ''} onExtract={onExtract} />}
      {result && text !== undefined && <WhatTheModelGets text={text} />}
    </div>
  );
}

// A try's answer as the model would get it, with the Layers colors of where each part comes from.
function WhatTheModelGets({ text }: { text: string }) {
  const [format, setFormat] = useState(true);
  return (
    <details className="text-block" open>
      <summary>What the model would get</summary>
      <p className="hint origin-legend">
        {[...new Set(originRuns(text).flatMap((r) => (r.origin ? [r.origin] : [])))].map((o) => (
          <mark key={o} className={originClass(o)} title={ORIGIN_INFO[o].about}>{o === 'tool' ? 'From the API (the web)' : ORIGIN_INFO[o].label}</mark>
        ))}
        <label className="check"><input type="checkbox" checked={format} onChange={(e) => setFormat(e.target.checked)} /> Format JSON (the model gets it as it came)</label>
      </p>
      <pre><MarkedCode text={text} format={format} /></pre>
    </details>
  );
}

// The values typed to try a tool with, by parameter (its default when left as it is).
function TryInputs({ inputs, typed, setTyped }: { inputs: CustomInput[]; typed: Record<string, string>; setTyped: SetTyped }) {
  return (
    <>
      {inputs.map((i) => (
        <label key={i.name} className="custom-param-head">
          <span className="mono narrow-input">{i.name}</span>
          <input aria-label={`Try value of ${i.name}`} className="mono http-url" value={typed[i.name] ?? defaultText(i)} placeholder={i.type}
            onChange={(e) => setTyped((t) => ({ ...t, [i.name]: e.target.value }))} />
        </label>
      ))}
    </>
  );
}
const typedArgs = (inputs: CustomInput[], typed: Record<string, string>) =>
  Object.fromEntries(inputs.flatMap((i) => {
    const raw = typed[i.name] ?? defaultText(i);
    return raw === '' ? [] : [[i.name, tryValue(i, raw)]];
  }));


// Runs the script as it is in the editor, unsaved, in the script engine (script/quickjs) in this page; its requests go from
// here with its access. One that may change things asks first.
export function TryScript({ draft, onTried }: { draft: CustomTool; onTried?: (line: string) => void }) {
  // One that calls tools needs a chat: its steps are asked there, as the model's calls.
  if (draft.uses?.length) return <TryInChat name={draft.name} />;
  return <TryScriptHere draft={draft} onTried={onTried} />;
}

function TryInChat({ name }: { name: string }) {
  const mention = `$${name.trim() || 'its.name'}`;
  return (
    <>
      <p className="hint">
        A script that calls tools is tried from the chat, where each step is asked as when the model calls it: save it, then write{' '}
        <code>{mention}</code> in a message. Its steps show under its call as they run.
      </p>
      <div className="row">
        <button onClick={() => void writeClip(mention).catch(() => undefined)} disabled={!name.trim()}>Copy {mention}</button>
      </div>
    </>
  );
}

function TryScriptHere({ draft, onTried }: { draft: CustomTool; onTried?: (line: string) => void }) {
  const inputs = draft.inputs ?? [];
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [tried, setResult] = useState<{ requests?: number; text: string; isError: boolean; of: string } | null>(null);
  const [made, setCalls] = useState<{ of: string; lines: string[] }>({ of: '', lines: [] }); // the requests it made, with their status: to see why it failed
  const http = draft.http!;
  const site = hasFixedHost(http.url) ? new URL(http.url).host : '';
  // A result is of the script and access it was tried with: changed since, it no longer shows.
  const of = JSON.stringify([http, draft.script]);
  const result = tried?.of === of ? tried : null;
  const calls = made.of === of ? made.lines : [];
  const tryIt = async () => {
    if (running) return;
    // Before the site is asked: a second click meanwhile would run it twice.
    setRunning(true);
    setResult(null);
    setCalls({ of, lines: [] });
    try {
      const args = typedArgs(inputs, typed);
      await askSite(http.url.trim());
      // As long as it may take in a chat (Settings → Limits); its requests are cut a little later, so
      // that the engine's own message says why it stopped.
      const timeMs = limit('scriptTime') * 1000;
      const signal = AbortSignal.timeout(timeMs + 5000);
      const request = async (method: string, path: string, body: unknown) => {
        const line = `${method.toUpperCase()} ${path}`;
        try {
          const response = await scriptRequest(http, method, path, body, signal);
          setCalls((c) => ({ ...c, lines: [...c.lines, `${line} → ${response.status}${response.ok ? '' : `: ${JSON.stringify(response.data).slice(0, 160)}`}`] }));
          return response;
        } catch (e) {
          setCalls((c) => ({ ...c, lines: [...c.lines, `${line} → not sent: ${errorText(e)}`] }));
          throw e;
        }
      };
      const started = performance.now();
      const run = await runScript({ timeMs, code: draft.script ?? '', input: scriptInput(draft, args), request, signal });
      setResult({ requests: run.requests, text: withMarkedValues(() => scriptResult(draft.name || 'the tool', run)), isError: false, of });
      onTried?.(`✓ ${run.requests} ${run.requests === 1 ? 'request' : 'requests'} · ${Math.round(performance.now() - started)} ms`);
    } catch (e) {
      setResult({ text: errorText(e), isError: true, of });
      onTried?.(`✗ ${errorText(e)}`);
    } finally {
      setRunning(false);
    }
  };
  return (
    <div className="custom-try">
      <TryInputs inputs={inputs} typed={typed} setTyped={setTyped} />
      <div className="row">
        {result && (
          <span className={`try-status ${result.isError ? 'bad' : 'good'}`} role="status">
            {result.isError ? '✗ Failed' : `✓ ${result.requests} ${result.requests === 1 ? 'request' : 'requests'}`}
          </span>
        )}
        <InlineConfirm question={`The script may change things on ${site}. Run it?`} action="Run" onConfirm={tryIt}>
          {(ask) => (
            <button onClick={http.readOnly ? () => void tryIt() : ask} disabled={running || !site || !draft.script?.trim()}>
              {running ? 'Running…' : http.readOnly ? 'Try' : 'Try (may change things)…'}
            </button>
          )}
        </InlineConfirm>
        {(!site || !draft.script?.trim()) && <span className="muted small">{!site ? 'Say its site first.' : 'Write its script first.'}</span>}
      </div>
      {calls.length > 0 && (
        <details className="text-block" open={!!result?.isError}>
          <summary>Its requests ({calls.length})</summary>
          <pre className="mono small">{calls.join('\n')}</pre>
        </details>
      )}
      {result && <WhatTheModelGets text={result.text} />}
    </div>
  );
}

// A typed value as its parameter's type, or why not ("stars: a number").
function tryValue(input: CustomInput, raw: string): unknown {
  try {
    return parseValue(raw, input.type);
  } catch (e) {
    throw new Error(`${input.name}: ${errorText(e)}`);
  }
}

// A tool you have, preset, tried here: the values the model would give, and the call it makes with them
// (its fixed values and texts around them put in). It is not run from Settings, where the tool's
// confirmation and the site's policy do not apply: the chat runs it, from a mention once saved.
export function TryShortcut({ draft, base, typed: fixed }: { draft: CustomTool; base: Pick<ToolInfo, 'name' | 'inputSchema'>; typed: Record<string, string> }) {
  const [typed, setTyped] = useState<Record<string, string>>({});
  const schema = customSchema(draft, base) as { properties?: Record<string, { type?: string }> };
  const inputs = Object.entries(schema.properties ?? {}).map(([name, p]) => ({ name, type: p.type ?? 'string' }) as CustomInput);
  // The fixed values as typed so far (one not read yet is left out).
  const params = Object.fromEntries(Object.entries(draft.params).map(([name, rule]) => {
    if (rule.mode !== 'fixed') return [name, rule];
    try {
      return [name, { mode: 'fixed', value: parseValue(fixed[name] ?? '', baseParams(base)[name]?.type) }];
    } catch {
      return [name, { mode: 'fixed', value: undefined }];
    }
  })) as CustomTool['params'];
  let call: string;
  try {
    call = `${toWireName(base.name)} ${JSON.stringify(customArgs({ ...draft, params }, typedArgs(inputs, typed), base), null, 2)}`;
  } catch (e) {
    call = errorText(e);
  }
  const mention = `$${draft.name.trim() || 'its.name'}`;
  return (
    <>
      <div className="custom-try">
        <TryInputs inputs={inputs} typed={typed} setTyped={setTyped} />
        <p className="hint">The call it makes:</p>
        <pre className="mono small custom-call">{call}</pre>
        <p className="hint">
          To run it, with its confirmation and the site's policy: save it, then write <code>{mention}</code> in a message.
        </p>
        <div className="row"><button onClick={() => void writeClip(mention).catch(() => undefined)} disabled={!draft.name.trim()}>Copy {mention}</button></div>
      </div>
    </>
  );
}
