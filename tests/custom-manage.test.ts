import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tool, ToolContext } from '../src/core/types';
import type { CustomTool } from '../src/tools/custom/types';
import { fakeBrowser, fakeSecretDb, fakeStorage } from './fakes/browser';

const storage = fakeStorage();
const secrets = fakeSecretDb(); // what custom tools keep apart (tools/custom/store)
vi.mock('../src/storage/secret-db', () => secrets);
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));
const { customToolStore } = await import('../src/tools/custom/store');
const { manageCustomTools } = await import('../src/tools/custom/manage');
const { editedArgs, readSaveArgs, savedArgs } = await import('../src/tools/custom/draft');
const { upgradeBuilder } = await import('../src/agents/builder');
const { SCRIPT_SHAPES } = await import('../src/tools/custom/validate');

const ctx = { signal: new AbortController().signal } as ToolContext;
const tools = manageCustomTools(async () => []);
const named = (name: string) => tools.find((t) => t.name === name)!;
const textOf = (r: Awaited<ReturnType<Tool['run']>>) => (r as { text: string }).text;

const issues: CustomTool = {
  id: 'issues', enabled: false, name: 'tracker.issues', description: 'Lists the open issues.', base: 'http', params: {},
  inputs: [{ name: 'project', type: 'string', description: 'The project key', required: true }],
  http: { method: 'GET', url: 'https://tracker.example.com/api/issues?project={project}', extract: 'items', session: true, headers: [{ name: 'X-Api-Key', value: 'secret-value' }] },
};
const synced: CustomTool = { id: 'synced', enabled: true, name: 'team.search', description: 'Searches.', base: 'web.search', params: { query: { mode: 'fixed', value: 'x' } }, source: { id: 's', does: 'web.search' } };

beforeEach(async () => {
  storage.reset();
  secrets.data.clear();
  await customToolStore.save(issues);
  await customToolStore.save(synced);
});

describe('a custom tool as the model reads it', () => {
  it('is what custom_tools.save takes, header values left out', async () => {
    expect(savedArgs(issues)).toEqual({
      name: 'tracker.issues', description: 'Lists the open issues.', base: 'http', inputs: issues.inputs,
      http: { method: 'GET', url: issues.http!.url, extract: 'items', session: true, headers: [{ name: 'X-Api-Key', value: '(set, not shown)' }] },
    });
    const read = textOf(await named('custom_tools.read').run({ name: 'tracker.issues' }, ctx));
    expect(read).toContain('# Custom tool: tracker.issues');
    expect(read).toContain('"enabled": false');
    expect(read).not.toContain('secret-value');
  });
  it('a name it does not have lists the ones there are', async () => {
    await expect(named('custom_tools.read').run({ name: 'nope' }, ctx)).rejects.toThrow('There is no custom tool "nope". Yours: tracker.issues, team.search.');
  });
});

