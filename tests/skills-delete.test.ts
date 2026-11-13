import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tool, ToolContext } from '../src/core/types';
import type { Skill } from '../src/skills/types';
import { fakeBrowser, fakeStorage } from './fakes/browser';

const storage = fakeStorage();
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));
const { skillStore } = await import('../src/skills/store');
const { skillTools } = await import('../src/skills/tools');

const del = skillTools().find((t) => t.name === 'skills.delete') as Tool & Required<Pick<Tool, 'describe'>>;
const ctx = (over: Partial<ToolContext> = {}) => ({ signal: new AbortController().signal, ...over }) as ToolContext;
const skill = (over: Partial<Skill>): Skill => ({ id: `id-${over.name}`, name: 'x', description: 'Does x.', matches: [], body: 'Do x.', references: [], enabled: true, ...over });
const names = async () => (await skillStore.load()).filter((s) => !s.builtin).map((s) => s.name);

beforeEach(async () => {
  storage.reset();
  await skillStore.save(skill({ name: 'pr-review', matches: ['*://example.com/*/pull/*'], body: 'Read the diff.' }));
  await skillStore.save(skill({ name: 'notes', enabled: false }));
});

describe('skills.delete', () => {
  it('always asks, with a card showing the whole skill', async () => {
    expect(del).toMatchObject({ effect: 'write', alwaysAsk: true });
    expect(await del.describe({ name: 'pr-review' }, ctx())).toEqual({
      summary: 'Delete the site skill "pr-review"',
      details: [
        { label: 'Websites', value: '*://example.com/*/pull/*' },
        { label: 'Description', value: 'Does x.' },
        { label: 'Instructions', value: 'Read the diff.', code: true },
      ],
    });
    expect((await del.describe({ name: 'notes' }, ctx())).summary).toBe('Delete the general skill "notes"');
  });

  it('deletes the skill, switched off or on', async () => {
    expect(await del.run({ name: 'notes' }, ctx())).toEqual({ type: 'text', text: 'Deleted the skill "notes".' });
    expect(await names()).toEqual(['pr-review']);
  });

  it('refuses built-in skills, saying why', async () => {
    const builtin = (await skillStore.load()).find((s) => s.builtin)!;
    await expect(del.describe({ name: builtin.name }, ctx())).rejects.toThrow(`"${builtin.name}" is a built-in skill and cannot be deleted`);
    await expect(del.run({ name: builtin.name }, ctx())).rejects.toThrow('is a built-in skill');
    expect((await skillStore.load()).some((s) => s.name === builtin.name)).toBe(true);
  });

  it('refuses an unknown name, listing those it can delete', async () => {
    await expect(del.describe({ name: 'ghost' }, ctx())).rejects.toThrow('No skill named "ghost" to delete. Skills you can delete: pr-review, notes.');
    await expect(del.run({ name: 'ghost' }, ctx())).rejects.toThrow('No skill named "ghost"');
    expect(await names()).toEqual(['pr-review', 'notes']);
  });

  it("lets an agent delete only the skills it was given", async () => {
    const agent = ctx({ skills: ['notes'] });
    await expect(del.describe({ name: 'pr-review' }, agent)).rejects.toThrow('Skills you can delete: notes.');
    await expect(del.run({ name: 'pr-review' }, agent)).rejects.toThrow('Skills you can delete: notes.');
    await expect(del.describe({ name: 'notes' }, ctx({ skills: [] }))).rejects.toThrow('Skills you can delete: none.');
    expect(await del.run({ name: 'notes' }, agent)).toMatchObject({ text: 'Deleted the skill "notes".' });
    expect(await names()).toEqual(['pr-review']);
  });
});

describe('skills.save by an agent', () => {
  const save = skillTools().find((t) => t.name === 'skills.save') as Tool & Required<Pick<Tool, 'describe'>>;
  const args = { name: 'pr-review', description: 'Reviews.', instructions: 'Something else.' };

  it("cannot overwrite a skill it was not given; Builder and Default can", async () => {
    await expect(save.describe(args, ctx({ skills: ['notes'] }))).rejects.toThrow('"pr-review" is a skill this agent was not given');
    expect(await save.run(args, ctx({ skills: ['notes'] }))).toMatchObject({ isError: true });
    expect((await skillStore.load()).find((s) => s.name === 'pr-review')?.body).toBe('Read the diff.');
    expect((await save.describe(args, ctx({ skills: ['pr-review'] }))).summary).toBe('Update the site skill "pr-review"');
    expect((await save.describe(args, ctx())).summary).toBe('Update the site skill "pr-review"');
    expect((await save.describe(args, ctx({ skills: [], agentId: 'builder' }))).summary).toBe('Update the site skill "pr-review"');
    expect((await save.describe({ ...args, name: 'new-one' }, ctx({ skills: [] }))).summary).toBe('Save the general skill "new-one"');
  });
});
