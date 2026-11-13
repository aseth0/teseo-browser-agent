import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeSecretDb, fakeStorage } from './fakes/browser';

const storage = fakeStorage();
const secrets = fakeSecretDb();
vi.mock('../src/storage/secret-db', () => secrets);
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));
const { agentStore, newAgentProfile } = await import('../src/agents/profiles');
const { policyAccessFor } = await import('../src/policy/agent-access');
const { loadSitePolicies, setSitePolicy } = await import('../src/policy/store');

const COLUMN = 'widget';
const agent = { ...newAgentProfile(), name: 'shopper', sites: { 'shop.test': 'auto' as const } };

beforeEach(async () => {
  storage.reset();
  secrets.data.clear();
  await agentStore.save(agent);
  await setSitePolicy('mail.test', 'read-only', COLUMN);
});

describe('policyAccessFor', () => {
  it('without an agent, goes by the column and saves to it', async () => {
    const access = policyAccessFor(undefined, COLUMN);
    expect(await access.policies()).toEqual({ 'mail.test': 'read-only' });
    await access.save('shop.test', 'auto');
    expect(await loadSitePolicies(COLUMN)).toEqual({ 'mail.test': 'read-only', 'shop.test': 'auto' });
  });

  it("puts the agent's own sites, as saved now, over the column", async () => {
    const access = policyAccessFor(agent, COLUMN);
    await agentStore.save({ ...agent, sites: { 'shop.test': 'ask' } }); // changed since the run started
    expect(await access.policies()).toEqual({ 'mail.test': 'read-only', 'shop.test': 'ask' });
  });

  it('saves a decision to the agent on its sites, else to the column', async () => {
    const access = policyAccessFor(agent, COLUMN);
    await access.save('shop.test', 'read-only');
    await access.save('news.test', 'auto');
    expect((await agentStore.load()).find((a) => a.id === agent.id)?.sites).toEqual({ 'shop.test': 'read-only' });
    expect(await loadSitePolicies(COLUMN)).toEqual({ 'mail.test': 'read-only', 'news.test': 'auto' });
  });
});
