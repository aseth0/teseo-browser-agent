import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tool, ToolContext } from '../src/core/types';
import { fakeBrowser, fakeSecretDb, fakeStorage } from './fakes/browser';

// An update by the model keeps what its call does not set: whether the item is on, who made it, and
// what only Settings changes.
const storage = fakeStorage();
const secrets = fakeSecretDb(); // what custom tools keep apart (tools/custom/store)
vi.mock('../src/storage/secret-db', () => secrets);
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));
const { skillStore } = await import('../src/skills/store');
const { skillTools } = await import('../src/skills/tools');
const { templateStore } = await import('../src/templates/store');
const { templateTools } = await import('../src/templates/tools');
const { customToolStore } = await import('../src/tools/custom/store');
const { manageCustomTools } = await import('../src/tools/custom/manage');

const ctx = { signal: new AbortController().signal } as ToolContext;
const named = (tools: Tool[], name: string) => tools.find((t) => t.name === name)!;
const search: Tool = {
  name: 'web.search',
  description: 'Searches the web.',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  source: 'web',
  effect: 'read',
  run: async () => ({ type: 'text', text: '' }),
};

beforeEach(() => {
  storage.reset();
  secrets.data.clear();
});

describe('an update by the model', () => {
  it('skills.save keeps the skill off, and the user\'s', async () => {
    await skillStore.save({ id: 'mine', name: 'notes', description: 'Takes notes.', matches: [], body: 'Write.', references: [], enabled: false });
    const result = await named(skillTools(), 'skills.save').run({ name: 'notes', description: 'Takes notes well.', instructions: 'Write more.' }, ctx);
    expect(result).not.toHaveProperty('isError');
    const saved = (await skillStore.load()).find((s) => s.name === 'notes')!;
    expect(saved).toMatchObject({ id: 'mine', enabled: false, body: 'Write more.' });
    expect(saved.createdBy).toBeUndefined();
  });

  it('templates.save keeps web.read, the template off, and the user\'s', async () => {
    const views = [{ name: 'main', paths: ['*'], replacePage: false, body: 'Title: {{ page | one: "h1" }}' }];
    await templateStore.save({ id: 'mine', name: 'shop', description: 'Products.', matches: ['*://shop.example.com/*'], views, enabled: false, webRead: true });
    const args = { name: 'shop', urlPatterns: ['*://shop.example.com/*'], views: [{ name: 'main', paths: ['*'], template: 'Product: {{ page | one: "h1" }}' }] };
    const result = await named(templateTools(), 'templates.save').run(args, ctx);
    expect(result).not.toHaveProperty('isError');
    const saved = (await templateStore.load()).find((t) => t.name === 'shop')!;
    expect(saved).toMatchObject({ id: 'mine', enabled: false, webRead: true, description: 'Products.', views: [{ body: 'Product: {{ page | one: "h1" }}' }] });
    expect(saved.createdBy).toBeUndefined();
  });

  it('custom_tools.save keeps the tool off, and the user\'s; a new one is the model\'s', async () => {
    const tool = named(manageCustomTools(async () => [search]), 'custom_tools.save');
    await customToolStore.save({ id: 'mine', enabled: false, name: 'reddit.search', description: 'Searches Reddit.', base: 'web.search', params: {} });
    expect(await tool.run({ name: 'reddit.search', description: 'Searches Reddit posts.', base: 'web.search' }, ctx)).not.toHaveProperty('isError');
    expect(await tool.run({ name: 'news.search', description: 'Searches news.', base: 'web.search' }, ctx)).not.toHaveProperty('isError');
    const [mine, theirs] = await customToolStore.load();
    expect(mine).toMatchObject({ id: 'mine', enabled: false, description: 'Searches Reddit posts.' });
    expect(mine!.createdBy).toBeUndefined();
    expect(theirs).toMatchObject({ name: 'news.search', enabled: true, createdBy: 'model' });
  });

  it('skills.save takes only what changes: its instructions by edits, the rest kept', async () => {
    await skillStore.save({ id: 'mine', name: 'notes', description: 'Takes notes.', matches: ['*://a.example.com/*'], body: '1. Open.\n2. Write.\n3. Save.', references: [], enabled: true });
    const save = named(skillTools(), 'skills.save');
    const call = { name: 'notes', edits: [{ old: '2. Write.', new: '2. Write it all.' }] };
    const card = await save.describe!(call, ctx);
    expect(card.summary).toBe('Update the site skill "notes"');
    expect(card.details).toContainEqual(expect.objectContaining({ label: 'Instructions', value: '  1. Open.\n− 2. Write.\n+ 2. Write it all.\n  3. Save.', diff: true, code: true }));
    expect(card.details).toContainEqual(expect.objectContaining({ label: 'Description', value: 'Takes notes.' }));
    expect(await save.run(call, ctx)).not.toHaveProperty('isError');
    const notes = async () => (await skillStore.load()).find((x) => x.name === 'notes')!;
    expect(await notes()).toMatchObject({ description: 'Takes notes.', matches: ['*://a.example.com/*'], body: '1. Open.\n2. Write it all.\n3. Save.' });
    expect(await save.run({ name: 'notes', urlPatterns: [] }, ctx)).not.toHaveProperty('isError');
    expect((await notes()).matches).toEqual([]);
  });

  it('skills.save refuses edits it cannot place, saying why, and edits of a skill not there', async () => {
    await skillStore.save({ id: 'mine', name: 'notes', description: 'Takes notes.', matches: [], body: 'Write.\nWrite.', references: [], enabled: true });
    const save = named(skillTools(), 'skills.save');
    const twice = await save.run({ name: 'notes', edits: [{ old: 'Write.', new: 'Read.' }] }, ctx);
    expect(twice).toMatchObject({ isError: true, text: expect.stringContaining('Edit 1: this "old" appears 2 times in the instructions') });
    const both = await save.run({ name: 'notes', instructions: 'All.', edits: [{ old: 'Write.', new: 'Read.' }] }, ctx);
    expect(both).toMatchObject({ isError: true, text: expect.stringContaining('Give either "instructions" or "edits", not both.') });
    const none = await save.run({ name: 'other', description: 'x', edits: [{ old: 'a', new: 'b' }] }, ctx);
    expect(none).toMatchObject({ isError: true, text: expect.stringContaining('There is no skill "other" to edit: give the whole "instructions" to create it.') });
    expect((await skillStore.load()).find((x) => x.name === 'notes')!.body).toBe('Write.\nWrite.');
    expect((await skillStore.load()).some((x) => x.name === 'other')).toBe(false);
  });

  it('custom_tools.edit changes a script\'s code by edits, the card showing what changes', async () => {
    const tools = manageCustomTools(async () => [search]);
    await customToolStore.save({ id: 's', enabled: true, name: 'team.list', description: 'Lists teams.', base: 'script', params: {}, script: 'const a = 1;\nreturn a;', http: { method: 'GET', url: 'https://api.example.com' } });
    const edit = named(tools, 'custom_tools.edit');
    const call = { name: 'team.list', edits: [{ old: 'const a = 1;', new: 'const a = 2;' }] };
    const card = await edit.describe!(call, ctx);
    expect(card.details).toContainEqual(expect.objectContaining({ label: 'Script (all of it)', value: '− const a = 1;\n+ const a = 2;\n  return a;', diff: true, code: true }));
    expect(await edit.run(call, ctx)).not.toHaveProperty('isError');
    expect((await customToolStore.load())[0]!.script).toBe('const a = 2;\nreturn a;');
    const missing = await edit.run({ name: 'team.list', edits: [{ old: 'const b', new: '' }] }, ctx);
    expect(missing).toMatchObject({ isError: true, text: expect.stringContaining('Edit 1: this "old" is not in the script\'s code: "const b". Copy it exactly from custom_tools__read') });
  });
});
