import { describe, expect, it, vi } from 'vitest';
import { stripMarks } from '../src/core/model-texts';
import type { Tool } from '../src/core/types';
import { buildSystemPrompt } from '../src/context/request';
import { authorize, type PolicyDeps } from '../src/policy/engine';
import type { Skill } from '../src/skills/types';
import type { PageTemplate } from '../src/templates/types';
import type { Settings } from '../src/storage/settings';
import { activeTarget } from '../src/storage/settings-select';
import { TOOL_SETTINGS } from './helpers';

// Hoisted with the mock: this file imports the code under test statically.
vi.mock('wxt/browser', async () => {
  const { fakeBrowser, fakeStorage } = await import('./fakes/browser');
  return { browser: fakeBrowser(fakeStorage()) };
});
const { agentAllows, agentById, agentIdByName, agentNameById, agentDisabledTools, agentOfSite, agentOffers, agentPolicies, agentProblems, agentToolsFrom, isSiteKey, keepsPolicy, newAgentProfile, seenBy, withSite } = await import('../src/agents/profiles');
const { upgradeBuilder } = await import('../src/agents/builder');
const { EMPTY_AGENT } = await import('../src/agents/builtins');
const { isHost } = await import('../src/core/hosts');
const { skillTools } = await import('../src/skills/tools');
const { webTools } = await import('../src/web/tools');

const jira = { ...newAgentProfile(), templates: ['jira-ticket'], id: 'j', name: 'jira', instructions: 'Ticket keys look like INC-1.', tools: ['browser.find'], skills: ['triage'], sites: { 'jira.test': 'ask' as const } };

