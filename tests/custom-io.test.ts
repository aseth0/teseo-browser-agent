import { describe, expect, it } from 'vitest';
import type { Tool } from '../src/core/types';
import type { CustomTool } from '../src/tools/custom/types';
import { exportCustomTools, importCustomTools } from '../src/tools/custom/io';

const search: Pick<Tool, 'name' | 'source' | 'inputSchema'> = {
  name: 'web.search',
  source: 'web',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
};
const reddit: CustomTool = { id: 'r', enabled: true, name: 'reddit.search', description: 'Searches Reddit.', base: 'web.search', params: { query: { mode: 'model', template: '{value} site:reddit.com' } } };
const api: CustomTool = {
  id: 'a',
  enabled: true,
  name: 'api.search',
  description: 'Searches the API.',
  base: 'http',
  params: {},
  inputs: [{ name: 'q', type: 'string', description: 'Words' }],
  http: { method: 'GET', url: 'https://api.example.com/s?q={q}', headers: [{ name: 'X-Key', value: 'secret' }] },
};

describe('custom tools as JSON', () => {
  it('exports them without ids, and without header values unless asked', () => {
    const shared = JSON.parse(exportCustomTools([reddit, api])) as { customTools: Record<string, unknown>[] };
    expect(shared.customTools.map((c) => c.name)).toEqual(['reddit.search', 'api.search']);
    expect(shared.customTools[0]).not.toHaveProperty('id');
    expect(JSON.stringify(shared)).not.toContain('secret');
    expect(exportCustomTools([api], true)).toContain('secret');
  });

  it('exports the values of their {{secret:…}} only with the header values, and keeps yours on import', () => {
    const withValue: CustomTool = { ...api, http: { ...api.http!, url: 'https://api.example.com/s?k={{secret:k}}', secrets: { k: 'saved-value' } } };
    expect(exportCustomTools([withValue])).not.toContain('saved-value');
    expect(exportCustomTools([withValue], true)).toContain('saved-value');
    const { tools } = importCustomTools(exportCustomTools([withValue]), [withValue], [search]);
    expect(tools[0]!.http!.secrets).toEqual({ k: 'saved-value' });
  });

  it('keeps their group both ways', () => {
    const { tools } = importCustomTools(exportCustomTools([{ ...api, group: 'Team API' }]), [], [search]);
    expect(tools[0]!.group).toBe('Team API');
    expect(importCustomTools(JSON.stringify({ customTools: [{ ...api, group: '  ' }] }), [], [search]).tools[0]).not.toHaveProperty('group');
  });

  it('imports them off, replacing those of the same name and keeping their header values', () => {
    const json = exportCustomTools([reddit, api]); // header values left out
    const { tools, skipped } = importCustomTools(json, [api], [search]);
    expect(skipped).toEqual([]);
    expect(tools.map((t) => [t.name, t.enabled])).toEqual([['reddit.search', false], ['api.search', false]]);
    expect(tools[1]!.id).toBe('a'); // the one it replaces
    expect(tools[1]!.http!.headers).toEqual([{ name: 'X-Key', value: 'secret' }]);
  });

  it('never turns the browser session on from a file, only keeps it for the tool that had it', () => {
    const signed: CustomTool = { ...api, http: { ...api.http!, session: true } };
    const json = exportCustomTools([signed]);
    expect(JSON.parse(json).customTools[0].http.session).toBe(true);
    expect(importCustomTools(json, [], [search]).tools[0]!.http).not.toHaveProperty('session');
    expect(importCustomTools(json, [signed], [search]).tools[0]!.http!.session).toBe(true);
    // Nor "only reads", which spares the confirmation.
    const reads = exportCustomTools([{ ...api, http: { ...api.http!, method: 'POST', readOnly: true } }], true);
    expect(importCustomTools(reads, [], [search]).tools[0]!.http).not.toHaveProperty('readOnly');
  });

  it("keeps the user's header values, secrets, session and read only only for the same site and method", () => {
    const yours: CustomTool = { ...api, http: { ...api.http!, method: 'POST', url: 'https://api.example.com/s?k={{secret:k}}', secrets: { k: 'saved-value' }, session: true, readOnly: true } };
    const shared = JSON.parse(exportCustomTools([yours])) as { customTools: CustomTool[] };
    const withHttp = (http: Partial<CustomTool['http']>) => JSON.stringify({ customTools: [{ ...shared.customTools[0], http: { ...shared.customTools[0]!.http, ...http } }] });
    const kept = importCustomTools(withHttp({ url: 'https://API.example.com/other' }), [yours], [search]).tools[0]!.http!;
    expect(kept).toMatchObject({ headers: [{ name: 'X-Key', value: 'secret' }], secrets: { k: 'saved-value' }, session: true, readOnly: true });
    for (const changed of [{ url: 'https://evil.example.com/s?k={{secret:k}}' }, { url: 'http://api.example.com/s?k={{secret:k}}' }, { method: 'DELETE' as const }]) {
      const http = importCustomTools(withHttp(changed), [yours], [search]).tools[0]!.http!;
      expect(http.headers).toEqual([{ name: 'X-Key', value: '' }]);
      expect(http).not.toHaveProperty('secrets');
      expect(http).not.toHaveProperty('session');
      expect(http).not.toHaveProperty('readOnly');
    }
  });

  it('takes a list or a single tool, and leaves out the invalid ones with why', () => {
    expect(importCustomTools(JSON.stringify([reddit]), [], [search]).tools).toHaveLength(1);
    const { tools, skipped } = importCustomTools(JSON.stringify({ name: 'Bad', base: 'nope', description: '' }), [], [search]);
    expect(tools).toEqual([]);
    expect(skipped[0]).toMatch(/^Bad: The name is words in lowercase/);
    expect(() => importCustomTools('not json', [], [search])).toThrow();
  });

  it('brings a script back whole: its code, site, headers and labels', () => {
    const script: CustomTool = {
      id: 's', enabled: true, name: 'mm.find', description: 'Finds channels.', base: 'script', params: {}, inputs: [{ name: 'term', type: 'string', description: 'Words' }],
      http: { method: 'GET', url: 'https://chat.example.com', session: true, headers: [{ name: 'X-CSRF-Token', value: '{{cookie:MMCSRF}}' }] }, script: 'return input.term;', labels: ['mattermost'],
    };
    const [back] = importCustomTools(exportCustomTools([script]), [], []).tools;
    expect(back).toMatchObject({ base: 'script', script: 'return input.term;', labels: ['mattermost'], http: { url: 'https://chat.example.com', headers: [{ name: 'X-CSRF-Token', value: '' }] } });
    expect(back!.http!.session).toBeUndefined(); // the user's choice, never a file's
  });

  it('takes a script as a model writes it by hand: site, headers as an object, code as text', () => {
    const json = JSON.stringify({
      name: 'mm.search_channels', description: 'Searches channels in every team.', base: 'script', session: true, site: 'https://chat.example.com',
      headers: { 'X-CSRF-Token': '{{cookie:MMCSRF}}', 'X-Requested-With': 'XMLHttpRequest' },
      inputs: [{ name: 'query', type: 'string', description: 'Words', required: true }], script: 'return query;',
    });
    const { tools, skipped, needSession } = importCustomTools(json, [], []);
    expect(skipped).toEqual([]);
    expect(needSession).toEqual(['mm.search_channels']); // its cookie header wants the session, which the user ticks
    expect(tools[0]).toMatchObject({
      script: 'return query;',
      http: { method: 'GET', url: 'https://chat.example.com', headers: [{ name: 'X-CSRF-Token', value: '{{cookie:MMCSRF}}' }, { name: 'X-Requested-With', value: 'XMLHttpRequest' }] },
    });
    expect(tools[0]!.http!.session).toBeUndefined();
    // Or the shape custom_tools.save takes: script {host, code}.
    const nested = JSON.stringify({ name: 'mm.other', description: 'x', base: 'script', script: { host: 'https://chat.example.com', code: 'return 1;' } });
    expect(importCustomTools(nested, [], []).tools[0]).toMatchObject({ script: 'return 1;', http: { url: 'https://chat.example.com' } });
  });
});

describe('custom tools imported over one from a source', () => {
  it('say that it leaves its source, the tool coming in as yours', () => {
    const sourced: CustomTool = { ...reddit, id: 'from-s1', source: { id: 's1', does: 'x' } };
    const { rows } = importCustomTools(exportCustomTools([reddit, api]), [sourced], [search]);
    expect(rows.map((r) => [r.name, r.status, r.sourceId])).toEqual([['reddit.search', 'leaves-source', 's1'], ['api.search', 'new', undefined]]);
    expect(rows[0]!.item).not.toHaveProperty('source');
    expect(rows[0]!.item!.id).toBe('from-s1');
  });
});
