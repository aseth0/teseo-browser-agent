// Runs a custom tool's script (base "script") in QuickJS, a JavaScript engine compiled to WebAssembly:
// in the background itself (script/away) or in the page that tries it (ui/custom-tools/Try), without an
// offscreen document, a sandboxed frame or eval, so in every browser. The engine is a world of its own:
// no browser API, no network, no timers. The script's only ways out are request() to the tool's site,
// and tool() and note() for a script that calls tools, done here by the caller; each request is counted
// (at most MAX_REQUESTS), and it stops at its time limit, at its memory limit, or when the signal says so.
// The engine runs in the caller's thread (the background's, for the chat): code that runs on without
// waiting for anything (an endless loop) is stopped after BUSY_MS, so that it never holds the extension.
import { newQuickJSWASMModuleFromVariant, newVariant, type QuickJSHandle, type QuickJSWASMModule } from 'quickjs-emscripten-core';
import RELEASE_SYNC from '@jitl/quickjs-wasmfile-release-sync';
import { errorText } from '../core/errors';

const SCRIPT_TIME_MS = 30_000; // when the caller sets none (Settings → Limits: scriptTime, scriptStepsTime)
export const MAX_REQUESTS = 50;
// How long the script may run on without awaiting anything, each time the engine runs it.
export const BUSY_MS = 1500;
const MEMORY_BYTES = 64 * 1024 * 1024;
const STACK_BYTES = 1024 * 1024;
// Where the build puts the engine's WebAssembly (wxt.config.ts): read as bytes, so that its loader never
// has to find it by itself (the background is a single script without a URL of its own).
export const QUICKJS_WASM_PATH = '/quickjs/emscripten-module.wasm';

// What tool() resolves to in the script.
export interface ToolAnswer {
  ok: boolean;
  text: string;
  data?: unknown; // when the tool gives structured data
}
// For a script that calls tools (script/steps): its tool() and note(), done by the caller; how many
// steps and how long it may take.
export interface ScriptSteps {
  tool: (name: string, args: unknown, report: boolean) => Promise<ToolAnswer>;
  note: (text: string) => void;
  maxSteps: number;
  timeMs: number;
}

// What request() resolves to in the script.
export interface ScriptResponse {
  status: number;
  ok: boolean;
  data: unknown; // the JSON answer, or its text
}
type ScriptRequest = (method: string, path: string, body: unknown) => Promise<ScriptResponse>;

export interface ScriptRun {
  value: unknown; // what the script returned, as JSON
  requests: number;
}

// What a script runs with: its input, how it makes HTTP requests, and the tools it may call (steps).
export interface ScriptJob {
  code: string;
  input: Record<string, unknown>;
  request: ScriptRequest;
  signal?: AbortSignal;
  timeMs?: number; // all it may take (a script that calls tools: its steps' timeMs)
  steps?: ScriptSteps;
}

// The engine, loaded once per page or worker. `wasm` gives its bytes (the tests read them from the package).
let loading: Promise<QuickJSWASMModule> | undefined;
export function loadQuickJS(wasm: () => Promise<ArrayBuffer> = extensionWasm): Promise<QuickJSWASMModule> {
  loading ??= newQuickJSWASMModuleFromVariant(newVariant(RELEASE_SYNC, { wasmBinary: wasm })).catch((e: unknown) => {
    loading = undefined;
    throw new Error(`The script engine could not load: ${errorText(e)}`);
  });
  return loading;
}
// From the extension's own files, wherever it runs (its pages, its service worker or background page).
const extensionWasm = async (): Promise<ArrayBuffer> => (await fetch(new URL(QUICKJS_WASM_PATH, location.href))).arrayBuffer();

// The parameters go as names of their own too (query besides input.query), but not those that cannot be.
const RESERVED = new Set(('await break case catch class const continue debugger default delete do else enum export extends false finally for ' +
  'function if implements import in instanceof interface let new null package private protected public return static super switch this throw ' +
  'true try typeof var void while with yield input request tool note arguments eval').split(' '));
const asName = (key: string) => /^[A-Za-z_$][\w$]*$/.test(key) && !RESERVED.has(key);

const SCOPE = '\nA script has input and its inputs by name, request(method, path, body), tool(name, args) for the tools in uses ' +
  '(the browser\'s go as tool("browser.navigate", { url })) and note(text); nothing else.';
