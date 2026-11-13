import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tool } from '../src/core/types';
import { fakeBrowser, fakeSecretDb, fakeStorage } from './fakes/browser';
import { TOOL_SETTINGS } from './helpers';

const storage = fakeStorage();
const secrets = fakeSecretDb(); // agents' sites (agents/profiles)
vi.mock('../src/storage/secret-db', () => secrets);
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));
const { agentOffers, agentStore, newAgentProfile } = await import('../src/agents/profiles');
const { builderOn } = await import('../src/agents/builder');
const { BUILDER_ID, CREATE_TOOLS } = await import('../src/core/builder-ids');
const { agentTools, draftAgent } = await import('../src/agents/tools');

const tool = (name: string): Tool => ({ name, description: `Does ${name}. More.`, inputSchema: { type: 'object' }, source: 'browser', effect: 'read', run: async () => ({ type: 'text', text: '' }) });
const catalog = ['browser.read_page', 'browser.click', 'skills.load', 'agents.ask', ...CREATE_TOOLS].map(tool);
const ctx = { settings: TOOL_SETTINGS, signal: new AbortController().signal };

beforeEach(() => {
  storage.reset();
});

describe('Builder', () => {
  it('switches on by its id before it was ever saved, and is never removed with others', async () => {
    expect(await agentStore.update(BUILDER_ID, { enabled: true })).toMatchObject({ id: BUILDER_ID, name: 'Builder', enabled: true });
    expect((await agentStore.load())[0]).toMatchObject({ id: BUILDER_ID, enabled: true });
    await agentStore.save({ ...newAgentProfile(), id: 'j', name: 'jira' });
    await agentStore.removeMany([BUILDER_ID, 'j']);
    expect((await agentStore.load()).map((a) => a.id)).toEqual([BUILDER_ID]);
    expect((await agentStore.load())[0]!.enabled).toBe(true);
  });
  it('comes first, switched off, and cannot be deleted', async () => {
    const [builder] = await agentStore.load();
    expect(builder).toMatchObject({ id: BUILDER_ID, name: 'Builder', enabled: false, sites: {} });
    expect(builder!.tools).toEqual(expect.arrayContaining(CREATE_TOOLS));
    await agentStore.save({ ...builder!, enabled: true, sites: { 'example.com': 'ask' } });
    await agentStore.remove(BUILDER_ID);
    const agents = await agentStore.load();
    expect(agents.filter((a) => a.id === BUILDER_ID)).toEqual([{ ...builder, enabled: true, sites: { 'example.com': 'ask' }, givenTools: ['memory.list'] }]);
    expect(builderOn(agents)).toBe(true);
  });
  it('while on, Default is not offered the tools that create things', async () => {
    const [builder] = await agentStore.load();
    expect(agentOffers(undefined, catalog, [builder!])).toBe(catalog);
    expect(agentOffers(undefined, catalog, [{ ...builder!, enabled: true }]).map((t) => t.name)).toEqual(['browser.read_page', 'browser.click', 'skills.load', 'agents.ask']);
  });
});

