import { describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '../src/core/types';
import { listArg, nameArg, reviewedDeleteTool } from '../src/tools/reviewed-save';

const ctx = { signal: new AbortController().signal } as ToolContext;

describe('reviewedDeleteTool', () => {
  const items = [{ id: '1', name: 'a' }];
  const remove = vi.fn(async (item: { name: string }) => `Deleted ${item.name}.`);
  const tool = reviewedDeleteTool({ name: 'things.delete', description: 'Deletes a thing.', inputSchema: { type: 'object' }, source: 'skill' }, {
    find: async (args) => {
      const item = items.find((i) => i.name === nameArg(args));
      if (!item) throw new Error(`No thing "${nameArg(args)}".`);
      return item;
    },
    review: (item) => ({ summary: `Delete "${item.name}"` }),
    remove,
  });

  it('always asks, with the card of the item it names', async () => {
    expect(tool).toMatchObject({ name: 'things.delete', effect: 'write', alwaysAsk: true, source: 'skill' });
    expect(await tool.describe!({ name: ' a ' }, ctx)).toEqual({ summary: 'Delete "a"' });
    await expect(tool.describe!({ name: 'b' }, ctx)).rejects.toThrow('No thing "b".');
    expect(remove).not.toHaveBeenCalled();
  });

  it('looks it up again to delete it, and tells the model what it did', async () => {
    expect(await tool.run({ name: 'a' }, ctx)).toEqual({ type: 'text', text: 'Deleted a.' });
    await expect(tool.run({ name: 'b' }, ctx)).rejects.toThrow('No thing "b".');
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

describe('call arguments', () => {
  it('reads the name trimmed, or none', () => {
    expect(nameArg({ name: ' x ' })).toBe('x');
    expect(nameArg({})).toBe('');
    expect(nameArg(undefined)).toBe('');
  });

  it('reads a list, or a single string as a list of one', () => {
    expect(listArg([' a ', '', 'b'])).toEqual(['a', 'b']);
    expect(listArg(' a ')).toEqual(['a']);
    expect(listArg(undefined)).toEqual([]);
  });
});