const BODY = 'The code is the body of an async function: no import or export.';
const SHOWN = 160; // of a line, around the column

// What the engine lacks that scripts written for a browser may use: a console that goes nowhere (the
// model sees what the script returns or notes), and URLSearchParams for a query.
const PRELUDE = `
globalThis.console = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
globalThis.URLSearchParams = class URLSearchParams {
  constructor(init) {
    this.pairs = [];
    if (typeof init === 'string') for (const part of init.replace(/^\\?/, '').split('&')) {
      if (!part) continue;
      const at = part.indexOf('=');
      const dec = (s) => decodeURIComponent(s.replace(/\\+/g, ' '));
      this.pairs.push(at < 0 ? [dec(part), ''] : [dec(part.slice(0, at)), dec(part.slice(at + 1))]);
    } else if (init) for (const [k, v] of Array.isArray(init) ? init : Object.entries(init)) this.pairs.push([String(k), String(v)]);
  }
  append(k, v) { this.pairs.push([String(k), String(v)]); }
  set(k, v) { this.delete(k); this.append(k, v); }
  get(k) { const p = this.pairs.find(([n]) => n === k); return p ? p[1] : null; }
  getAll(k) { return this.pairs.filter(([n]) => n === k).map(([, v]) => v); }
  has(k) { return this.pairs.some(([n]) => n === k); }
  delete(k) { this.pairs = this.pairs.filter(([n]) => n !== k); }
  entries() { return this.pairs[Symbol.iterator](); }
  [Symbol.iterator]() { return this.entries(); }
  toString() { return this.pairs.map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&'); }
};`;

