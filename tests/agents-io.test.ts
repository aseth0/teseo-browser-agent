import { describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', async () => (await import('./fakes/browser')).emptyBrowser());
const { exportAgents, importAgents } = await import('../src/agents/io');
const { newAgentProfile } = await import('../src/agents/profiles');

const jira = { ...newAgentProfile(), id: 'j', name: 'jira', icon: '🎫', instructions: 'Keys like INC-1.', tools: ['browser.find'], sites: { 'jira.test': 'auto' as const, 'wiki.test': 'read-only' as const } };

describe('agents as JSON', () => {
  it('exports them without ids, their on/off or what the Builder came with', () => {
    const [shared] = JSON.parse(exportAgents([jira])).agents;
    expect(shared).toMatchObject({ name: 'jira', icon: '🎫', tools: ['browser.find'] });
    expect(shared.id).toBeUndefined();
    expect(shared.enabled).toBeUndefined();
    const [builder] = JSON.parse(exportAgents([{ ...jira, builderSkills: ['create-skill'], builderTools: ['web.read'] }])).agents;
    expect(builder.builderSkills).toBeUndefined();
    expect(builder.builderTools).toBeUndefined();
  });
  it('imports them off, never acting on a site without asking', () => {
    const { agents, skipped } = importAgents(exportAgents([jira]), []);
    expect(skipped).toEqual([]);
    expect(agents[0]).toMatchObject({ name: 'jira', enabled: false, tools: ['browser.find'], sites: { 'jira.test': 'ask', 'wiki.test': 'read-only' } });
  });
  it('keeps whether it can ask and be asked', () => {
    const { agents } = importAgents(exportAgents([{ ...jira, canAsk: true }]), []);
    expect(agents[0]).toMatchObject({ canAsk: true, canBeAsked: false });
  });
  it('replaces the one of the same name, keeping its id; leaves out what cannot be saved', () => {
    const { agents } = importAgents(exportAgents([{ ...jira, name: 'JIRA' }]), [jira]);
    expect(agents[0]!.id).toBe('j');
    const { agents: none, skipped } = importAgents('[{"name": ""}, {"name": "Default"}]', []);
    expect(none).toEqual([]);
    expect(skipped).toHaveLength(2);
    expect(() => importAgents('{"agents": 3}', [])).toThrow('No "agents" list');
  });
});