describe('agent profiles', () => {
  it('gives a stored Builder the skills new since it was stored, never one the user took away', () => {
    const old = { ...newAgentProfile(), id: 'builder', name: 'Builder', skills: ['create-agent', 'create-skill'] };
    const upgraded = upgradeBuilder(old);
    expect(upgraded.skills).toEqual(['create-agent', 'create-skill', 'create-script-tool', 'manage-creations']);
    const removed = { ...upgraded, skills: ['create-agent', 'create-skill'] };
    expect(upgradeBuilder(removed).skills).toEqual(['create-agent', 'create-skill']);
  });
  it('names an agent once, never "Browser", "Default" or "EmptyAgent", with both provider and model or neither', () => {
    expect(agentProblems(jira, [jira])).toEqual([]);
    expect(agentProblems({ ...jira, id: 'x', name: 'JIRA' }, [jira])).toEqual(['Another agent is named "JIRA".']);
    for (const name of ['Default', 'browser', 'EmptyAgent']) expect(agentProblems({ ...jira, name }, [])).toHaveLength(1);
    expect(agentProblems({ ...jira, providerId: 'p' }, [])).toHaveLength(1);
  });
  it('finds Browser by its name, or by "Default", its name before', () => {
    expect(agentIdByName([jira], 'Browser')).toBe('browser');
    expect(agentIdByName([jira], ' default ')).toBe('browser');
    expect(agentIdByName([jira], 'JIRA')).toBe('j');
    expect(agentNameById([jira], 'browser')).toBe('Browser');
  });
  it('runs as EmptyAgent, always there, with nothing but your system prompt', async () => {
    const { buildSystemPrompt, systemPromptParts } = await import('../src/context/request');
    const { memoryFor } = await import('../src/memory/store');
    expect(agentById([], 'empty')).toBe(EMPTY_AGENT);
    const settings = { systemPrompt: 'Be brief.', mcpServers: [{ enabled: true }] } as unknown as Settings;
    const skill = { name: 's', description: 'd', enabled: true, matches: [] } as unknown as Skill;
    expect(buildSystemPrompt({ settings, skills: [skill], templates: [], agent: EMPTY_AGENT, asksAgents: true, memory: [] })).toBe('Be brief.');
    expect(systemPromptParts({ settings, skills: [], templates: [], agent: EMPTY_AGENT }).slice(1).every((p) => !p.text && p.off === 'EmptyAgent gets only your system prompt')).toBe(true);
    const shared = { id: 'm', text: 'Rule', enabled: true, agents: [] } as never;
    expect(memoryFor([shared], 'empty')).toEqual([]);
    expect(memoryFor([shared], undefined)).toHaveLength(1);
    expect(agentOffers(EMPTY_AGENT, [{ name: 'browser.find' }, { name: 'web.search' }], [])).toEqual([]);
  });
  it('gives Browser its own instructions and icon', async () => {
    const { buildSystemPrompt } = await import('../src/context/request');
    const { browserAgentLabel } = await import('../src/agents/profiles');
    const plain = { systemPrompt: 'Be brief.' } as Settings;
    expect(buildSystemPrompt({ settings: plain, skills: [], templates: [] })).not.toContain('## Agent');
    const own = { ...plain, browserAgent: { instructions: 'Cite the page.' } } as Settings;
    expect(stripMarks(buildSystemPrompt({ settings: own, skills: [], templates: [] }))).toContain('## Agent: Browser\nCite the page.');
    expect(browserAgentLabel({})).toBe('🌐 Browser');
    expect(browserAgentLabel({ browserAgent: { icon: '' } })).toBe('Browser');
  });
  it('keeps the order the user dragged the agents to, new ones after', async () => {
    const { orderedAgentIds, movedAgent } = await import('../src/agents/profiles');
    const shop = { ...jira, id: 's' };
    expect(orderedAgentIds([jira, shop])).toEqual(['browser', 'empty', 'j', 's']);
    expect(orderedAgentIds([jira, shop], ['s', 'browser'])).toEqual(['s', 'browser', 'empty', 'j']);
    expect(movedAgent(['browser', 'empty', 'j', 's'], 3, 0)).toEqual(['s', 'browser', 'empty', 'j']);
    expect(movedAgent(['browser', 'empty', 'j', 's'], 0, 2)).toEqual(['empty', 'j', 'browser', 's']);
  });
  it('runs as the agent while it is on; else as Browser', () => {
    expect(agentById([jira], 'j')).toBe(jira);
    expect(agentById([{ ...jira, enabled: false }], 'j')).toBeUndefined();
    expect(agentById([jira], 'browser')).toBeUndefined();
    expect(agentById([jira], undefined)).toBeUndefined();
  });
  it('gets only its skills, and its sites given or taken away', () => {
    const skills = [{ name: 'triage', enabled: false }, { name: 'other', enabled: true }] as Skill[];
    expect(seenBy(jira, {} as Settings, skills, []).skills.map((s) => [s.name, s.enabled])).toEqual([['triage', true], ['other', false]]);
    expect(withSite(jira, 'mm.test', 'auto').sites).toEqual({ 'jira.test': 'ask', 'mm.test': 'auto' });
    expect(withSite(jira, 'jira.test', undefined).sites).toEqual({});
    // Never what is not a host (a page without one: about:blank, file://).
    expect(withSite(jira, 'about:blank', 'ask').sites).toEqual(jira.sites);
    // An MCP server's policy key ("Always" on an MCP tool's card) is kept too.
    expect(withSite(jira, 'mcp:todoist', 'auto').sites).toEqual({ 'jira.test': 'ask', 'mcp:todoist': 'auto' });
    expect(['mcp:todoist', 'jira.test'].map(isSiteKey)).toEqual([true, true]);
    expect(['mcp:', 'mcp: x', 'about:blank'].map(isSiteKey)).toEqual([false, false, false]);
    expect(['example.com', 'localhost:8080'].map(isHost)).toEqual([true, true]);
    expect(['', 'about:blank', 'file:///x', 'a b.com', 'https://x.com'].map(isHost)).toEqual([false, false, false, false, false]);
  });
  it('has its tools edited as the tools menus do, keeping those not available now', () => {
    const agent = { tools: ['browser.find', 'mcp.notes.echo'] };
    expect(agentDisabledTools(agent, ['browser.find', 'browser.click', 'skills.load'])).toEqual(['browser.click']); // the loaders are always on
    expect(agentToolsFrom(agent, ['browser.find', 'browser.click'], ['browser.find'])).toEqual(['browser.click', 'mcp.notes.echo']);
    expect(agentToolsFrom(agent, ['browser.find', 'skills.load'])).toEqual(['browser.find', 'mcp.notes.echo']); // the loaders go without saying
  });
  it('can always load the skills it was given', () => {
    const tools = ['browser.find', 'browser.click', 'skills.load', 'skills.read_reference', 'skills.save'].map((name) => ({ name }));
    expect(agentOffers(jira, tools, []).map((t) => t.name)).toEqual(['browser.find', 'skills.load', 'skills.read_reference']);
  });
  it('uses its own model when it has one', () => {
    const settings = { providers: [{ id: 'a', defaultModel: 'big' }, { id: 'b', defaultModel: 'x' }], activeProviderId: 'a' } as Settings;
    expect(activeTarget(settings).model).toBe('big');
    expect(activeTarget(settings, { providerId: 'b', model: 'cheap' })).toMatchObject({ provider: { id: 'b' }, model: 'cheap' });
    expect(activeTarget(settings, {}).model).toBe('big');
  });
  it('adds its instructions after the system prompt', () => {
    const settings = { systemPrompt: 'Be brief.', providers: [] } as unknown as Settings;
    expect(stripMarks(buildSystemPrompt({ settings, skills: [], templates: [], agent: jira })).startsWith('Be brief.\n\n## Agent: jira\nTicket keys look like INC-1.')).toBe(true);
    expect(stripMarks(buildSystemPrompt({ settings, skills: [], templates: [], agent: { name: 'x', instructions: ' ' } }))).toContain('Be brief.\n\n## Agent: x\n\n'); // the heading alone
  });
  it('gets only its site templates', () => {
    const templates = [{ name: 'jira-ticket', enabled: false }, { name: 'shop', enabled: true }] as PageTemplate[];
    expect(seenBy(jira, {} as Settings, [], templates).templates.map((t) => [t.name, t.enabled])).toEqual([['jira-ticket', true], ['shop', false]]);
    expect(seenBy(undefined, {} as Settings, [], templates).templates).toBe(templates);
  });
  it('is told about saved conversations only with the history tools', () => {
    const settings = { systemPrompt: '', providers: [], mentions: { history: false } } as unknown as Settings;
    const seen = (tools: string[]) => seenBy({ ...jira, tools }, settings, [], []).settings;
    expect(buildSystemPrompt({ settings: seen(['browser.find']), skills: [], templates: [], agent: jira })).not.toContain('history__search');
    expect(buildSystemPrompt({ settings: seen(['history.search']), skills: [], templates: [], agent: jira })).toContain('history__search');
  });
  it('is told about the page only with a browser tool', () => {
    const settings = { systemPrompt: 'Be brief.', providers: [] } as unknown as Settings;
    expect(buildSystemPrompt({ settings, skills: [], templates: [], agent: jira })).toContain('## Current web page');
    expect(buildSystemPrompt({ settings, skills: [], templates: [], agent: { ...jira, tools: ['todoist.add'] } })).not.toContain('## Current web page');
    expect(buildSystemPrompt({ settings, skills: [], templates: [] })).toContain('## Current web page');
  });
});

