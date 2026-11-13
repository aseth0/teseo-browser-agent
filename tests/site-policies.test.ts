import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeSecretDb, fakeStorage } from './fakes/browser';

const storage = fakeStorage();
const store = storage.local.data;
const secrets = fakeSecretDb();
vi.mock('../src/storage/secret-db', () => secrets);
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));

const { agentPolicyStore, loadSitePolicies, moveLegacyPolicies, setSitePolicy } = await import('../src/policy/store');

beforeEach(() => {
  storage.reset();
  secrets.data.clear();
  secrets.trusted = true;
});

describe('site policies per agent', () => {
  it("keeps each agent's policies apart", async () => {
    await setSitePolicy('shop.test', 'auto');
    await setSitePolicy('shop.test', 'read-only', 'mail');
    expect(await loadSitePolicies()).toEqual({ 'shop.test': 'auto' });
    expect(await loadSitePolicies('mail')).toEqual({ 'shop.test': 'read-only' });
  });

  it('drops the entry when set back to ask', async () => {
    await setSitePolicy('shop.test', 'read-only', 'mail');
    await setSitePolicy('shop.test', 'ask', 'mail');
    expect(await loadSitePolicies('mail')).toEqual({});
  });

  it('live where no content script can read or write them', async () => {
    await setSitePolicy('shop.test', 'auto');
    expect(JSON.stringify(store)).not.toContain('shop.test');
    secrets.trusted = false; // as a content script
    await expect(loadSitePolicies()).rejects.toThrow();
  });

  it('tell their watchers when they change', async () => {
    const seen: unknown[] = [];
    const stop = agentPolicyStore('mail').onChanged((p) => seen.push(p));
    await setSitePolicy('shop.test', 'auto', 'mail');
    await vi.waitFor(() => expect(seen).toEqual([{ 'shop.test': 'auto' }]));
    stop();
  });
});

describe('site policies kept by earlier versions in storage.local', () => {
  it('are moved once, for the browser agent and each agent; one already moved wins', async () => {
    await setSitePolicy('shop.test', 'read-only');
    store.sitePolicies = { 'shop.test': 'auto', 'mail.test': 'auto' }; // from before agents existed
    store['sitePolicies.jira'] = { 'jira.test': 'auto' };
    store.unrelated = 1;
    await moveLegacyPolicies();
    expect(await loadSitePolicies()).toEqual({ 'shop.test': 'read-only', 'mail.test': 'auto' });
    expect(await loadSitePolicies('jira')).toEqual({ 'jira.test': 'auto' });
    expect(Object.keys(store).filter((k) => k.startsWith('sitePolicies'))).toEqual([]);
    expect(store.unrelated).toBe(1);
  });

  it('written there later (by a content script) are dropped, never taken', async () => {
    await moveLegacyPolicies(); // a new install: nothing to move
    store.sitePolicies = { 'evil.test': 'auto' };
    store['sitePolicies.widget'] = { 'evil.test': 'auto' };
    await moveLegacyPolicies();
    expect(await loadSitePolicies()).toEqual({});
    expect(await loadSitePolicies('widget')).toEqual({});
    expect(Object.keys(store).filter((k) => k.startsWith('sitePolicies'))).toEqual([]);
  });
});
