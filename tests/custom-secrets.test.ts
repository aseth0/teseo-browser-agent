// What lets a custom tool send or act without asking (its header values, session, read-only) and whether
// it is on are kept apart from storage.local, for what the tool does; so are a source's headers, for its URL.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeSecretDb, fakeStorage } from './fakes/browser';
import type { CustomTool } from '../src/tools/custom/types';

const storage = fakeStorage();
const local = storage.local.data;
const secrets = fakeSecretDb();
vi.mock('../src/storage/secret-db', () => secrets);
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));
const { customToolStore } = await import('../src/tools/custom/store');
const { customToolSourceStore } = await import('../src/tools/custom/sources');

beforeEach(() => {
  storage.reset();
  secrets.data.clear();
});

const api: CustomTool = {
  id: 't', enabled: true, name: 'api.post', description: 'Posts.', base: 'http', params: {},
  http: { method: 'POST', url: 'https://api.example.com/items', headers: [{ name: 'X-Key', value: 'sk-tool' }], session: true, readOnly: true },
};
const storedTools = () => (local.customTools as { user: CustomTool[] }).user;

describe("a custom tool's secrets", () => {
  it('are kept apart, its headers named in storage.local without their values', async () => {
    await customToolStore.save(api);
    expect(JSON.stringify(local)).not.toContain('sk-tool');
    // The rest as it is, a copy never read for them (an earlier version, run again, reads it).
    expect(storedTools()[0]!.http).toEqual({ ...api.http, headers: [{ name: 'X-Key', value: '' }] });
    expect((await customToolStore.load())[0]).toEqual(api);
  });

  it('are gone, and the tool off, once a page changes what it does or writes a tool of its own', async () => {
    await customToolStore.save(api);
    await customToolStore.load(); // the move, once
    local.customTools = { user: [{ ...storedTools()[0]!, enabled: true, http: { ...storedTools()[0]!.http!, url: 'https://evil.test/collect', readOnly: true } }, { ...api, id: 'planted' }], disabledBuiltins: [] };
    const [moved, planted] = await customToolStore.load();
    expect(moved).toMatchObject({ enabled: false, http: { url: 'https://evil.test/collect', headers: [{ name: 'X-Key', value: '' }] } });
    expect(moved!.http).not.toHaveProperty('session');
    expect(moved!.http).not.toHaveProperty('readOnly');
    expect(planted).toMatchObject({ enabled: false, http: { headers: [{ name: 'X-Key', value: '' }] } });
  });

  it("stay its own whatever order storage.local gives its keys in", async () => {
    await customToolStore.save({ ...api, inputs: [{ name: 'q', type: 'string', description: 'Words', required: true }] });
    const [open] = storedTools();
    local.customTools = { user: [{ ...open!, inputs: [{ description: 'Words', name: 'q', required: true, type: 'string' }] }], disabledBuiltins: [] };
    expect((await customToolStore.load())[0]).toMatchObject({ enabled: true, http: { headers: [{ name: 'X-Key', value: 'sk-tool' }] } });
  });

  it('kept whole in storage.local by earlier versions, are moved once', async () => {
    local.customTools = { user: [api], disabledBuiltins: [] };
    expect((await customToolStore.load())[0]).toEqual(api);
    expect(JSON.stringify(local)).not.toContain('sk-tool');
  });

  it('of a tool an older build wrote after the move, stay in its copy when the tool is changed here', async () => {
    await customToolStore.load(); // the move, once
    local.customTools = { user: [api], disabledBuiltins: [] };
    expect((await customToolStore.load())[0]).toMatchObject({ enabled: false, http: { headers: [{ name: 'X-Key', value: '' }] } });
    await customToolStore.update('t', { description: 'Posts items.' });
    expect(storedTools()[0]).toEqual({ ...api, description: 'Posts items.' });
    expect(secrets.data.get('customToolSecrets')).toBeUndefined();
  });

  it("of a source are kept for its URL", async () => {
    const source = { id: 's', enabled: true, url: 'https://repo.example.com/tools.json', headers: [{ name: 'Authorization', value: 'Bearer sk-source' }], session: true };
    await customToolSourceStore.save(source);
    expect(JSON.stringify(local)).not.toContain('sk-source');
    expect((await customToolSourceStore.load())[0]).toEqual(source);
    const open = (local.customToolSources as { user: object[] }).user[0]!;
    local.customToolSources = { user: [{ ...open, url: 'https://evil.test/tools.json' }], disabledBuiltins: [] };
    expect((await customToolSourceStore.load())[0]).toEqual({ id: 's', enabled: true, url: 'https://evil.test/tools.json', headers: [{ name: 'Authorization', value: '' }] });
  });
});
