import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomTool } from '../src/tools/custom/types';
import { fakeBrowser, fakeStorage, mockFetch, redirecting } from './fakes/browser';

const allowed = new Set(['https://tools.example.com/*']);
const storage = fakeStorage();
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage,
  {
    permissions: { contains: async ({ origins }: { origins: string[] }) => origins.every((o) => allowed.has(o)) },
    cookies: { get: async ({ name }: { name: string }) => (name === 'csrf' ? { name, value: 'c1' } : null) },
  }) }));

const { readSource, syncSource, unsourced } = await import('../src/tools/custom/sources');
const { whatItDoes } = await import('../src/tools/custom/store');
const { runtimeCustomTools } = await import('../src/tools/custom/runtime');

afterEach(() => vi.unstubAllGlobals());

const tool = (name: string, url = `https://api.example.com/${name}`): CustomTool => ({
  id: name, enabled: true, name, description: `The ${name} tool.`, base: 'http', params: {},
  inputs: [{ name: 'q', type: 'string', description: 'Words' }], http: { method: 'GET', url, headers: [{ name: 'Authorization', value: '' }] },
});
const file = (...tools: CustomTool[]) => JSON.stringify({ customTools: tools.map(({ id: _id, enabled: _enabled, ...t }) => t) });
// As a first sync leaves them, switched on since by the user, with their own key.
const synced = (t: CustomTool, enabled = true): CustomTool => ({ ...t, enabled, http: { ...t.http!, headers: [{ name: 'Authorization', value: 'Bearer mine' }] }, source: { id: 's', does: whatItDoes(t) } });

describe('a source of custom tools', () => {
  it('brings its new tools off, marked as its own', () => {
    const sync = syncSource(file(tool('a.find'), tool('a.list')), 's', [], []);
    expect(sync.added).toEqual(['a.find', 'a.list']);
    expect(sync.save.map((t) => [t.name, t.enabled, t.source?.id, t.source?.changed])).toEqual([['a.find', false, 's', undefined], ['a.list', false, 's', undefined]]);
  });

  it('keeps one as the user left it while it does the same (a new description is fine), with their header values', () => {
    const old = synced(tool('a.find'));
    const sync = syncSource(file({ ...tool('a.find'), description: 'Finds things, better worded.' }), 's', [old], []);
    expect(sync.changed).toEqual([]);
    expect(sync.save[0]).toMatchObject({ id: 'a.find', enabled: true, description: 'Finds things, better worded.', source: old.source });
    expect(sync.save[0]!.http!.headers).toEqual([{ name: 'Authorization', value: 'Bearer mine' }]);
  });

  it('turns one off that now does something else, until the user checks it', () => {
    const old = synced(tool('a.find'));
    const sync = syncSource(file(tool('a.find', 'https://elsewhere.example.com/x')), 's', [old], []);
    expect(sync.changed).toEqual(['a.find']);
    expect(sync.save[0]).toMatchObject({ enabled: false, source: { id: 's', changed: true } });
    // Still changed at the next sync, while the user has not switched it on.
    const again = syncSource(file(tool('a.find', 'https://elsewhere.example.com/x')), 's', sync.save, []);
    expect(again.save[0]).toMatchObject({ enabled: false, source: { changed: true } });
  });

  it('takes its group, which may change without turning it off', () => {
    const old = synced({ ...tool('a.find'), group: 'Team' });
    const sync = syncSource(file({ ...tool('a.find'), group: 'Team API' }), 's', [old], []);
    expect(sync.changed).toEqual([]);
    expect(sync.save[0]).toMatchObject({ enabled: true, group: 'Team API' });
    expect(runtimeCustomTools(sync.save, []).map((t) => t.group)).toEqual(['custom:Team API']);
    expect(runtimeCustomTools([tool('my.tool')], []).map((t) => t.group)).toEqual([undefined]); // the custom tools' own group
  });

  it('removes those no longer in it, keeps one left out by a mistake, and never takes a name that is not its own', () => {
    const mine: CustomTool = { ...tool('my.tool'), id: 'mine' };
    const other = { ...synced(tool('b.tool')), source: { id: 'other', does: '' } };
    const kept = synced(tool('a.broken'));
    const sync = syncSource(JSON.stringify({ customTools: [{ name: 'a.broken', base: 'http', params: {} }, ...JSON.parse(file(tool('my.tool'), tool('b.tool'))).customTools] }), 's',
      [mine, other, kept, synced(tool('a.gone'))], []);
    expect(sync.remove.map((t) => t.name)).toEqual(['a.gone']);
    expect(sync.save).toEqual([]);
    expect(sync.skipped.join('\n')).toContain('my.tool: a tool of yours, or of another source, has that name.');
    expect(sync.skipped.join('\n')).toContain('b.tool: a tool of yours');
    expect(sync.skipped.join('\n')).toMatch(/^a\.broken: /m);
  });

  it('leaves its tools, as the user\'s own, when it is removed', () => {
    expect(unsourced([synced(tool('a.find')), tool('my.tool')], 's')).toEqual([{ ...synced(tool('a.find')), source: undefined }].map(({ source: _s, ...t }) => t));
  });

  it('is read now, with its headers and the session, only from a site allowed', async () => {
    const fetch = mockFetch(new Response('{"customTools":[]}', { status: 200 }));
    const source = { url: 'https://tools.example.com/team.json', session: true, headers: [{ name: 'X-CSRF', value: '{{cookie:csrf}}' }] };
    expect(await readSource(source)).toBe('{"customTools":[]}');
    expect(fetch).toHaveBeenCalledWith('https://tools.example.com/team.json', expect.objectContaining({ headers: { 'X-CSRF': 'c1' }, credentials: 'include', cache: 'no-store' }));
    mockFetch(new Response('no', { status: 401 }));
    await expect(readSource(source)).rejects.toThrow('tools.example.com answered 401 (signed in? its headers?).');
    await expect(readSource({ url: 'https://other.example.com/x.json' })).rejects.toThrow('No permission');
    mockFetch(redirecting); // its headers and session never go to where a redirect leads
    await expect(readSource(source)).rejects.toThrow('tools.example.com answered with a redirect, which is not followed');
  });
});