describe('custom_tools.edit', () => {
  it('puts it in a group, moves it and takes it out; left out, the group stays', async () => {
    const edit = (changes: object) => named('custom_tools.edit').run({ name: 'tracker.issues', ...changes }, ctx);
    const saved = async () => (await customToolStore.load()).find((c) => c.name === 'tracker.issues')!;
    expect(await edit({ group: ' Work ' })).not.toHaveProperty('isError');
    expect((await saved()).group).toBe('Work');
    expect(savedArgs(await saved()).group).toBe('Work');
    const card = await named('custom_tools.edit').describe!({ name: 'tracker.issues', group: 'Chat' }, ctx);
    expect(card.details?.find((d) => d.label === 'Group')).toMatchObject({ diff: true });
    await edit({ description: 'Lists the issues.' });
    expect((await saved()).group).toBe('Work');
    await edit({ group: '' });
    expect(await saved()).not.toHaveProperty('group');
  });
  it('custom_tools.save gives a new tool its group', async () => {
    const result = await named('custom_tools.save').run({ name: 'wiki.page', description: 'Reads a page.', base: 'http', group: 'Reference', inputs: [{ name: 'title', type: 'string', description: 'Its title' }], http: { method: 'GET', url: 'https://wiki.example.com/{title}' } }, ctx);
    expect(result).not.toHaveProperty('isError');
    expect((await customToolStore.load()).find((c) => c.name === 'wiki.page')!.group).toBe('Reference');
  });
  it('changes only what it gives: a key of the request, a parameter (null takes it out)', () => {
    const edited = editedArgs(synced, { name: 'other', params: { query: null as never, count: { fixed: 5 } } });
    expect(edited).toMatchObject({ name: 'team.search', description: 'Searches.', params: { count: { fixed: 5 } } });
    expect(edited.params).not.toHaveProperty('query');
    expect(editedArgs(issues, { http: { extract: 'data' } }).http).toMatchObject({ url: issues.http!.url, extract: 'data', session: true });
  });
  it('saves it with the user\'s headers and state kept', async () => {
    const result = await named('custom_tools.edit').run({ name: 'tracker.issues', description: 'Lists the issues.' }, ctx);
    expect(result).not.toHaveProperty('isError');
    const saved = (await customToolStore.load()).find((c) => c.id === 'issues')!;
    expect(saved).toMatchObject({ enabled: false, description: 'Lists the issues.', http: { extract: 'items', headers: [{ name: 'X-Api-Key', value: 'secret-value' }] } });
  });
  it('is shown for review whole, and refuses a tool from a source', async () => {
    const review = await named('custom_tools.edit').describe!({ name: 'tracker.issues', http: { extract: 'data' } }, ctx);
    expect(review.summary).toMatch(/^Update the custom tool "tracker.issues"/);
    await expect(named('custom_tools.edit').describe!({ name: 'team.search', description: 'x' }, ctx)).rejects.toThrow(/comes from a source/);
  });
});

describe('arguments of the wrong shape', () => {
  it('of none given (null) are left out', () => {
    expect(readSaveArgs({ name: 'a.b', http: null, script: null })).toEqual({ args: { name: 'a.b' }, problems: [] });
  });
  it('say how to give them, instead of failing on them', async () => {
    const save = named('custom_tools.save');
    const review = save.describe!({ name: 'reddit.search', description: 'Searches Reddit.', base: 'web.search', params: { limit: 3, query: '{value} site:reddit.com' } }, ctx);
    await expect(review).rejects.toThrow('"limit": give {"fixed": <value>} to set it');
    await expect(review).rejects.toThrow('"query": give {"fixed": <value>}');
    expect(readSaveArgs({ inputs: 'title', http: 'GET x', script: 5, params: [1] }).problems).toEqual([
      '"params" is an object by the base\'s parameter name: {"limit": {"fixed": 3}}.',
      '"inputs" is a list of objects: [{"name": "title", "type": "string", "description": "…", "required": true}].',
      '"http" is an object: {"method": "GET", "url": "https://api.example.com/search?q={query}"}.',
      '"script" is an object.',
    ]);
  });
  it('say where a script sent as JSON text breaks, and then its two shapes', async () => {
    const script = '{"code": "return /\\[x\\]/.test(input.q);", "uses": ["browser.find"]}';
    const [problem] = readSaveArgs({ script }).problems;
    expect(problem).toMatch(/^"script" is an object, not a text: this one is not JSON \(.*position \d+.*\)\. Send it as an object, or double each backslash/);
    const tried = textOf(await named('custom_tools.try').run({ name: 'shop.steps', description: 'Steps.', base: 'script', script }, ctx));
    expect(tried).toBe(`Not tried:\n- ${problem}\n- "script" has neither "uses" nor "host". It is one of: ${SCRIPT_SHAPES}.`);
  });
  it('keep null for a parameter custom_tools.edit takes out', () => {
    expect(readSaveArgs({ params: { query: null } })).toEqual({ args: { params: { query: null } }, problems: [] });
  });
});

