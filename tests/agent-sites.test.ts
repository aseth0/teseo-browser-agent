import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeSecretDb, fakeStorage } from './fakes/browser';

const storage = fakeStorage();
const local = storage.local.data;
const secrets = fakeSecretDb();
vi.mock('../src/storage/secret-db', () => secrets);
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));
const { agentStore, newAgentProfile } = await import('../src/agents/profiles');
const { moveLegacySignIns } = await import('../src/mcp/oauth');
type AgentProfile = import('../src/agents/profiles').AgentProfile;

// What an agent may reach (its sites, tools, …) is kept apart from it, where no content script can write it; and the MCP
// sign-ins of earlier versions are moved once, what comes after under their old key removed unread.
const agent = (id: string, sites: AgentProfile['sites'] = {}): AgentProfile => ({ ...newAgentProfile(), id, name: id, sites });
const storedAgents = () => (local.agents as { user: AgentProfile[] } | undefined)?.user ?? [];

beforeEach(() => {
  storage.reset();
  secrets.data.clear();
});

describe('what an agent may reach', () => {
  const access = (id: string) => (secrets.data.get('agentAccess') as Record<string, Partial<AgentProfile>> | undefined)?.[id];

  it('is kept in the secrets (storage.local keeps a copy for earlier versions, never read)', async () => {
    await agentStore.save({ ...agent('shop', { 'shop.example.com': 'auto' }), tools: ['browser.click'], onlyItsSites: true, canAsk: true });
    expect(storedAgents()[0]!.tools).toEqual(['browser.click']); // what an earlier version, run again, reads
    expect(access('shop')).toEqual({ sites: { 'shop.example.com': 'auto' }, onlyItsSites: true, tools: ['browser.click'], canAsk: true, canBeAsked: false, enabled: true });
    expect((await agentStore.load()).find((a) => a.id === 'shop')).toMatchObject({ sites: { 'shop.example.com': 'auto' }, tools: ['browser.click'], onlyItsSites: true, canAsk: true, enabled: true });
  });

  it('does not follow what a content script writes in storage.local', async () => {
    await agentStore.save({ ...agent('shop'), onlyItsSites: true });
    local.agents = { user: [{ ...agent('shop', { 'evil.example.com': 'auto' }), tools: ['agents.save'], onlyItsSites: false, canAsk: true }], disabledBuiltins: [] };
    expect((await agentStore.load()).find((a) => a.id === 'shop')).toMatchObject({ sites: {}, tools: [], onlyItsSites: true, canAsk: false });
  });

  it('is nothing for an agent written to storage.local alone, which is off', async () => {
    await agentStore.load(); // the move, once
    local.agents = { user: [{ ...agent('planted', { 'evil.example.com': 'auto' }), tools: ['browser.click'] }], disabledBuiltins: [] };
    expect((await agentStore.load()).find((a) => a.id === 'planted')).toMatchObject({ enabled: false, sites: {}, tools: [], onlyItsSites: true, canAsk: false, canBeAsked: false });
  });

  // What a build ≤ v0.57.15 writes, sharing the profile: the agent whole in storage.local, no part kept.
  const olderBuild = () => ({ ...agent('older', { 'shop.example.com': 'auto' }), tools: ['browser.click'], onlyItsSites: false, canAsk: true, enabled: true });

  it('of an agent an older build wrote, is left in its copy when the agent is changed here', async () => {
    await agentStore.load(); // the move, once
    local.agents = { user: [olderBuild()], disabledBuiltins: [] };
    await agentStore.update('older', { name: 'x' });
    expect(storedAgents()[0]).toEqual({ ...olderBuild(), name: 'x' });
    expect(access('older')).toBeUndefined();
    await agentStore.save({ ...(await agentStore.load()).find((a) => a.id === 'older')!, instructions: 'Be brief.' });
    expect(storedAgents()[0]).toMatchObject({ tools: ['browser.click'], sites: { 'shop.example.com': 'auto' }, enabled: true, instructions: 'Be brief.' });
  });

  it('of an agent an older build wrote, is the one set here once the user sets it', async () => {
    await agentStore.load();
    local.agents = { user: [olderBuild()], disabledBuiltins: [] };
    await agentStore.update('older', (a) => ({ ...a, tools: ['browser.find'], enabled: true }));
    expect(access('older')).toMatchObject({ tools: ['browser.find'], enabled: true, sites: {} });
    expect(storedAgents()[0]).toMatchObject({ tools: ['browser.find'], sites: {} });
  });

  it('changes with the agent, also two changes at once, and goes when it is deleted', async () => {
    await agentStore.save(agent('shop', { 'shop.example.com': 'ask' }));
    const changed = await agentStore.update('shop', (a) => ({ ...a, sites: { ...a.sites, 'docs.example.com': 'read-only' } }));
    expect(changed!.sites).toEqual({ 'shop.example.com': 'ask', 'docs.example.com': 'read-only' });
    await Promise.all([
      agentStore.update('shop', (a) => ({ ...a, sites: { ...a.sites, 'a.example.com': 'auto' } })),
      agentStore.update('shop', (a) => ({ ...a, sites: { ...a.sites, 'b.example.com': 'auto' } })),
    ]);
    expect(Object.keys((await agentStore.load()).find((a) => a.id === 'shop')!.sites).sort()).toEqual(['a.example.com', 'b.example.com', 'docs.example.com', 'shop.example.com']);
    await agentStore.remove('shop');
    expect(secrets.data.get('agentAccess')).toEqual({});
  });

  it('kept by earlier versions (the sites in agentSites, the rest with the agent) is moved once', async () => {
    local.agents = { user: [{ ...agent('shop'), tools: ['browser.click'], onlyItsSites: true, canAsk: true }], disabledBuiltins: [] };
    secrets.data.set('agentSites', { shop: { 'shop.example.com': 'auto' } });
    expect((await agentStore.load()).find((a) => a.id === 'shop')).toMatchObject({ sites: { 'shop.example.com': 'auto' }, tools: ['browser.click'], onlyItsSites: true, canAsk: true, enabled: true });
    expect(secrets.data.has('agentSites')).toBe(true); // left for an earlier version, run again
    // After the move, what storage.local says of it is never read.
    local.agents = { user: [{ ...agent('shop', { 'evil.example.com': 'auto' }), tools: ['agents.save'] }], disabledBuiltins: [] };
    expect((await agentStore.load()).find((a) => a.id === 'shop')).toMatchObject({ sites: { 'shop.example.com': 'auto' }, tools: ['browser.click'] });
  });

  it('of an agent saved by a version older still, with its sites beside it, is moved too', async () => {
    local.agents = { user: [agent('shop', { 'shop.example.com': 'auto' })], disabledBuiltins: [] };
    expect((await agentStore.load()).find((a) => a.id === 'shop')!.sites).toEqual({ 'shop.example.com': 'auto' });
  });
});

describe('the MCP sign-ins of earlier versions', () => {
  it('are moved once; what is written under their old key later is removed unread', async () => {
    local.mcpAuth = { s1: { url: 'https://mcp.example.com', tokens: { access_token: 'old', token_type: 'Bearer' } } };
    await moveLegacySignIns();
    expect(secrets.data.get('mcpAuth')).toMatchObject({ s1: { url: 'https://mcp.example.com' } });
    expect('mcpAuth' in local).toBe(false);
    local.mcpAuth = { s2: { url: 'https://evil.example.com', tokens: { access_token: 'planted', token_type: 'Bearer' } } };
    await moveLegacySignIns();
    expect(secrets.data.get('mcpAuth')).not.toHaveProperty('s2');
    expect('mcpAuth' in local).toBe(false);
  });
});
