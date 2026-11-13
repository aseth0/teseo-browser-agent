import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeStorage } from './fakes/browser';

// The script that hears the keys set in Settings → Shortcuts in web pages: registered on every site the
// extension may read while a key is set, gone when none is.
type Script = { id: string; matches: string[]; js: string[]; runAt: string; allFrames: boolean; persistAcrossSessions: boolean };
const storage = fakeStorage();
let registered: Script[] = [];
let origins: string[] = [];
const scripting = {
  getRegisteredContentScripts: vi.fn(async () => registered),
  registerContentScripts: vi.fn(async (s: Script[]) => void (registered = s)),
  updateContentScripts: vi.fn(async (s: Script[]) => void (registered = s)),
  unregisterContentScripts: vi.fn(async () => void (registered = [])),
  executeScript: vi.fn(async () => []),
};
const tabsList = [{ id: 3 }, { id: 4 }];
vi.mock('wxt/browser', () => ({
  browser: fakeBrowser(storage, {
    scripting,
    tabs: { query: vi.fn(async () => tabsList) },
    permissions: { getAll: async () => ({ origins }) },
    runtime: { getManifest: () => ({ host_permissions: ['https://api.example.com/*'] }) },
  }),
}));
const { syncPageKeysScript } = await import('../src/shortcuts/script');
const { PAGE_KEYS_KEY } = await import('../src/storage/keys');

const aKey = { 'float-chat': { code: 'KeyF', ctrl: true, alt: true } };
beforeEach(() => {
  storage.reset();
  registered = [];
  origins = [];
  vi.clearAllMocks();
});

describe('the page keys script', () => {
  it('no key set: none', async () => {
    origins = ['<all_urls>'];
    await syncPageKeysScript();
    expect(scripting.registerContentScripts).not.toHaveBeenCalled();
  });
  it('a key set, every site granted: on every site, every frame, before the page runs', async () => {
    origins = ['<all_urls>'];
    storage.local.data[PAGE_KEYS_KEY] = aKey;
    await syncPageKeysScript();
    expect(registered).toEqual([{ id: 'page-keys', matches: ['<all_urls>'], js: ['page-keys.js'], runAt: 'document_start', allFrames: true, persistAcrossSessions: true }]);
  });
  it('sites granted one by one: on those', async () => {
    origins = ['https://shop.example.com/*', 'https://api.example.com/*'];
    storage.local.data[PAGE_KEYS_KEY] = aKey;
    await syncPageKeysScript();
    expect(registered[0]?.matches).toEqual(['https://shop.example.com/*']);
  });
  it('the last key cleared, or no site left: gone', async () => {
    origins = ['<all_urls>'];
    storage.local.data[PAGE_KEYS_KEY] = aKey;
    await syncPageKeysScript();
    storage.local.data[PAGE_KEYS_KEY] = {};
    await syncPageKeysScript();
    expect(registered).toEqual([]);
  });
  it('unchanged: left as it is; put into the open tabs only when asked (after a reload)', async () => {
    origins = ['<all_urls>'];
    storage.local.data[PAGE_KEYS_KEY] = aKey;
    await syncPageKeysScript();
    vi.clearAllMocks();
    await syncPageKeysScript();
    expect(scripting.updateContentScripts).not.toHaveBeenCalled();
    expect(scripting.executeScript).not.toHaveBeenCalled();
    await syncPageKeysScript(true);
    expect(scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 3, allFrames: true }, files: ['/page-keys.js'] });
    expect(scripting.executeScript).toHaveBeenCalledTimes(2);
  });
  it('newly registered: put into the open tabs it matches', async () => {
    origins = ['<all_urls>'];
    storage.local.data[PAGE_KEYS_KEY] = aKey;
    await syncPageKeysScript();
    expect(scripting.executeScript).toHaveBeenCalledTimes(2);
  });
});
