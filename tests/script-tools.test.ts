import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stripMarks } from '../src/core/model-texts';
import { fakeBrowser, fakeSecretDb, fakeStorage, mockFetch, redirecting } from './fakes/browser';
import { TOOL_SETTINGS } from './helpers';

const allowed = new Set(['https://chat.example.com/*']);
const storage = fakeStorage();
const secrets = fakeSecretDb(); // what custom tools keep apart (tools/custom/store)
vi.mock('../src/storage/secret-db', () => secrets);
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage,
  {
    permissions: { contains: async ({ origins }: { origins: string[] }) => origins.every((o) => allowed.has(o)) },
    cookies: { get: async ({ name }: { name: string }) => (name === 'MMCSRF' ? { name, value: 'tok' } : null) },
  }) }));

const { scriptRequest } = await import('../src/script/request');
const { scriptTool } = await import('../src/tools/custom/script-tool');
const { runtimeCustomTools } = await import('../src/tools/custom/runtime');
const { customProblems } = await import('../src/tools/custom/validate');
const { manageCustomTools } = await import('../src/tools/custom/manage');
const { customToolStore } = await import('../src/tools/custom/store');

const access = { url: 'https://chat.example.com', session: true, headers: [{ name: 'X-CSRF-Token', value: '{{cookie:MMCSRF}}' }] };
const ctx = { settings: TOOL_SETTINGS, tabId: 1, signal: new AbortController().signal };
const find = {
  id: 'f', enabled: true, name: 'mm.find', description: 'Finds channels.', base: 'script', params: {},
  inputs: [{ name: 'term', type: 'string' as const, description: 'Words', required: true }],
  http: { method: 'GET' as const, ...access }, script: "return (await request('GET', '/api/v4/users/me/teams')).data;",
};