describe("an agent's sites", () => {
  const jira = { ...newAgentProfile(), id: 'j', name: 'jira', sites: { 'jira.test': 'auto' as const } };
  const closed = { ...jira, id: 'c', onlyItsSites: true };
  it('uses every site with its policy, its own on its sites; only its own when it says so', () => {
    expect(agentAllows(jira, 'mail.test')).toBe(true);
    expect(agentAllows(closed, 'mail.test')).toBe(false);
    expect(agentAllows(closed, 'jira.test')).toBe(true);
    const shared = { 'jira.test': 'ask' as const, 'mail.test': 'read-only' as const };
    expect(agentPolicies(jira, shared)).toEqual({ 'jira.test': 'auto', 'mail.test': 'read-only' });
    expect(agentPolicies(closed, shared)).toEqual({ 'jira.test': 'auto' });
  });
  it('keeps "Always" on its sites (any, when only its own); elsewhere it goes to the site', () => {
    expect(keepsPolicy(jira, 'jira.test')).toBe(true);
    expect(keepsPolicy(jira, 'mail.test')).toBe(false);
    expect(keepsPolicy(closed, 'mail.test')).toBe(true);
  });
  it('opens the chat with the first agent switched on that has the site', () => {
    const second = { ...jira, id: 's' };
    expect(agentOfSite([jira, second], 'jira.test')?.id).toBe('j');
    expect(agentOfSite([{ ...jira, enabled: false }, second], 'jira.test')?.id).toBe('s');
    expect(agentOfSite([jira], 'mail.test')).toBeUndefined();
  });
});

