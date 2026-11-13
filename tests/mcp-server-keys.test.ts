// What goes by an MCP server's name (its policy, an agent's site, a conversation's policy, its logs)
// moves with it when it is renamed and goes with it when it is removed.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeSecretDb, fakeStorage } from './fakes/browser';

const storage = fakeStorage();
const secrets = fakeSecretDb();
vi.mock('../src/storage/secret-db', () => secrets);
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));
const { moveServerKeys } = await import('../src/mcp/server-keys');
const { conversationPolicies, loadSitePolicies, setSitePolicy } = await import('../src/policy/store');
const { agentStore, newAgentProfile } = await import('../src/agents/profiles');
const { loadMcpLogs, logMcp } = await import('../src/mcp/logs');

beforeEach(() => {
  storage.reset();
  secrets.data.clear();
});

const seed = async () => {
  await setSitePolicy('mcp:notes', 'auto');
  await setSitePolicy('shop.example.com', 'auto');
  await conversationPolicies('c1').set('mcp:notes', 'auto');
  await agentStore.save({ ...newAgentProfile(), id: 'a', name: 'A', sites: { 'mcp:notes': 'auto', 'shop.example.com': 'ask' } });
  await logMcp({ at: 1, server: 'notes', kind: 'test', ok: true, detail: '3 tools' });
};
const agentSites = async () => (await agentStore.load()).find((a) => a.id === 'a')!.sites;

describe("an MCP server's keys", () => {
  it('go with it when it is removed', async () => {
    await seed();
    await moveServerKeys('notes', undefined);
    expect(await loadSitePolicies()).toEqual({ 'shop.example.com': 'auto' });
    expect(await conversationPolicies('c1').load()).toEqual({});
    expect(await agentSites()).toEqual({ 'shop.example.com': 'ask' });
    expect(await loadMcpLogs()).toEqual([]);
  });

  it('move with it when it is renamed', async () => {
    await seed();
    await moveServerKeys('notes', 'notes2');
    expect(await loadSitePolicies()).toEqual({ 'shop.example.com': 'auto', 'mcp:notes2': 'auto' });
    expect(await conversationPolicies('c1').load()).toEqual({ 'mcp:notes2': 'auto' });
    expect(await agentSites()).toEqual({ 'shop.example.com': 'ask', 'mcp:notes2': 'auto' });
    expect((await loadMcpLogs()).map((e) => e.server)).toEqual(['notes2']);
  });
});