beforeEach(() => {
  storage.reset();
  secrets.data.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('a script\'s request()', () => {
  it('goes to a path on the tool\'s site, with its headers and the session; the answer as JSON', async () => {
    const fetch = mockFetch(new Response('[{"id":"t1"}]', { status: 200 }));
    expect(await scriptRequest(access, 'post', '/api/v4/teams/t1/channels/search', { term: 'inc' })).toEqual({ status: 200, ok: true, data: [{ id: 't1' }] });
    expect(fetch).toHaveBeenCalledWith(new URL('https://chat.example.com/api/v4/teams/t1/channels/search'), expect.objectContaining({
      method: 'POST', body: '{"term":"inc"}', credentials: 'include', headers: { 'X-CSRF-Token': 'tok', 'Content-Type': 'application/json' },
    }));
    mockFetch(new Response('not json', { status: 500 }));
    expect(await scriptRequest(access, 'GET', '/x', undefined)).toEqual({ status: 500, ok: false, data: 'not json' });
  });

  it('follows no redirect', async () => {
    mockFetch(redirecting);
    await expect(scriptRequest(access, 'GET', '/x', undefined)).rejects.toThrow('chat.example.com answered with a redirect, which is not followed');
  });

  it('reaches no other site', async () => {
    mockFetch(new Response(''));
    for (const path of ['https://evil.test/x', '//evil.test/x', 'api/x']) await expect(scriptRequest(access, 'GET', path, undefined)).rejects.toThrow('a path on https://chat.example.com');
    await expect(scriptRequest(access, 'TRACE', '/x', undefined)).rejects.toThrow('the method is one of');
    await expect(scriptRequest({ ...access, url: 'https://other.example.com' }, 'GET', '/x', undefined)).rejects.toThrow('No permission');
  });

  it('says which header is not a name (a whole line in the name box), before sending', async () => {
    const fetch = mockFetch(new Response(''));
    const line = { ...access, headers: [{ name: 'X-CSRF-Token: {{cookie:MMCSRF}}', value: '' }] };
    await expect(scriptRequest(line, 'GET', '/x', undefined)).rejects.toThrow('"X-CSRF-Token: {{cookie:MMCSRF}}" is not a header name');
    expect(fetch).not.toHaveBeenCalled();
    expect(customProblems({ ...find, http: { ...find.http, ...line } }, [], [])).toContain('"X-CSRF-Token: {{cookie:MMCSRF}}" is not a header name: letters, digits and - only (its value goes in the box beside it).');
  });
});

describe('a script tool', () => {
  it('is confirmed unless it only reads, on its site; the model gets what it returned, untrusted', async () => {
    const runner = vi.fn(async () => ({ value: { channels: ['incident-42'] }, requests: 3 }));
    const tool = scriptTool(find, {}, runner);
    expect(tool.effect).toBe('write');
    expect(scriptTool({ ...find, http: { ...find.http, readOnly: true } }, {}, runner).effect).toBe('read');
    expect(await tool.describe!({ term: 'inc' }, ctx)).toMatchObject({ summary: 'Run the script of mm.find on chat.example.com', url: 'https://chat.example.com' });
    const result = await tool.run({ term: 'inc' }, ctx);
    expect(runner).toHaveBeenCalledWith(find.http, find.script, { term: 'inc' }, ctx.signal);
    // Every parameter is there, null when not given (each a variable of its own in the script too).
    await scriptTool({ ...find, inputs: [...find.inputs, { name: 'team', type: 'string', description: 'A team' }] }, {}, runner).run({ term: 'inc' }, ctx);
    expect(runner).toHaveBeenLastCalledWith(find.http, find.script, { term: 'inc', team: null }, ctx.signal);
    // Wrapped as untrusted, with the tool's name and its request count; inside, what the script returned.
    const [, inner] = stripMarks((result as { text: string }).text).match(/^<untrusted_script_result tool="mm\.find" requests="3">\n([\s\S]*)\n<\/untrusted_script_result>$/) ?? [];
    expect(JSON.parse(inner!)).toEqual({ channels: ['incident-42'] });
  });
  it('says so when the script returned nothing', async () => {
    const tool = scriptTool(find, {}, vi.fn(async () => ({ value: null, requests: 1 })));
    expect(stripMarks(((await tool.run({ term: 'inc' }, ctx)) as { text: string }).text))
      .toBe('<untrusted_script_result tool="mm.find" requests="1">\nThe script returned nothing: end it with return and what the model should get.\n</untrusted_script_result>');
  });

  it('is offered only where it can run, and needs its site and code', () => {
    expect(runtimeCustomTools([find], [])).toEqual([]);
    expect(runtimeCustomTools([find], [], vi.fn()).map((t) => t.name)).toEqual(['mm.find']);
    expect(customProblems(find, [], [])).toEqual([]);
    expect(customProblems({ ...find, http: { ...find.http, url: 'https://chat.example.com/api' }, script: ' ' }, [], [])).toEqual([
      'Say its site: https:// and a host, like https://chat.example.com; its requests go there.',
      'Write the script: the steps, with request(method, path, body), and what it returns.',
    ]);
  });

  it('is made by the model with its whole code in the card', async () => {
    const save = manageCustomTools(async () => [])[0]!;
    const args = { name: 'mm.find', description: 'Finds channels.', base: 'script', inputs: find.inputs, script: { host: 'https://chat.example.com', code: find.script, session: true } };
    const { summary, details } = await save.describe!(args, ctx);
    expect(summary).toBe('Save the custom tool "mm.find" (a script on https://chat.example.com)');
    expect(details?.find((d) => d.label === 'Script (all of it)')?.value).toBe(find.script);
    expect(details?.find((d) => d.label === 'Signed in as you')?.value).toBe('Sends your browser session for chat.example.com');
    await save.run(args, ctx);
    expect((await customToolStore.load())[0]).toMatchObject({ base: 'script', script: find.script, http: { url: 'https://chat.example.com', session: true } });
  });

  it('keeps the user\'s group and labels when the model updates it', async () => {
    await customToolStore.save({ ...find, group: 'Chat', labels: ['work'] });
    const save = manageCustomTools(async () => [])[0]!;
    await save.run({ name: 'mm.find', description: 'Finds channels, better.', base: 'script', inputs: find.inputs, script: { host: 'https://chat.example.com', code: find.script } }, ctx);
    expect((await customToolStore.load())[0]).toMatchObject({ description: 'Finds channels, better.', group: 'Chat', labels: ['work'] });
  });
});

describe('a script that calls tools', () => {
  const steps = {
    id: 's', enabled: true, name: 'chat.ask', description: 'Asks the chat.', base: 'script', params: {},
    inputs: [{ name: 'message', type: 'string' as const, description: 'What to send', required: true }],
    http: { method: 'GET' as const, url: '' }, uses: ['browser.find', 'browser.wait_for'], script: '(not run: the runner below plays it)',
  };

  it('runs only its tools, each as a call of its own, shows every step and reports only those asked', async () => {
    const callTool = vi.fn(async (name: string) =>
      name === 'browser.find' ? { content: '- textbox "Message" [ref_3]', data: [{ line: 'textbox "Message" [ref_3]', ref: 'ref_3' }] } : { content: 'Done after 2.0 s: "button stop" is gone.', data: { done: true } });
    const emit = vi.fn();
    const runner = vi.fn(async (_access: unknown, _code: string, _input: unknown, _signal: unknown, s?: { tool: (n: string, a: unknown, r: boolean) => Promise<{ ok: boolean; data?: unknown }>; note: (t: string) => void }) => {
      const box = await s!.tool('browser.find', { query: 'textbox message' }, false);
      await s!.tool('browser.wait_for', { gone: 'button stop' }, true);
      s!.note('Sent');
      await expect(s!.tool('browser.click', { ref: 'ref_3' }, false)).rejects.toThrow('is not among the tools this script calls');
      return { value: { ref: (box.data as { ref: string }[])[0]!.ref }, requests: 0 };
    });
    const tool = scriptTool(steps, { type: 'object' }, runner as never);
    expect(tool.effect).toBe('read'); // no site: only its steps are asked
    const result = await tool.run({ message: 'hi' }, { ...ctx, callTool, emit });
    expect(callTool.mock.calls.map((c) => c[0])).toEqual(['browser.find', 'browser.wait_for']);
    const said = stripMarks((result as { text: string }).text);
    expect(said).toContain('steps="2"');
    expect(said).toContain('Step 2 · browser.wait_for:\nDone after 2.0 s');
    expect(said).toContain('Note: Sent');
    expect(said).not.toContain('textbox "Message"'); // a step not reported
    expect(said).toContain('"ref": "ref_3"');
    expect(emit).toHaveBeenCalledTimes(5); // two calls, two results, one note
    expect((result as { trace?: { steps?: boolean; messages: unknown[] } }).trace).toMatchObject({ steps: true });
  });

  it('takes a tool by its wire name too, and says so when it returned and reported nothing', async () => {
    const callTool = vi.fn(async () => ({ content: 'found' }));
    const runner = vi.fn(async (_a: unknown, _c: string, _i: unknown, _s: unknown, s?: { tool: (n: string, a: unknown, r: boolean) => Promise<unknown> }) => {
      await s!.tool('browser__find', { query: 'x' }, false);
      return { value: null, requests: 0 };
    });
    const result = await scriptTool(steps, { type: 'object' }, runner as never).run({ message: 'hi' }, { ...ctx, callTool });
    expect(callTool).toHaveBeenCalledWith('browser__find', { query: 'x' });
    expect(stripMarks((result as { text: string }).text)).toContain('Returned:\nThe script returned nothing: end it with return and what the model should get.');
  });

  it('needs no site, and refuses to run from another tool', async () => {
    expect(customProblems(steps, [], [])).toEqual([]);
    const runner = vi.fn(async (_a: unknown, _c: string, _i: unknown, _s: unknown, s?: { tool: (n: string, a: unknown, r: boolean) => Promise<unknown> }) => s!.tool('browser.find', {}, false));
    await expect(scriptTool(steps, { type: 'object' }, runner as never).run({ message: 'hi' }, ctx)).rejects.toThrow('runs only from a chat');
  });
});
