import { describe, expect, it, vi } from 'vitest';
import type { Tool } from '../src/core/types';
import { buildValue, customArgs, customSchema, runtimeCustomTools } from '../src/tools/custom/runtime';
import { parseValue } from '../src/ui/custom-tools/parse-value';
import { customProblems } from '../src/tools/custom/validate';
import type { CustomTool } from '../src/tools/custom/types';
import { hostChangeProblem } from '../src/tools/custom/draft';
import { TOOL_SETTINGS } from './helpers';

const search: Tool = {
  name: 'web.search',
  description: 'Searches the web.',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Words' }, limit: { type: 'number', description: 'How many' } },
    required: ['query'],
  },
  source: 'web',
  effect: 'write',
  alwaysAsk: true,
  describe: async (args) => ({ summary: `Search for ${(args as { query: string }).query}` }),
  run: vi.fn(async (args) => ({ type: 'text' as const, text: JSON.stringify(args) })),
};

const reddit: CustomTool = {
  id: 'r',
  enabled: true,
  name: 'reddit.search',
  description: 'Searches Reddit.',
  base: 'web.search',
  params: { query: { mode: 'model', template: '{value} site:reddit.com', description: 'What to look for on Reddit' }, limit: { mode: 'fixed', value: 3 } },
};

describe('custom_tools.save updating an HTTP request', () => {
  const http = { method: 'GET' as const, url: 'https://api.example.com/search?q={q}' };
  const withKey = { ...http, headers: [{ name: 'X-Key', value: 'secret' }] };

  it('refuses to move the user\'s headers or session to another host', () => {
    expect(hostChangeProblem(withKey, { ...http, url: 'https://evil.test/collect?q={q}' })).toMatch(/api\.example\.com.*evil\.test/);
    expect(hostChangeProblem({ ...http, session: true }, { ...http, url: 'https://evil.test/' })).toMatch(/host/);
  });

  it('allows the same host, a tool without headers or session, and a new tool', () => {
    expect(hostChangeProblem(withKey, { ...http, url: 'https://api.example.com/items/{id}' })).toBeUndefined();
    expect(hostChangeProblem(http, { ...http, url: 'https://other.test/' })).toBeUndefined();
    expect(hostChangeProblem(undefined, { ...http, url: 'https://other.test/' })).toBeUndefined();
  });
});

