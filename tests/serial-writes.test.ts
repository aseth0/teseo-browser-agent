import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeSecretDb, fakeStorage } from './fakes/browser';

// Storage whose reads are slow, so two read-modify-writes overlap unless they take turns.
const storage = fakeStorage({ delayMs: 5 });
const secrets = fakeSecretDb(); // the site policies and the kept action log live there
vi.mock('../src/storage/secret-db', () => secrets);
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));
const { agentPolicyStore, conversationPolicies, movePolicyKey } = await import('../src/policy/store');
const { loadLabelColors, setLabelColor } = await import('../src/tools/labels');
const { clearMcpLogs, loadMcpLogs, logMcp } = await import('../src/mcp/logs');
const { loadActionLog, logAction } = await import('../src/logs/actions');

const mcp = (server: string, at: number) => ({ at, server, kind: 'call' as const, ok: true, detail: 'x' });
const action = (at: number) => ({ at, source: 'chat' as const, agent: 'Default', tool: 'browser.click', decision: 'free' as const, ok: true, ms: 1 });

beforeEach(() => {
  storage.reset();
  secrets.data.clear();
});

describe('changes made at once all stay', () => {
  it('site policies, the agent\'s and the conversation\'s', async () => {
    const agent = agentPolicyStore();
    await Promise.all([agent.set('a.example.com', 'auto'), agent.set('b.example.com', 'read-only'), agent.set('c.example.com', 'auto')]);
    expect(await agent.load()).toEqual({ 'a.example.com': 'auto', 'b.example.com': 'read-only', 'c.example.com': 'auto' });
    const conversation = conversationPolicies('c1');
    await Promise.all([conversation.set('a.example.com', 'auto'), conversation.set('b.example.com', 'auto')]);
    expect(Object.keys(await conversation.load())).toEqual(['a.example.com', 'b.example.com']);
  });

  it("a conversation's policy set while a key's policies move", async () => {
    const conversation = conversationPolicies('c2');
    await conversation.set('mcp:old', 'auto');
    await Promise.all([movePolicyKey('mcp:old', 'mcp:new'), conversation.set('b.example.com', 'auto')]);
    expect(await conversation.load()).toEqual({ 'mcp:new': 'auto', 'b.example.com': 'auto' });
  });

  it('label colors', async () => {
    await Promise.all([setLabelColor('work', 'red'), setLabelColor('home', 'blue')]);
    expect(await loadLabelColors()).toEqual({ work: 'red', home: 'blue' });
  });

  it('MCP logs, and clearing one server\'s among them', async () => {
    await logMcp(mcp('one', 1));
    await Promise.all([logMcp(mcp('two', 2)), clearMcpLogs('one'), logMcp(mcp('one', 3))]);
    expect((await loadMcpLogs()).map((e) => e.at)).toEqual([3, 2]);
  });

  it('the action log', async () => {
    await Promise.all([logAction(action(1), 'session'), logAction(action(2), 'session'), logAction(action(3), 'kept'), logAction(action(4), 'kept')]);
    expect((await loadActionLog()).map((e) => e.at)).toEqual([4, 3, 2, 1]);
  });
});

describe('a log that cannot be written', () => {
  it('says so, without failing what it logs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const area of [storage.local, storage.session]) vi.spyOn(area, 'set').mockRejectedValue(new Error('QUOTA_BYTES quota exceeded'));
    await expect(logMcp(mcp('one', 1))).resolves.toBeUndefined();
    await expect(logAction(action(1), 'kept')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });
});