describe('an agent is held to its sites', () => {
  const ctx = { settings: TOOL_SETTINGS, tabId: 1, signal: new AbortController().signal };
  const tool = (change: Partial<Tool> = {}): Tool => ({ name: 'browser.find', description: '', inputSchema: {}, source: 'browser', effect: 'read', run: async () => ({ type: 'text', text: '' }), ...change });
  const deps = (tabUrl: string): PolicyDeps => ({
    getPolicy: async () => 'ask',
    setPolicy: async () => {},
    tabUrl: async () => tabUrl,
    confirm: vi.fn(async () => ({ decision: 'allow' as const })),
    agent: { name: 'jira', allows: (host) => host === 'jira.test' },
  });
  it('reads only on its sites', async () => {
    expect(await authorize(deps('https://jira.test/browse/INC-1'), tool(), {}, ctx)).toEqual({});
    expect(await authorize(deps('https://mail.test/'), tool(), {}, ctx)).toEqual({ refused: 'the agent "jira" may not use mail.test: the user has not given it that site' });
  });
  it('reaches a URL only on its sites, writes there by its policy', async () => {
    const http = tool({ source: 'custom', effect: 'write', describe: async () => ({ summary: 'POST', url: 'https://api.other.test/x' }) });
    expect((await authorize(deps('https://jira.test/'), http, {}, ctx)).refused).toContain('api.other.test');
    const d = deps('https://jira.test/');
    expect(await authorize(d, tool({ effect: 'write' }), {}, ctx)).toEqual({ approvedHost: 'jira.test' });
    expect(d.confirm).toHaveBeenCalledOnce();
  });
  it('uses anywhere the tools that touch no site, those confirmed every time, and an MCP server\'s', async () => {
    const away = deps('https://mail.test/');
    for (const t of [tool({ source: 'history' }), tool({ source: 'skill' }), tool({ source: 'user' }), tool({ source: 'custom', effect: 'write', alwaysAsk: true }), tool({ source: 'mcp', policyHost: 'mcp:notes' })]) {
      expect((await authorize(away, t, {}, ctx)).refused).toBeUndefined();
    }
  });
  it('searches the web from any page (the engine is the user\'s), but reads a result only on its sites', async () => {
    const web = (name: string) => webTools().find((t) => t.name === name)!;
    for (const page of ['https://mail.test/', 'chrome://extensions/']) {
      expect((await authorize(deps(page), web('web.search'), { query: 'platypus' }, ctx)).refused).toBeUndefined();
      expect((await authorize(deps(page), web('web.read'), { url: 'https://mail.test/x' }, ctx)).refused).toContain('mail.test');
    }
  });
  it('leaves Default as it was: reads anywhere', async () => {
    const { agent: _agent, ...defaultDeps } = deps('https://mail.test/');
    expect(await authorize(defaultDeps, tool(), {}, ctx)).toEqual({});
  });
});

describe('the skills tools', () => {
  const load = skillTools().find((t) => t.name === 'skills.load')!;
  const signal = new AbortController().signal;
  it('load only the agent\'s skills', async () => {
    await expect(load.run({ name: 'fill-form' }, { settings: TOOL_SETTINGS, signal, skills: ['fill-form'] })).resolves.toMatchObject({ type: 'text' });
    await expect(load.run({ name: 'summarize-page' }, { settings: TOOL_SETTINGS, signal })).resolves.toMatchObject({ type: 'text' });
  });
  it('say why a skill cannot be loaded', async () => {
    await expect(load.run({ name: 'summarize-page' }, { settings: TOOL_SETTINGS, signal, skills: ['fill-form'] }))
      .rejects.toThrow('The skill "summarize-page" is not among this agent\'s skills: the user can give it in Settings → Agents. Your skills: fill-form.');
    await expect(load.run({ name: 'nope' }, { settings: TOOL_SETTINGS, signal })).rejects.toThrow('No skill is named "nope".');
  });
});