export async function runScript({ code, input, request, signal, timeMs: total, steps }: ScriptJob, load: () => Promise<QuickJSWASMModule> = loadQuickJS): Promise<ScriptRun> {
  signal?.throwIfAborted();
  const engine = await load();
  const timeMs = steps?.timeMs ?? total ?? SCRIPT_TIME_MS;
  const deadline = Date.now() + timeMs;
  const runtime = engine.newRuntime();
  runtime.setMemoryLimit(MEMORY_BYTES);
  runtime.setMaxStackSize(STACK_BYTES);
  let requests = 0;
  let stepsTaken = 0;
  let ended = false;
  let stopping = false; // asked to end while the engine runs: it stops at once, and ends after
  let busy = 0; // calls into the engine under way: it is never disposed from inside one
  let ranFrom = 0; // when the engine last began to run the script
  let ranOn = false; // stopped for running on without waiting (BUSY_MS)
  runtime.setInterruptHandler(() => {
    if (stopping || Date.now() > deadline || signal?.aborted) return true;
    // Only while it runs the script (busy): never while the extension hands it an answer.
    ranOn = busy > 0 && Date.now() - ranFrom > BUSY_MS;
    return ranOn;
  });
  const vm = runtime.newContext();
  const inside = <T>(f: () => T): T => {
    if (!busy) ranFrom = Date.now();
    busy++;
    try {
      return f();
    } finally {
      busy--;
    }
  };
  const pending = new Set<{ dispose(): void; alive: boolean }>();
  const owned: QuickJSHandle[] = []; // host functions the engine holds until the end

  return new Promise<ScriptRun>((resolve, reject) => {
    const end = (error?: Error, value?: unknown) => {
      if (ended) return;
      if (busy) {
        stopping = true;
        queueMicrotask(() => end(error, value));
        return;
      }
      ended = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      for (const d of pending) if (d.alive) d.dispose();
      for (const h of owned) if (h.alive) h.dispose();
      vm.dispose();
      runtime.dispose();
      if (error) reject(error);
      else resolve({ value, requests });
    };
    const timer = setTimeout(() => end(new Error(`The script did not finish in ${timeMs / 1000} s.`)), timeMs);
    const onAbort = () => end(new Error('Stopped.'));
    signal?.addEventListener('abort', onAbort);
    if (signal?.aborted) return onAbort(); // stopped while the engine loaded

    // Values cross as JSON, the engine's own JSON.parse making them there. Either way may throw (a value
    // JSON cannot hold, the memory limit): the handles made on the way are freed all the same.
    const toGuest = (value: unknown): QuickJSHandle => {
      if (value === undefined) return vm.undefined;
      const json = vm.getProp(vm.global, 'JSON');
      const fn = vm.getProp(json, 'parse');
      let text: QuickJSHandle | undefined;
      try {
        text = vm.newString(JSON.stringify(value));
        return vm.unwrapResult(vm.callFunction(fn, json, text));
      } finally {
        text?.dispose();
        fn.dispose();
        json.dispose();
      }
    };
    const fromGuest = (handle: QuickJSHandle): unknown => {
      const json = vm.getProp(vm.global, 'JSON');
      const fn = vm.getProp(json, 'stringify');
      const out = vm.callFunction(fn, json, handle);
      fn.dispose();
      json.dispose();
      const made = vm.unwrapResult(out);
      const text = vm.dump(made);
      made.dispose();
      return typeof text === 'string' ? JSON.parse(text) : null;
    };
    // A value that could not cross ends the run with the reason, not at its time limit.
    const failed = (e: unknown) => end(new Error(`The script failed: ${errorText(e)}`));
    // The engine's jobs (its promises' callbacks) run after each answer it gets.
    const pump = () => {
      if (ended) return;
      const jobs = inside(() => runtime.executePendingJobs());
      if (jobs.error) jobs.error.dispose();
    };
    // A call the script awaits, answered by the extension.
    const awaited = (done: () => Promise<unknown>) => {
      const deferred = vm.newPromise();
      pending.add(deferred);
      done().then(
        (answer) => {
          if (ended || !deferred.alive) return;
          let value: QuickJSHandle;
          try {
            value = toGuest(answer);
          } catch (e) {
            return failed(e);
          }
          deferred.resolve(value);
          if (value !== vm.undefined) value.dispose();
          pump();
        },
        (e: unknown) => {
          if (ended || !deferred.alive) return;
          const error = vm.newError(errorText(e));
          deferred.reject(error);
          error.dispose();
          pump();
        },
      );
      return deferred.handle;
    };

    // An argument the script left out comes as no handle at all.
    const given = (h: QuickJSHandle | undefined): unknown => (h === undefined ? undefined : vm.dump(h));
    const requestFn = vm.newFunction('request', (method, path, body) => {
      if (++requests > MAX_REQUESTS) {
        end(new Error(`The script made more than ${MAX_REQUESTS} requests.`));
        return vm.undefined;
      }
      const args = [given(method), given(path), given(body)] as const;
      return awaited(() => request(String(args[0]), String(args[1]), args[2]));
    });
    // A tool's answer: { ok, text, data }. With { report: true } the step goes to the model too.
    const toolFn = vm.newFunction('tool', (name, args, opts) => {
      const asked = { name: String(given(name)), args: args === undefined || vm.typeof(args) === 'undefined' ? {} : fromGuest(args) };
      const report = opts !== undefined && vm.typeof(opts) === 'object' && (vm.dump(opts) as { report?: unknown } | null)?.report === true;
      if (!steps) return awaited(() => Promise.reject(new Error('This script calls no tools: list them in its "uses".')));
      if (++stepsTaken > steps.maxSteps) {
        end(new Error(`The script called tools more than ${steps.maxSteps} times (Settings → Limits).`));
        return vm.undefined;
      }
      return awaited(() => steps.tool(asked.name, asked.args, report));
    });
    const noteFn = vm.newFunction('note', (text) => {
      steps?.note(String(given(text)));
      return vm.undefined;
    });
    owned.push(requestFn, toolFn, noteFn);
    for (const [name, fn] of [['request', requestFn], ['tool', toolFn], ['note', noteFn]] as const) vm.setProp(vm.global, name, fn);
    const prelude = vm.evalCode(PRELUDE, 'prelude.js');
    if (prelude.error) prelude.error.dispose();
    else prelude.value.dispose();

    const names = Object.keys(input).filter(asName);
    const compiled = vm.evalCode(`(async function (input, request, tool, note${names.map((n) => `, ${n}`).join('')}) {\n${code}\n})`, 'script.js');
    if (compiled.error) {
      const error = vm.dump(compiled.error) as { name?: string; message?: string; stack?: string };
      compiled.error.dispose();
      return end(new Error(`The script failed: ${syntaxMessage(code, names, error)}`));
    }
    const values = [toGuest(input), ...names.map((n) => toGuest(input[n] ?? null))];
    const called = inside(() => vm.callFunction(compiled.value, vm.undefined, values[0]!, requestFn, toolFn, noteFn, ...values.slice(1)));
    compiled.value.dispose();
    values.forEach((h) => h !== vm.undefined && h.dispose());
    if (called.error) {
      const error = vm.dump(called.error) as { name?: string; message?: string };
      called.error.dispose();
      return end(new Error(`The script failed: ${runMessage(error, timeMs, ranOn)}`));
    }
    // Its end, as the engine's promise settles: our own then() callbacks, freed with the rest.
    const promise = called.value;
    const settledFns = [
      vm.newFunction('done', (value) => {
        let made: unknown;
        try {
          made = value === undefined ? null : (fromGuest(value) ?? null);
        } catch (e) {
          failed(e);
          return vm.undefined;
        }
        end(undefined, made);
        return vm.undefined;
      }),
      vm.newFunction('fail', (error) => {
        end(new Error(`The script failed: ${runMessage(error === undefined ? undefined : (vm.dump(error) as { name?: string; message?: string } | string), timeMs, ranOn)}`));
        return vm.undefined;
      }),
    ];
    owned.push(...settledFns);
    const then = vm.getProp(promise, 'then');
    const chained = inside(() => vm.callFunction(then, promise, ...settledFns));
    if (chained.error) chained.error.dispose();
    else chained.value.dispose();
    then.dispose();
    promise.dispose();
    pump();
  });
}

