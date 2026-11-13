import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tool, ToolContext } from '../src/core/types';
import type { Skill } from '../src/skills/types';
import { fakeBrowser, fakeStorage } from './fakes/browser';

const storage = fakeStorage();
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));
const { skillStore } = await import('../src/skills/store');
const { skillTools } = await import('../src/skills/tools');

// skills.save's card lets the user edit the skill; what they edit is saved instead.
const save = skillTools().find((t) => t.name === 'skills.save') as Tool & Required<Pick<Tool, 'describe' | 'withEdits'>>;
const ctx = { signal: new AbortController().signal } as ToolContext;
const skill = (over: Partial<Skill>): Skill => ({ id: `id-${over.name}`, name: 'x', description: 'Does x.', matches: [], body: 'Do x.', references: [], enabled: true, ...over });
const saved = async (name: string) => (await skillStore.load()).find((s) => s.name === name);

beforeEach(async () => {
  storage.reset();
  await skillStore.save(skill({ name: 'notes', body: '1. Open.\n2. Write.' }));
});

describe('editing skills.save on its card', () => {
  it("offers an update's instructions whole, its partial edits applied, and not its name", async () => {
    const card = await save.describe({ name: 'notes', edits: [{ old: 'Write.', new: 'Write it all.' }] }, ctx);
    const edits = card.details?.filter((d) => d.edit).map((d) => [d.label, d.edit]);
    expect(edits).toEqual([
      ['Websites', { field: 'urlPatterns', value: '', lines: 'list' }],
      ['Description', { field: 'description', value: 'Does x.' }],
      ['Instructions', { field: 'instructions', value: '1. Open.\n2. Write it all.', lines: 'text' }],
    ]);
  });

  it('saves the edited instructions instead of the partial edits', async () => {
    const args = await save.withEdits({ name: 'notes', edits: [{ old: 'Write.', new: 'Write it all.' }] }, { instructions: '1. Open.\n2. Write less.' }, ctx);
    expect(args).toEqual({ name: 'notes', instructions: '1. Open.\n2. Write less.' });
    await save.run(args, ctx);
    expect((await saved('notes'))?.body).toBe('1. Open.\n2. Write less.');
  });

  it("refuses a new skill's name that is taken, and one that is not a name", async () => {
    const args = { name: 'drafts', description: 'Drafts.', instructions: 'Draft.' };
    await expect(save.withEdits(args, { name: 'notes' }, ctx)).rejects.toThrow('A skill named "notes" already exists: choose another name.');
    await expect(save.withEdits(args, { name: 'Not A Name' }, ctx)).rejects.toThrow('Not saved:');
    expect(await save.withEdits(args, { name: 'my-drafts' }, ctx)).toEqual({ ...args, name: 'my-drafts' });
  });
});

describe('skills.read_reference', () => {
  const read = skillTools().find((t) => t.name === 'skills.read_reference')!;
  it('lists the reference files there are for a path the skill does not have', async () => {
    await skillStore.save(skill({ name: 'scripts', references: [{ path: 'references/shape.md', content: 'Shape.' }, { path: 'references/steps.md', content: 'Steps.' }] }));
    await expect(read.run({ name: 'scripts', path: 'references/03-shape.md' }, ctx)).rejects.toThrow(
      'Skill "scripts" has no reference file "references/03-shape.md". Its reference files: "references/shape.md", "references/steps.md".',
    );
    await expect(read.run({ name: 'notes', path: 'a.md' }, ctx)).rejects.toThrow('Its reference files: none.');
  });
});
