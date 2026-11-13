import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../src/core/types';
import { argsWithEdits, nameArg, reviewedSaveTool, withEditFields, type EditField } from '../src/tools/reviewed-save';
import { fields } from '../src/tools/define';

const ctx = { signal: new AbortController().signal } as ToolContext;

describe('withEditFields', () => {
  it('puts each field on the detail it goes with, and one without a detail in a row first, shown only while editing', () => {
    const card = { summary: 'Save', details: [{ label: 'Description', value: 'Old' }, { label: 'View', key: 'view:a', value: 'x', code: true }] };
    const editable: EditField[] = [
      { field: 'description', label: 'Description', value: 'Old' },
      { field: 'urlPatterns', label: 'Websites', value: '', lines: 'list' },
    ];
    expect(withEditFields(card, editable).details).toEqual([
      { label: 'Websites', value: '', editOnly: true, edit: { field: 'urlPatterns', value: '', lines: 'list' } },
      { label: 'Description', value: 'Old', edit: { field: 'description', value: 'Old' } },
      { label: 'View', key: 'view:a', value: 'x', code: true },
    ]);
  });
});

describe('argsWithEdits', () => {
  const editable: EditField[] = [
    { field: 'description', label: 'Description', value: '' },
    { field: 'urlPatterns', label: 'Websites', value: '', lines: 'list' },
    { field: 'script.code', label: 'Script', value: '', lines: 'text', replacesEdits: true },
  ];

  it('sets each path on a copy, a list by its lines, and drops the partial edits a field replaces', () => {
    const args = { name: 'a', script: { code: 'old', timeout: 5 }, edits: [{ old: 'o', new: 'n' }] };
    const out = argsWithEdits(args, { description: 'New', urlPatterns: ' *://a.test/*\n\n*://b.test/* ', 'script.code': 'new' }, editable);
    expect(out).toEqual({ name: 'a', description: 'New', urlPatterns: ['*://a.test/*', '*://b.test/*'], script: { code: 'new', timeout: 5 } });
    expect(args.script.code).toBe('old');
    expect(args.edits).toHaveLength(1);
  });

  it('leaves out any value that is not of an editable field, and an emptied list is an empty one', () => {
    expect(argsWithEdits({ name: 'a' }, { name: 'b', urlPatterns: '' }, editable)).toEqual({ name: 'a', urlPatterns: [] });
  });
});

describe('reviewedSaveTool with edit fields', () => {
  const saved = ['taken'];
  type Draft = { name: string; description: string; existing: boolean; problems: string[] };
  const tool = reviewedSaveTool({ name: 'things.save', description: '', inputSchema: { type: 'object' }, source: 'skill' }, {
    draft: async (args): Promise<Draft> => {
      const name = nameArg(args);
      const description = String(fields(args).description ?? '');
      return { name, description, existing: saved.includes(name), problems: description ? [] : ['Give a description.'] };
    },
    review: (d) => ({ summary: `Save "${d.name}"`, details: [{ label: 'Description', value: d.description }] }),
    save: async (d) => `Saved ${d.name}.`,
    edit: { name: { kind: 'thing', of: (d) => d.name }, isUpdate: (d) => d.existing, fields: (d) => [{ field: 'description', label: 'Description', value: d.description }] },
  });

  it("offers a new item's name, not an update's", async () => {
    expect((await tool.describe!({ name: 'new', description: 'D' }, ctx)).details).toEqual([
      { label: 'Name', value: '', editOnly: true, edit: { field: 'name', value: 'new' } },
      { label: 'Description', value: 'D', edit: { field: 'description', value: 'D' } },
    ]);
    expect((await tool.describe!({ name: 'taken', description: 'D' }, ctx)).details?.map((d) => d.label)).toEqual(['Description']);
  });

  it('gives the edited arguments, or throws what keeps them from being saved', async () => {
    expect(await tool.withEdits!({ name: 'new', description: 'D' }, { description: 'E', name: 'newer' }, ctx)).toEqual({ name: 'newer', description: 'E' });
    await expect(tool.withEdits!({ name: 'new', description: 'D' }, { description: '' }, ctx)).rejects.toThrow('Not saved:\n- Give a description.');
    await expect(tool.withEdits!({ name: 'new', description: 'D' }, { name: 'taken' }, ctx)).rejects.toThrow('A thing named "taken" already exists: choose another name.');
  });
});