describe('custom tools', () => {
  it('offers the base parameters without the fixed ones, with the descriptions given', () => {
    expect(customSchema(reddit, search)).toEqual({
      type: 'object',
      properties: { query: { type: 'string', description: 'What to look for on Reddit' } },
      required: ['query'],
    });
  });

  it('runs the base with the model value wrapped and the fixed values, whatever the model sends', () => {
    expect(customArgs(reddit, { query: 'platypus', limit: 9 })).toEqual({ query: 'platypus site:reddit.com', limit: 3 });
  });

  it('is offered as its base runs: same effect and confirmation, its arguments described as they run', async () => {
    const [tool] = runtimeCustomTools([reddit], [search]);
    expect(tool).toMatchObject({ name: 'reddit.search', description: 'Searches Reddit.', source: 'custom', effect: 'write', alwaysAsk: true });
    const ctx = { settings: TOOL_SETTINGS, signal: new AbortController().signal };
    expect((await tool!.describe!({ query: 'platypus' }, ctx)).summary).toBe('Search for platypus site:reddit.com');
    await tool!.run({ query: 'platypus' }, ctx);
    expect(search.run).toHaveBeenCalledWith({ query: 'platypus site:reddit.com', limit: 3 }, ctx);
  });

  it('is left out when off, when its base is not offered, or when a tool of the catalog has its name', () => {
    expect(runtimeCustomTools([{ ...reddit, enabled: false }], [search])).toEqual([]);
    expect(runtimeCustomTools([reddit], [])).toEqual([]);
    expect(runtimeCustomTools([{ ...reddit, name: 'web.search' }], [search])).toEqual([]);
  });

  it('reads fixed values as the parameter type', () => {
    expect(parseValue('3', 'number')).toBe(3);
    expect(parseValue('true', 'boolean')).toBe(true);
    expect(parseValue('{"a":1}', 'object')).toEqual({ a: 1 });
    expect(parseValue('3', 'string')).toBe('3');
    expect(() => parseValue('three', 'integer')).toThrow('a number');
  });

  it('names what keeps it from being saved', () => {
    expect(customProblems(reddit, [reddit], [search])).toEqual([]);
    const bad: CustomTool = { ...reddit, id: 'b', name: 'Reddit', description: ' ', params: { query: { mode: 'model', template: 'site:reddit.com' } } };
    expect(customProblems(bad, [reddit], [search])).toEqual([
      'The name is words in lowercase joined by dots, like "reddit.search".',
      'The description tells the model when to use it: it cannot be empty.',
      '"query": the text around the model\'s value needs {value} where it goes.',
    ]);
    expect(customProblems({ ...reddit, id: 'c' }, [reddit], [search])).toEqual(['Another custom tool is named "reddit.search".']);
    expect(customProblems({ ...reddit, name: 'web.search' }, [reddit], [search])).toEqual(['A tool of the catalog is named "web.search".']);
  });

  describe('with its own parameters', () => {
    const read: Tool = {
      name: 'web.read',
      description: 'Reads a page.',
      inputSchema: { type: 'object', properties: { url: { type: 'string' }, maxChars: { type: 'number' } }, required: ['url'] },
      source: 'web',
      effect: 'read',
      run: vi.fn(async () => ({ type: 'text' as const, text: 'ok' })),
    };
    const wiki: CustomTool = {
      id: 'w',
      enabled: true,
      name: 'wiki.read',
      description: 'Reads a Wikipedia article.',
      base: 'web.read',
      inputs: [
        { name: 'title', type: 'string', description: 'Article title', required: true },
        { name: 'lang', type: 'string', description: 'Language code', default: 'es' },
        { name: 'size', type: 'number', description: 'How much to read' },
      ],
      params: { url: { mode: 'built', template: 'https://{lang}.wikipedia.org/wiki/{title}' }, maxChars: { mode: 'built', template: '{size}' } },
    };

    it('offers only its own parameters', () => {
      expect(customSchema(wiki, read)).toEqual({
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Article title' },
          lang: { type: 'string', description: 'Language code', default: 'es' },
          size: { type: 'number', description: 'How much to read' },
        },
        required: ['title'],
      });
    });

    it('builds the base parameters from them, with the defaults, leaving out what was not given', () => {
      expect(customArgs(wiki, { title: 'Echidna', size: 900, other: 'x' }, read)).toEqual({ url: 'https://es.wikipedia.org/wiki/Echidna', maxChars: 900 });
      expect(customArgs(wiki, { title: 'Platypus', lang: 'en' }, read)).toEqual({ url: 'https://en.wikipedia.org/wiki/Platypus' });
    });

    it('reads a built text as the base parameter type', () => {
      expect(buildValue('{n}', { n: 7 }, 'number')).toBe(7);
      expect(buildValue('{n}0', { n: 7 }, 'number')).toBe(70);
      expect(buildValue('{on}', { on: 'true' }, 'boolean')).toBe('true'); // just {on}: as it is
      expect(buildValue('x{on}', { on: 1 }, 'boolean')).toBe('x1');
      expect(buildValue('{a}-{b}', { a: 'one' }, 'string')).toBe('one-');
    });

    it('names what keeps it from being saved', () => {
      expect(customProblems(wiki, [], [read])).toEqual([]);
      const bad: CustomTool = {
        ...wiki,
        inputs: [{ name: 'Title', type: 'string', description: '' }, { name: 'lang', type: 'string', description: 'x' }, { name: 'lang', type: 'string', description: 'y' }],
        params: { maxChars: { mode: 'built', template: '{size}' }, url: { mode: 'built', template: ' ' } },
      };
      expect(customProblems(bad, [], [read])).toEqual([
        '"Title": a parameter\'s name is lowercase letters, digits and _, so "title".',
        '"Title" needs a description: the model reads it to fill it.',
        'Two parameters are named "lang".',
        '"maxChars" uses {size}, not a parameter of this tool.',
        '"url": write how it is built, e.g. {Title}.',
      ]);
    });
  });
});

describe('a custom tool over a tool that reads its arguments for the policy', () => {
  const reader: Tool = {
    name: 'history.read',
    description: 'Reads a saved conversation.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, full: { type: 'boolean' }, tabId: { type: 'number' } }, required: ['id'] },
    source: 'history',
    effect: 'read',
    alwaysAsk: (args) => (args as { full?: boolean }).full === true,
    tabOf: (args) => (args as { tabId?: number }).tabId,
    run: vi.fn(async () => ({ type: 'text' as const, text: 'ok' })),
  };
  const fixed: CustomTool = { id: 'f', enabled: true, name: 'my.read', description: 'Reads one in full.', base: 'history.read', params: { full: { mode: 'fixed', value: true }, tabId: { mode: 'fixed', value: 7 } } };

  it('gives them as the base takes them: its tab and whether it asks', () => {
    const [tool] = runtimeCustomTools([fixed], [reader]);
    expect(tool!.tabOf!({ id: 'c1' })).toBe(7);
    expect((tool!.alwaysAsk as (a: unknown) => boolean)({ id: 'c1' })).toBe(true);
  });
});
