import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeSecretDb, fakeStorage } from './fakes/browser';
import { TOOL_SETTINGS } from './helpers';

const storage = fakeStorage();
const secrets = fakeSecretDb(); // agents' sites (agents/profiles)
vi.mock('../src/storage/secret-db', () => secrets);
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));

const { pathShape } = await import('../src/tools/browser/site-access');
const { manageCustomTools } = await import('../src/tools/custom/manage');
const { customToolStore } = await import('../src/tools/custom/store');

const ctx = { settings: TOOL_SETTINGS, tabId: 1, signal: new AbortController().signal };
const save = manageCustomTools(async () => [])[0]!;
const search = {
  name: 'mm.search',
  description: 'Searches the Mattermost channels.',
  base: 'http',
  inputs: [{ name: 'term', type: 'string', description: 'Words', required: true }],
  http: {
    method: 'POST', url: 'https://chat.example.com/api/v4/teams/t1/channels/search', body: '{"term": {term}}', session: true,
    headers: [{ name: 'X-Requested-With', value: 'XMLHttpRequest' }, { name: 'X-CSRF-Token', value: '{{cookie:MMCSRF}}' }],
  },
};
const detail = (details: { label: string; value: string }[] | undefined, label: string) => details?.find((d) => d.label === label)?.value;

beforeEach(() => {
  storage.reset();
});

describe('browser.site_access', () => {
  it('names a request by its shape, the ids in its path left out', () => {
    expect(pathShape('/api/v4/teams/8aaexpniaif53r3exrg1kpg6wy/channels/search')).toBe('/api/v4/teams/{id}/channels/search');
    expect(pathShape('/api/v4/posts/123/thread')).toBe('/api/v4/posts/{id}/thread');
    expect(pathShape('/api/v4/users/me')).toBe('/api/v4/users/me');
  });
});

describe('custom_tools.save with the session and headers', () => {
  it('gives a new request the model\'s headers and the session, each shown in the card', async () => {
    const { details } = await save.describe!(search, ctx);
    expect(detail(details, 'Headers')).toBe('X-Requested-With: XMLHttpRequest\nX-CSRF-Token: {{cookie:MMCSRF}}');
    expect(detail(details, 'Signed in as you')).toBe('Sends your browser session for chat.example.com');
    await save.run(search, ctx);
    expect((await customToolStore.load())[0]?.http).toMatchObject({ session: true, headers: search.http.headers });
  });

  it('keeps on an update the headers and session there were, never the model\'s', async () => {
    const mine = [{ name: 'Authorization', value: 'Bearer secret' }];
    await customToolStore.save({ id: 'm', enabled: true, createdBy: 'user', ...search, params: {}, inputs: search.inputs as never, http: { ...search.http, method: 'POST', headers: mine } } as never);
    const update = { ...search, http: { ...search.http, headers: [{ name: 'Authorization', value: 'Bearer other' }] } };
    const { details } = await save.describe!(update, ctx);
    expect(detail(details, 'Headers')).toBe('1 kept as they were (Settings → Custom tools changes them)');
    expect(JSON.stringify(details)).not.toContain('secret');
    await save.run(update, ctx);
    expect((await customToolStore.load())[0]?.http?.headers).toEqual(mine);
  });

  it('refuses a header from a cookie without the session', async () => {
    await expect(save.describe!({ ...search, http: { ...search.http, session: false } }, ctx)).rejects.toThrow('it needs the browser session');
  });

  it('is there for Builder', async () => {
    const { agentStore } = await import('../src/agents/profiles');
const { BUILDER_ID } = await import('../src/core/builder-ids');
    expect((await agentStore.load()).find((a) => a.id === BUILDER_ID)?.tools).toContain('browser.site_access');
  });
});

