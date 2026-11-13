import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { BUSY_MS, loadQuickJS, MAX_REQUESTS, runScript, type ScriptJob } from '../src/script/quickjs';

// The engine scripts run in (script/quickjs), its WebAssembly read from the package as the build copies it.
const bytes = readFileSync('node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm');
const load = () => loadQuickJS(async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const ok = (data: unknown) => ({ status: 200, ok: true, data });
const run = (code: string, more: Partial<ScriptJob> = {}) => runScript({ code, input: {}, request: async () => ok(null), ...more }, load);
const failure = (code: string, more: Partial<ScriptJob> = {}) => run(code, more).then(() => '', (e: Error) => e.message);

const SCOPE = '\nA script has input and its inputs by name, request(method, path, body), tool(name, args) for the tools in uses ' +
  '(the browser\'s go as tool("browser.navigate", { url })) and note(text); nothing else.';

describe('the script engine', () => {
  it('returns what the script returned, as JSON, and the requests it made', async () => {
    const request = vi.fn(async (method: string, path: string) => ok({ items: [{ id: 1, path, method }] }));
    const r = await run('const a = await request("GET", "/api/items");\nconst b = await request("GET", "/api/more");\nreturn { n: a.data.items.length + b.data.items.length, first: a.data.items[0], at: new Date(0).toISOString(), f: () => 1, u: undefined };', { request });
    expect(r).toEqual({ value: { n: 2, first: { id: 1, path: '/api/items', method: 'GET' }, at: '1970-01-01T00:00:00.000Z' }, requests: 2 });
    expect(request).toHaveBeenCalledWith('GET', '/api/items', undefined);
  });
  it('sends a body as given, and runs requests together', async () => {
    const request = vi.fn(async (_m: string, _p: string, body: unknown) => ok(body));
    const r = await run('const all = await Promise.all([1, 2, 3].map((n) => request("POST", "/api", { n })));\nreturn all.map((a) => a.data.n);', { request });
    expect(r.value).toEqual([1, 2, 3]);
  });
  it('gives each input as a variable by its name too, and returns null for nothing', async () => {
    expect((await run('return query + input.query;', { input: { query: 'ab' } })).value).toBe('abab');
    expect((await run('const x = 1;')).value).toBeNull();
  });
  it('a request that fails throws in the script, which may catch it', async () => {
    const request = async () => Promise.reject(new Error('No access to example.com.'));
    expect((await run('try { await request("GET", "/x"); } catch (e) { return "caught: " + e.message; }', { request })).value).toBe('caught: No access to example.com.');
    expect(await failure('await request("GET", "/x");', { request })).toBe('The script failed: No access to example.com.');
  });
  it(`stops the script at its request number ${MAX_REQUESTS + 1}, without making it`, async () => {
    const request = vi.fn(async () => ok(1));
    expect(await failure('for (;;) await request("GET", "/x");', { request })).toBe(`The script made more than ${MAX_REQUESTS} requests.`);
    expect(request).toHaveBeenCalledTimes(MAX_REQUESTS);
  });
  it('stops an endless loop at its time limit', async () => {
    const steps = { tool: vi.fn(), note: vi.fn(), maxSteps: 5, timeMs: 300 };
    const started = Date.now();
    expect(await failure('while (true) {}', { steps })).toMatch(/did not finish in 0.3 s/);
    expect(Date.now() - started).toBeLessThan(3000);
  });
  it(`stops code that runs on without waiting for ${BUSY_MS / 1000} s, long before its time limit`, async () => {
    const started = Date.now();
    const message = await failure('while (true) {}', { timeMs: 60_000 });
    expect(message).toBe(`The script failed: it ran for ${BUSY_MS / 1000} s without waiting for anything (an endless loop?), and was stopped so that it does not hold the extension.`);
    expect(Date.now() - started).toBeLessThan(BUSY_MS + 2000);
  });
  it('counts the time it runs on again after each answer, so that long work between requests goes on', async () => {
    const spin = `{ const t = Date.now(); while (Date.now() - t < ${BUSY_MS * 0.7}) {} }`;
    const r = await run(`${spin}\nawait request("GET", "/a");\n${spin}\nawait request("GET", "/b");\n${spin}\nreturn "done";`, { timeMs: 60_000 });
    expect(r).toEqual({ value: 'done', requests: 2 });
  });
  it('takes the time limit the caller sets', async () => {
    const never = () => new Promise<never>(() => {});
    expect(await failure('await request("GET", "/slow");', { request: never, timeMs: 150 })).toBe('The script did not finish in 0.15 s.');
  });
  it('stops a script waiting on a request at its time limit, and when the signal says so', async () => {
    const steps = { tool: vi.fn(), note: vi.fn(), maxSteps: 5, timeMs: 200 };
    const never = () => new Promise<never>(() => {});
    expect(await failure('await request("GET", "/slow");', { request: never, steps })).toBe('The script did not finish in 0.2 s.');
    const stop = new AbortController();
    const stopped = failure('await request("GET", "/slow");', { request: never, signal: stop.signal });
    stop.abort();
    expect(await stopped).toBe('Stopped.');
  });
  it('calls tools and notes for a script that calls tools, and refuses them for one that does not', async () => {
    const tool = vi.fn(async (name: string, args: unknown) => ({ ok: true, text: `${name} ${JSON.stringify(args)}` }));
    const note = vi.fn();
    const r = await run('note("looking");\nconst a = await tool("browser.find", { sel: "a" }, { report: true });\nreturn a.text;', { steps: { tool, note, maxSteps: 5, timeMs: 5000 } });
    expect(r.value).toBe('browser.find {"sel":"a"}');
    expect(tool).toHaveBeenCalledWith('browser.find', { sel: 'a' }, true);
    expect(note).toHaveBeenCalledWith('looking');
    expect(await failure('await tool("browser.find", {});')).toBe('The script failed: This script calls no tools: list them in its "uses".');
  });
  it('reaches no browser API and no network', async () => {
    expect((await run('return [typeof fetch, typeof XMLHttpRequest, typeof chrome, typeof browser, typeof setTimeout, typeof document];')).value).toEqual(Array(6).fill('undefined'));
  });
  it('has a console that goes nowhere, and URLSearchParams', async () => {
    expect((await run('console.log("x");\nconst q = new URLSearchParams({ q: "a b", n: 2 });\nq.append("t", "é");\nreturn [q.toString(), new URLSearchParams("?a=1&b=x+y").get("b")];')).value)
      .toEqual(['q=a%20b&n=2&t=%C3%A9', 'x y']);
  });
  it('says what a script has when it uses a name it does not have', async () => {
    expect(await failure('await navigate("https://example.com");\nreturn 1;')).toBe(`The script failed: navigate is not defined${SCOPE}`);
  });
  it('adds nothing to the errors the script throws itself', async () => {
    expect(await failure('throw new Error("items: 404");')).toBe('The script failed: items: 404');
  });
  it('says where the code does not parse, with the line', async () => {
    const message = await failure('const a = 1;\nconst t = Math.max(30, Math.min(280, Number(input.t || 240))));\nreturn t;');
    expect(message).toMatch(/^The script failed: SyntaxError: .+ at line 2, column 62:\nconst t = Math\.max/);
    expect(message).toContain('\n' + ' '.repeat(61) + '^\n');
    expect(message.endsWith('The code is the body of an async function: no import or export.')).toBe(true);
  });
  it('says an input is a variable already when the code declares it again', async () => {
    const message = await failure('const query = String(input.query);\nreturn query;', { input: { query: 'ab' } });
    expect(message).toContain('at line 1');
    expect(message).toContain('query is already a variable: each input is one, by its name (and in input). Use it, or another name.');
  });
  it('says how to fix an await in a function that is not async', async () => {
    expect(await failure('const seen = (sel) => refsOf(await tool("browser.find", { sel }));\nreturn seen("a");')).toContain('await works only inside an async function');
  });
  // Before, these waited for the time limit and said "did not finish".
  it('ends with the reason when what it returns cannot be made JSON', async () => {
    expect(await failure('const o = {}; o.o = o; return o;')).toMatch(/^The script failed: .*circular/i);
    expect(await failure('return 1n;')).toMatch(/^The script failed: .*BigInt/);
  });
  it('ends with the reason when an answer does not fit in its memory', async () => {
    const request = async () => ok('x'.repeat(70 << 20));
    expect(await failure('const a = await request("GET", "/big");\nreturn a.data.length;', { request })).toBe('The script failed: out of memory');
  }, 30_000);
  // One string past the limit at once: the engine refuses it in milliseconds. A script that grows its memory
  // step by step takes seconds on a loaded machine, and was stopped for running on (BUSY_MS) instead.
  it('stops a script that takes too much memory', async () => {
    expect(await failure('const s = "x".repeat(100 << 20);\nreturn s.length;')).toBe('The script failed: out of memory');
  });
});
