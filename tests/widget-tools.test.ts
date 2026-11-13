import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stripMarks } from '../src/core/model-texts';
import { AccessRequiredError, type Tool, type ToolResult } from '../src/core/types';
import { fakeBrowser, fakeSecretDb, fakeStorage } from './fakes/browser';
import { TOOL_SETTINGS } from './helpers';

const storage = fakeStorage();
const secrets = fakeSecretDb(); // what the agents may reach (agents/profiles)
vi.mock('../src/storage/secret-db', () => secrets);
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));

const { actionTools } = await import('../src/widget/tools');
const { actionStore } = await import('../src/widget/store');
const { agentStore } = await import('../src/agents/profiles');

const reader = (result: ToolResult | (() => never), change: Partial<Tool> = {}): Tool => ({
  name: 'wiki.search',
  description: '',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  source: 'custom',
  effect: 'read',
  run: vi.fn(async (): Promise<ToolResult> => (typeof result === 'function' ? result() : result)),
  ...change,
});
const found = reader({ type: 'text', text: 'for the model', data: [{ title: 'Platypus', pageid: 1 }] });
const ctx = { settings: TOOL_SETTINGS, tabId: 1, signal: new AbortController().signal };
const save = (tools: Tool[]) => actionTools(async () => tools)[0]!;
const args = {
  name: 'Search Wikipedia',
  where: ['https://*.wikipedia.org/*'],
  input: 'selection',
  tool: 'wiki.search',
  args: { query: '{input}' },
  outputs: [{ label: 'Articles', from: '[]', text: '{title}', link: 'https://en.wikipedia.org/wiki/{title}' }],
  sample: 'platypus',
};

beforeEach(() => {
  storage.reset();
});