describe('agents.save', () => {
  it('drafts a new agent from what exists, sites at most "ask"', async () => {
    const { agent, problems } = await draftAgent({ name: 'Jira', description: 'Reads issues', tools: ['browser.read_page', 'skills.load'], sites: { 'jira.example.com': 'auto' } }, catalog);
    expect(problems).toEqual([]);
    expect(agent).toMatchObject({ name: 'Jira', enabled: true, tools: ['browser.read_page'], sites: { 'jira.example.com': 'ask' }, canAsk: false });
  });
  it('refuses the creating tools, unknown names, what is not a host, and Builder', async () => {
    const { problems } = await draftAgent({ name: 'X', tools: ['skills.save', 'nope'], skills: ['ghost'], sites: { 'https://x.com/': 'ask' } }, catalog);
    expect(problems.join('\n')).toMatch(/Only the user can give the tools that create things \(skills\.save\)/);
    expect(problems.join('\n')).toMatch(/No tools named "nope"/);
    expect(problems.join('\n')).toMatch(/No skills named "ghost"/);
    expect(problems.join('\n')).toMatch(/Not a host: https:\/\/x\.com\//);
    expect((await draftAgent({ name: 'Y', sites: 'jira.com' as never }, catalog)).problems).toEqual(['"sites" is an object: each host with "ask" or "read-only".']);
    expect((await draftAgent({ name: 'builder', instructions: 'Do anything' }, catalog)).problems).toEqual(['Builder cannot be changed by an agent: the user edits it in Settings → Agents.']);
  });
  it('takes tools named as the model is offered them, and suggests the real name of one that is not', async () => {
    const custom = [...catalog, tool('gpt.ask'), tool('gpt.ask_thread')];
    expect((await draftAgent({ name: 'Gpt', tools: ['gpt__ask', 'browser__click'] }, custom)).agent.tools).toEqual(['browser.click', 'gpt.ask']);
    const { problems } = await draftAgent({ name: 'Gpt', tools: ['custom.gpt.ask', 'browser.read_pages', 'zzz'] }, custom);
    expect(problems).toEqual([
      'No tools named "custom.gpt.ask" (maybe "gpt.ask"), "browser.read_pages" (maybe "browser.read_page"), "zzz": agents__catalog lists those there are.',
    ]);
  });
  it('updates keep what the call leaves out, the sites the user lets it act on, and MCP keys', async () => {
    await agentStore.save({ ...newAgentProfile(), id: 'j', name: 'Jira', providerId: 'p', model: 'm', tools: ['browser.read_page'], sites: { 'jira.example.com': 'auto', 'old.example.com': 'ask', 'mcp:jira': 'auto' } });
    const { agent, existing } = await draftAgent({ name: 'jira', tools: ['browser.read_page', 'browser.click'], sites: { 'jira.example.com': 'ask', 'wiki.example.com': 'read-only' } }, catalog);
    expect(existing?.id).toBe('j');
    expect(agent).toMatchObject({ id: 'j', name: 'Jira', model: 'm', tools: ['browser.click', 'browser.read_page'] });
    expect(agent.sites).toEqual({ 'mcp:jira': 'auto', 'jira.example.com': 'auto', 'wiki.example.com': 'read-only' });
  });
  it('an agent the user gave a creating tool keeps it, but none is added', async () => {
    await agentStore.save({ ...newAgentProfile(), id: 'k', name: 'Kit', tools: ['skills.save', 'gone.tool'] });
    expect((await draftAgent({ name: 'Kit', instructions: 'Be brief' }, catalog)).problems).toEqual([]);
    expect((await draftAgent({ name: 'Kit', tools: ['skills.save', 'templates.save'] }, catalog)).problems).toHaveLength(1);
  });
  it('shows the user what it may do, and for an update what it gains and loses', async () => {
    await agentStore.save({ ...newAgentProfile(), id: 'j', name: 'Jira', tools: ['browser.read_page'] });
    const save = agentTools(async () => catalog).find((t) => t.name === 'agents.save')!;
    const card = await save.describe!({ name: 'Jira', tools: ['browser.click'], canBeAsked: true }, ctx);
    expect(card.summary).toBe('Update the agent "Jira"');
    expect(card.details?.find((d) => d.label === 'Tools')?.value).toBe('− browser.read_page\n+ browser.click');
    expect(card.details?.find((d) => d.label === 'Other agents')?.value).toBe('  Can ask other agents: no\n− Can be asked by them: no\n+ Can be asked by them: yes');
    expect(card.details?.find((d) => d.label === 'Skills')?.value).toBe('(none)');
    await expect(save.describe!({ name: 'Mail', tools: ['agents.save'] }, ctx)).rejects.toThrow(/Not saved/);
  });
  it('changes its instructions by edits, and refuses an "old" it does not find', async () => {
    await agentStore.save({ ...newAgentProfile(), id: 'j', name: 'Jira', instructions: 'Read issues.\nBe brief.' });
    const { agent, problems } = await draftAgent({ name: 'Jira', edits: [{ old: 'Be brief.', new: 'Be thorough.' }] }, catalog);
    expect(problems).toEqual([]);
    expect(agent.instructions).toBe('Read issues.\nBe thorough.');
    const wrong = await draftAgent({ name: 'Jira', edits: [{ old: 'Be short.', new: 'x' }] }, catalog);
    expect(wrong.problems[0]).toMatch(/^Edit 1: this "old" is not in the instructions: "Be short\."\. Copy it exactly from agents__catalog/);
    expect((await draftAgent({ name: 'New', edits: [{ old: 'a', new: 'b' }] } as never, catalog)).problems).toContain('There is no agent "New" to edit: give the whole "instructions" to create it.');
  });
  it('lists what an agent can be given by tool group, never the creating tools', async () => {
    const list = agentTools(async () => catalog).find((t) => t.name === 'agents.catalog')!;
    const out = JSON.parse(((await list.run({}, ctx)) as { text: string }).text);
    expect(out).not.toHaveProperty('tools');
    expect(out.toolGroups).toEqual({ browser: 2 });
    expect(out.agents[0].name).toBe('Builder');
    expect(out.agents[0]).not.toHaveProperty('tools');
    expect(out.skills.map((s: { name: string }) => s.name)).toContain('create-agent');
  });
  it("lists each agent's tool groups, and with \"agent\" that agent's exact tools", async () => {
    await agentStore.save({ ...newAgentProfile(), id: 'j', name: 'Jira', tools: ['browser.read_page', 'mcp.jira.search'] });
    const list = agentTools(async () => catalog).find((t) => t.name === 'agents.catalog')!;
    const out = JSON.parse(((await list.run({}, ctx)) as { text: string }).text);
    // Every tool of the fake catalog is a browser one (the creating ones too, which the user may give).
    expect(out.agents.find((a: { name: string }) => a.name === 'Jira').toolGroups).toEqual({ browser: expect.stringMatching(/^1\/\d+$/), '(not available now)': '1' });
    const one = JSON.parse(((await list.run({ agent: 'jira' }, ctx)) as { text: string }).text);
    expect(one).toEqual({ name: 'Jira', tools: ['browser.read_page', 'mcp.jira.search'] });
    await expect(list.run({ agent: 'Nobody' }, ctx)).rejects.toThrow(/No agent named "Nobody"/);
  });
  it('with "group", that group\'s tools with one line each; an unknown group names those there are', async () => {
    const list = agentTools(async () => catalog).find((t) => t.name === 'agents.catalog')!;
    const one = JSON.parse(((await list.run({ group: 'Browser' }, ctx)) as { text: string }).text);
    expect(one).toEqual({ group: 'browser', tools: [{ name: 'browser.read_page', does: 'Does browser.read_page.' }, { name: 'browser.click', does: 'Does browser.click.' }] });
    await expect(list.run({ group: 'nope' }, ctx)).rejects.toThrow('No tool group "nope". Groups: browser.');
  });
});