describe('custom_tools.try', () => {
  const search: Tool = {
    name: 'web.search', description: 'Searches.', source: 'web', effect: 'read',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] },
    run: async (args) => ({ type: 'text', text: `Searched: ${JSON.stringify(args)}` }),
  };
  const runner = vi.fn(async (_access: unknown, _code: string, input: Record<string, unknown>) => ({ value: { got: input }, requests: 1 }));
  const trying = manageCustomTools(async () => [search], runner).find((t) => t.name === 'custom_tools.try')!;
  const wrapped = { name: 'reddit.search', description: 'Searches Reddit.', base: 'web.search', params: { query: { template: '{value} site:reddit.com' }, limit: { fixed: 3 } } };

  it('runs the draft once with the sample, saving nothing, the user asked every time', async () => {
    expect(trying.alwaysAsk).toBe(true);
    expect(textOf(await trying.run({ ...wrapped, sample: { query: 'platypus' } }, ctx))).toBe('Searched: {"query":"platypus site:reddit.com","limit":3}');
    expect((await customToolStore.load()).map((c) => c.name)).not.toContain('reddit.search');
  });
  it('shows the whole draft and the sample on its card', async () => {
    const review = await trying.describe!({ ...wrapped, sample: { query: 'platypus' } }, ctx);
    expect(review.summary).toBe('Try the custom tool "reddit.search" once, unsaved (runs web.search)');
    expect(review.details).toContainEqual({ label: '"limit": fixed', value: '3', code: true });
    expect(review.details).toContainEqual({ label: 'Tried with', value: '{\n  "query": "platypus"\n}', code: true });
  });
  it('runs a script with its input', async () => {
    const script = { name: 'shop.items', description: 'Lists items.', base: 'script', inputs: [{ name: 'q', type: 'string', description: 'Words', required: true }], script: { host: 'https://shop.example.com', code: 'return input;' } };
    expect(textOf(await trying.run({ ...script, sample: { q: 'lamp' } }, ctx))).toContain('"q": "lamp"');
    expect(runner).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://shop.example.com' }), 'return input;', { q: 'lamp' }, ctx.signal);
  });
  it('says why it cannot be tried: what keeps it from being saved, a required value left out', async () => {
    const http = { name: 'api.find', description: 'Finds.', base: 'http', inputs: [{ name: 'q', type: 'string', description: 'Words', required: true }], http: { method: 'GET', url: 'https://api.example.com/find?q={q}&p={page}' } };
    const result = await trying.run({ ...http, sample: {} }, ctx);
    expect(result).toMatchObject({ isError: true });
    expect(textOf(result)).toBe('Not tried:\n- The URL uses {page}, not a parameter of this tool: declare each one in "inputs", e.g. [{"name": "page", "type": "string", "description": "…", "required": true}].\n- The sample leaves out "q", which the tool requires.');
    await expect(trying.describe!({ ...http, sample: {} }, ctx)).rejects.toThrow(/^Not tried:/);
  });
  it('says so when a script has nowhere to run', async () => {
    const without = manageCustomTools(async () => []).find((t) => t.name === 'custom_tools.try')!;
    const script = { name: 'shop.items', description: 'Lists items.', base: 'script', script: { host: 'https://shop.example.com', code: 'return 1;' } };
    expect(textOf(await without.run(script, ctx))).toBe('Not tried:\n- It cannot be tried here: save it, and it is offered from the next message.');
  });
});