// An error the script threw or met while it ran, as the old sandbox said it: its message (a name it does
// not have says what it has; the time limit, as such).
function runMessage(error: { name?: string; message?: string } | string | undefined, timeMs: number, ranOn: boolean): string {
  if (typeof error !== 'object' || !error) return String(error);
  if (error.name === 'InternalError' && error.message === 'interrupted') {
    return ranOn
      ? `it ran for ${BUSY_MS / 1000} s without waiting for anything (an endless loop?), and was stopped so that it does not hold the extension.`
      : `it did not finish in ${timeMs / 1000} s (or it was stopped).`;
  }
  const missing = error.name === 'ReferenceError' ? /^'?([\w$]+)'? is not defined$/.exec(error.message ?? '')?.[1] : undefined;
  if (missing) return `${missing} is not defined${SCOPE}`;
  return error.message ?? String(error);
}

// The code does not parse: said as such, where (the engine gives the line and column, one line down
// for the function around the code), with the line shown, and how to fix it when it can be told.
function syntaxMessage(code: string, names: string[], error: { message?: string; stack?: string }): string {
  const message = error.message ?? 'invalid code';
  const at = /:(\d+):(\d+)/.exec(error.stack ?? '');
  const lines = code.split('\n');
  let where = '. ';
  let hint = '';
  if (at) {
    const lineNumber = Math.min(Math.max(1, Number(at[1]) - 1), lines.length);
    const line = lines[lineNumber - 1] ?? '';
    const column = Math.min(Math.max(1, Number(at[2])), line.length + 1);
    const from = Math.max(0, column - 1 - SHOWN / 2);
    const shown = (from ? '…' : '') + line.slice(from, from + SHOWN) + (from + SHOWN < line.length ? '…' : '');
    where = ` at line ${lineNumber}, column ${column}:\n${shown}\n${' '.repeat(column - 1 - from + (from ? 1 : 0))}^\n`;
    // `const query = …` for an input "query", which is a parameter already.
    const declared = /redefinition/.test(message) ? /(?:const|let|class)\s+([\w$]+)\s*$/.exec(line.slice(0, column + 40).split(/[=;]/)[0] ?? '')?.[1] : undefined;
    if (declared && names.includes(declared)) hint += `${declared} is already a variable: each input is one, by its name (and in input). Use it, or another name.\n`;
    // An await in the body of a function that is not async.
    if (/\bawait\b/.test(line.slice(Math.max(0, column - 40), column + 10))) hint += 'await works only inside an async function: make the function around it async, like async (x) => …\n';
  }
  return `SyntaxError: ${message}${where}${hint}${BODY}`;
}