describe('actions.save', () => {
  it('saves steps, a badge and when, without trying them; refuses a step tool that writes', async () => {
    const writer = reader({ type: 'text', text: '' }, { name: 'web.show_user', effect: 'write' });
    const tool = save([found, writer]);
    const stepped = {
      name: 'Count', where: args.where, input: 'none', when: 'load', badge: 'hits.total',
      steps: [{ name: 'hits', tool: 'wiki.search', args: { query: 'x' } }], outputs: [{ label: 'Hits', from: 'hits' }],
    };
    const card = await tool.describe!(stepped, ctx);
    expect(card.details!.find((d) => d.label === 'Badge')?.value).toBe('hits.total');
    expect(found.run).not.toHaveBeenCalled();
    await tool.run(stepped, ctx);
    const [saved] = await actionStore.load();
    expect(saved).toMatchObject({ when: 'load', badge: 'hits.total', steps: stepped.steps, tool: '' });
    const refused = await tool.run({ ...stepped, name: 'Open', when: 'click', steps: [{ name: 'o', tool: 'web.show_user', args: { url: 'https://example.com' } }] }, ctx).catch((e: Error) => e.message);
    expect(String(JSON.stringify(refused))).toContain('changes things');
  });

  it('always asks, showing the action and its trial as the widget would', async () => {
    const tool = save([found]);
    expect(tool.alwaysAsk).toBe(true);
    const { summary, details } = await tool.describe!(args, ctx);
    expect(summary).toBe('Save the page widget action "Search Wikipedia"');
    expect(details!.find((d) => d.label === 'Tried with "platypus"')?.value).toBe('Articles:\n• Platypus → https://en.wikipedia.org/wiki/Platypus');
    expect(found.run).toHaveBeenCalledWith({ query: 'platypus' }, ctx);
  });

  it('saves it switched on, marked as the model\'s; the same name updates it', async () => {
    const tool = save([found]);
    expect(await tool.run(args, ctx)).toEqual({ type: 'text', text: 'Saved the page widget action "Search Wikipedia". It shows up on matching pages once they are reloaded.' });
    const [first] = await actionStore.load();
    expect(first).toMatchObject({ name: 'Search Wikipedia', enabled: true, input: 'selection', createdBy: 'model', args: { query: '{input}' } });
    await actionStore.save({ ...first!, enabled: false, placeholder: 'a word', icon: '🔎' });
    await tool.run({ ...args, where: ['https://es.wikipedia.org/*'] }, ctx);
    const after = await actionStore.load();
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: first!.id, enabled: false, placeholder: 'a word', icon: '🔎', where: ['https://es.wikipedia.org/*'] });
  });

  it('an update keeps what the call cannot set, and the user\'s action stays the user\'s', async () => {
    const tool = save([found]);
    const reads = { owner: '{{meta:author}}' };
    await actionStore.save({ id: 'mine', enabled: true, name: 'Owner', where: args.where, input: 'none', tool: 'wiki.search', args: { query: '{owner}' }, outputs: [{ label: 'Articles' }], when: 'load', reads });
    const result = await tool.run({ name: 'Owner', where: ['https://es.wikipedia.org/*'], input: 'none', tool: 'wiki.search', args: { query: '{owner}' }, outputs: [{ label: 'Pages' }] }, ctx);
    expect(result).not.toHaveProperty('isError');
    const [after] = await actionStore.load();
    expect(after).toMatchObject({ id: 'mine', when: 'load', reads, where: ['https://es.wikipedia.org/*'], outputs: [{ label: 'Pages' }] });
    expect(after!.createdBy).toBeUndefined();
  });

  it('an update takes only what changes, and the card shows it', async () => {
    const tool = save([found]);
    await tool.run(args, ctx);
    const card = await tool.describe!({ name: 'Search Wikipedia', where: ['https://es.wikipedia.org/*'], sample: 'platypus' }, ctx);
    expect(card.summary).toBe('Update the page widget action "Search Wikipedia"');
    expect(card.details!.find((d) => d.label === 'Shows up on')).toMatchObject({ value: '− https://*.wikipedia.org/*\n+ https://es.wikipedia.org/*', diff: true });
    expect(card.details!.find((d) => d.label === 'Box "Articles"')?.value).toBe('Unchanged');
    expect(card.details!.find((d) => d.label === 'Tried with "platypus"')?.value).toBe('Articles:\n• Platypus → https://en.wikipedia.org/wiki/Platypus');
    await tool.run({ name: 'Search Wikipedia', prompt: 'Explain: {input}', sample: 'platypus' }, ctx);
    expect((await actionStore.load())[0]).toMatchObject({ where: ['https://*.wikipedia.org/*'], tool: 'wiki.search', input: 'selection', prompt: 'Explain: {input}' });
    await tool.run({ name: 'Search Wikipedia', prompt: '', sample: 'platypus' }, ctx);
    expect((await actionStore.load())[0]!.prompt).toBeUndefined();
  });

  it('refuses before asking what cannot be saved', async () => {
    const writer = reader({ type: 'text', text: '' }, { effect: 'write' });
    await expect(save([writer]).describe!(args, ctx)).rejects.toThrow('an action saved here only reads');
    await expect(save([found]).describe!({ ...args, sample: '' }, ctx)).rejects.toThrow('Give a sample input');
    await expect(save([found]).describe!({ ...args, args: { q: '{input}' } }, ctx)).rejects.toThrow('"wiki.search" has no parameter "q"');
    await expect(save([found]).describe!({ ...args, where: ['wikipedia.org'] }, ctx)).rejects.toThrow('is not a URL pattern');
    await expect(save([found]).describe!({ ...args, where: [] }, ctx)).rejects.toThrow('Say where it shows');
    expect(writer.run).not.toHaveBeenCalled();
  });

  it('gives back the start of the answer, untrusted, when no box finds anything', async () => {
    const error = await save([found]).describe!({ ...args, outputs: [{ label: 'Articles', from: 'query.search[]' }] }, ctx).catch((e: Error) => e.message);
    expect(stripMarks(String(error))).toBe(
      'Not saved: tried with "platypus", no box found anything. The start of the tool\'s answer, to pick the paths from:\n' +
        '<untrusted_tool_answer>\n[\n {\n  "title": "Platypus",\n  "pageid": 1\n }\n]\n</untrusted_tool_answer>',
    );
  });

  it('says when the trial fails, and lets the chat ask for a site the tool may not reach', async () => {
    await expect(save([reader({ type: 'text', text: 'HTTP 500', isError: true })]).describe!(args, ctx)).rejects.toThrow('the tool failed: HTTP 500');
    const blocked = reader(() => { throw new AccessRequiredError({ origin: 'https://en.wikipedia.org/*', site: 'en.wikipedia.org', title: 'x' }, 'no'); });
    await expect(save([blocked]).describe!(args, ctx)).rejects.toBeInstanceOf(AccessRequiredError);
  });
});