describe('what keeps a draft from being saved, as the model is told it', () => {
  const search: Tool = {
    name: 'web.search', description: 'Searches.', source: 'web', effect: 'read',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] },
    run: async () => ({ type: 'text', text: '' }),
  };
  const offered = manageCustomTools(async () => [search]);
  const refused = (args: object) => offered.find((t) => t.name === 'custom_tools.save')!.describe!(args, ctx).then(() => '', (e: Error) => e.message);
  it('takes a base named as the model is offered it, and lists the base\'s parameters', async () => {
    const problems = await refused({ name: 'reddit.search', description: 'Searches Reddit.', base: 'web__search', params: { q: { fixed: 'x' } } });
    expect(problems).toBe('Not saved:\n- "web.search" has no parameter "q". Its parameters: query, limit.');
  });
  it('says how to declare an input, what {value} is for, and how to set a required parameter', async () => {
    const http = await refused({ name: 'api.find', description: 'Finds.', base: 'http', http: { url: 'https://api.example.com/find?q={value}' } });
    expect(http).toContain('The URL uses {value}, not a parameter of this tool: declare each one in "inputs", e.g. [{"name": "query", "type": "string", "description": "…", "required": true}]. {value} only wraps a base\'s text parameter, without inputs.');
    const built = await refused({ name: 'web.find', description: 'Finds.', base: 'web.search', inputs: [{ name: 'term', description: 'Words' }], params: { limit: { fixed: 3 } } });
    expect(built).toBe('Not saved:\n- "web.search" needs "query": set it with {"fixed": …} or build it from the inputs with {"template": "…{term}…"}.');
  });
  it('takes the tools a script calls as offered, and refuses one that is not', async () => {
    const script = { name: 'shop.steps', description: 'Steps.', base: 'script', script: { code: 'return 1;', uses: ['web__search', 'browser.nope'] } };
    expect(await refused(script)).toBe('Not saved:\n- "browser.nope" in uses is not a tool you are offered.');
  });
  it('tells a script of neither shape both, and one that calls tool() without uses to list them', async () => {
    const shop = { name: 'shop.steps', description: 'Steps.', base: 'script' };
    expect(await refused({ ...shop, script: { code: 'return 1;' } })).toBe(`Not saved:\n- "script" has neither "uses" nor "host". It is one of: ${SCRIPT_SHAPES}.`);
    expect(await refused({ ...shop, script: { code: 'await tool("browser.find", {}); return 1;' } })).toBe(
      'Not saved:\n- The code calls tool(): list the tools it calls in "script.uses", like ["browser.find", "browser.type"] (then it needs no host).',
    );
    expect(await refused({ ...shop, script: { host: 'https://shop.example.com' } })).toBe('Not saved:\n- Write the script: the steps, with request(method, path, body), and what it returns.');
    // With a site too: saved, it would fail at its first tool().
    expect(await refused({ ...shop, script: { host: 'https://shop.example.com', code: 'await tool("browser.find", {}); return 1;' } })).toBe(
      'Not saved:\n- The code calls tool() but has no "uses": list the tools it calls in "script.uses", like ["browser.find", "browser.type"].',
    );
  });
  it('tries nothing with a sample value for no parameter, which the tool would run without', async () => {
    const shop = { name: 'shop.items', description: 'Lists items.', base: 'script', script: { host: 'https://shop.example.com', code: 'return input;' } };
    const tried = textOf(await named('custom_tools.try').run({ ...shop, sample: { prompt: 'hi' } }, ctx));
    expect(tried).toBe('Not tried:\n- The sample gives "prompt", which is not a parameter of this tool: declare it in inputs.');
    // A parameter's name in another style is the parameter: tried (the script asks first), not refused.
    const styled = { ...shop, inputs: [{ name: 'timeout_sec', type: 'number', description: 'Seconds' }], sample: { timeoutSec: 5 } };
    expect(textOf(await named('custom_tools.try').run(styled, ctx))).not.toContain('not a parameter');
  });
  it('suggests a parameter name that may be', async () => {
    const shop = { name: 'shop.items', description: 'Lists items.', base: 'script', script: { host: 'https://shop.example.com', code: 'return 1;' } };
    expect(await refused({ ...shop, inputs: [{ name: 'timeoutSec', type: 'number', description: 'Seconds' }] })).toBe(
      'Not saved:\n- "timeoutSec": a parameter\'s name is lowercase letters, digits and _, so "timeout_sec".',
    );
  });
});

describe('custom_tools.delete', () => {
  it('asks first, then removes it; not one from a source', async () => {
    expect(named('custom_tools.delete').alwaysAsk).toBe(true);
    expect(textOf(await named('custom_tools.delete').run({ name: 'tracker.issues' }, ctx))).toBe('Deleted the custom tool "tracker.issues".');
    expect((await customToolStore.load()).map((c) => c.name)).toEqual(['team.search']);
    await expect(named('custom_tools.delete').run({ name: 'team.search' }, ctx)).rejects.toThrow(/comes from a source/);
  });
});

describe('a Builder stored before', () => {
  it('gets the new tools, but not one the user took away', () => {
    const before = { tools: ['custom_tools.save', 'web.read'], skills: [], builderSkills: [] } as never;
    expect(upgradeBuilder(before).tools).toEqual(['custom_tools.save', 'web.read',
      'actions.delete', 'actions.read', 'agents.delete', 'browser.click', 'browser.find_in_dom', 'browser.get_html', 'browser.navigate', 'browser.press_key', 'browser.scroll', 'browser.select', 'browser.type',
      'custom_tools.delete', 'custom_tools.edit', 'custom_tools.read', 'custom_tools.try', 'skills.delete', 'skills.read', 'templates.delete']);
    const after = { tools: ['web.read'], skills: [], builderSkills: [], builderTools: upgradeBuilder(before).builderTools } as never;
    expect(upgradeBuilder(after).tools).toEqual(['web.read']);
  });
});