describe('actions.save with a prompt and an agent', () => {
  const jira = { id: 'j1', enabled: true, name: 'Jira', description: '', instructions: '', tools: ['wiki.search'], skills: [], templates: [], sites: {}, canAsk: false, canBeAsked: false };
  const prompted = { name: 'Translate', where: ['https://*.example.com/*'], input: 'selection', prompt: 'Translate to Spanish: {input}', outputs: [{ label: 'Spanish' }] };
  it('saves one with only a prompt, untried, the prompt on the card', async () => {
    const tool = save([]);
    const { details } = await tool.describe!(prompted, ctx);
    expect(details!.find((d) => d.label === 'Prompt')?.value).toBe('Translate to Spanish: {input}');
    expect(details!.find((d) => d.label === 'The model')?.value).toBe('It answers when the button is pressed: not tried now.');
    expect(details!.some((d) => d.label.startsWith('Tried'))).toBe(false);
    await tool.run(prompted, ctx);
    expect((await actionStore.load())[0]).toMatchObject({ name: 'Translate', tool: '', prompt: 'Translate to Spanish: {input}', createdBy: 'model' });
  });
  it("tries only the tool of one with a prompt, showing its whole answer; JSON boxes go by key", async () => {
    const both = { ...args, prompt: 'Summarize {input}', outputs: [{ label: 'Summary', from: 'summary' }, { label: 'First', from: 'first' }] };
    const { details } = await save([found]).describe!(both, ctx);
    expect(details!.find((d) => d.label === 'Tried with "platypus"')?.value).toContain("The tool's answer:");
    expect(details!.find((d) => d.label === 'Box "Summary"')?.value).toBe('key: summary');
  });
  it('belongs to an agent by name, which must have its tool', async () => {
    await agentStore.save(jira);
    const { details } = await save([found]).describe!({ ...args, agent: 'jira' }, ctx);
    expect(details!.find((d) => d.label === 'Agent')?.value).toBe('Jira');
    await save([found]).run({ ...args, agent: 'jira' }, ctx);
    expect((await actionStore.load())[0]).toMatchObject({ agent: 'j1' });
    await expect(save([found]).describe!({ ...args, agent: 'Mail' }, ctx)).rejects.toThrow('No agent named "Mail"');
    await agentStore.save({ ...jira, tools: [] });
    await expect(save([found]).describe!({ ...args, agent: 'Jira' }, ctx)).rejects.toThrow('"wiki.search" is not among the tools of the agent "Jira".');
  });

  it('an update keeps its agent unless the call names one; "Browser" (or "Default") moves it to Browser', async () => {
    const research = { ...jira, id: 'r1', name: 'Research', icon: '🔎' };
    await agentStore.saveMany([jira, research]);
    const agentOf = async () => (await actionStore.load())[0]!.agent;
    const agentRow = async (call: object) => (await save([found]).describe!({ ...args, ...call }, ctx)).details!.find((d) => d.label === 'Agent')?.value;
    await save([found]).run({ ...args, agent: 'Jira' }, ctx);
    expect(await agentRow({})).toBe('Jira');
    await save([found]).run(args, ctx);
    expect(await agentOf()).toBe('j1');
    expect(await agentRow({ agent: 'research' })).toBe('− Jira\n+ 🔎 Research');
    expect(await agentRow({ agent: 'Browser' })).toBe('− Jira\n+ Browser');
    expect(await agentRow({ agent: 'Default' })).toBe('− Jira\n+ Browser');
    await save([found]).run({ ...args, agent: 'default' }, ctx);
    expect(await agentOf()).toBeUndefined();
    expect(await agentRow({})).toBeUndefined();
    await expect(save([found]).describe!({ ...args, agent: 'Mail' }, ctx)).rejects.toThrow('No agent named "Mail": Builder, Jira, Research, or Browser.');
  });

  it('keeps the id of an agent no longer there, without checking its tools', async () => {
    await agentStore.save(jira);
    await save([found]).run({ ...args, agent: 'Jira' }, ctx);
    await agentStore.remove(jira.id);
    const { details } = await save([found]).describe!(args, ctx);
    expect(details!.find((d) => d.label === 'Agent')?.value).toBe('an agent no longer there');
    await save([found]).run(args, ctx);
    expect((await actionStore.load())[0]).toMatchObject({ agent: 'j1' });
  });
});
