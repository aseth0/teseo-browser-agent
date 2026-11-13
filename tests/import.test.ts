import { describe, expect, it } from 'vitest';
import { importNamed, listFrom, sameName, stringList } from '../src/storage/import';

type Thing = { id: string; name: string; enabled: boolean; builtin?: boolean };

describe('imports of stored items', () => {
  it('reads the list under its key, a list, or one item alone', () => {
    expect(listFrom('{ "things": [{ "name": "a" }] }', 'things')).toEqual([{ name: 'a' }]);
    expect(listFrom('[{ "name": "a" }]', 'things')).toEqual([{ name: 'a' }]);
    expect(listFrom('{ "name": "a" }', 'things')).toEqual([{ name: 'a' }]);
    expect(() => listFrom('{ "name": "a" }', 'things', { single: false })).toThrow('No "things" list in this JSON');
    expect(() => listFrom('{ "things": 3 }', 'things')).toThrow('No "things" list in this JSON');
    expect(() => listFrom('null', 'things', { single: false })).toThrow('No "things" list');
  });

  it('keeps only strings, trimmed and without empty ones when asked', () => {
    expect(stringList([' a ', 3, '', 'b'])).toEqual([' a ', '', 'b']);
    expect(stringList([' a ', 3, '', '  ', 'b'], { trim: true })).toEqual(['a', 'b']);
    expect(stringList('a')).toEqual(['a']);
    expect(stringList(' a ', { trim: true })).toEqual(['a']);
    expect(stringList(undefined)).toEqual([]);
  });

  it('matches names trimmed, in any case', () => {
    expect(sameName(' Search Wikipedia ', 'search wikipedia')).toBe(true);
    expect(sameName('search', 'search-2')).toBe(false);
  });

  const existing: Thing[] = [{ id: 'mine', name: 'Notes', enabled: true }, { id: 'b', name: 'built', enabled: true, builtin: true }];
  const run = (list: unknown[]) =>
    importNamed<Thing>({
      list,
      existing,
      build: (item, old) => (old?.builtin ? { skip: `${old.name}: a built-in one has this name.` } : { name: String(item.name ?? '').trim(), enabled: false }),
      problems: (t, others) => [!t.name && 'It needs a name.', others.some((o) => o.name === t.name) && 'Another has this name.'].filter((p): p is string => !!p),
    });

  it('replaces the one of its name, keeping its id, and gives a new one a new id', () => {
    const { items, skipped } = run([{ name: ' notes ' }, { name: 'fresh' }]);
    expect(skipped).toEqual([]);
    expect(items[0]).toEqual({ id: 'mine', name: 'notes', enabled: false });
    expect(items[1]!.id).not.toBe('mine');
    expect(items[1]).toMatchObject({ name: 'fresh', enabled: false });
  });

  it('leaves out what build skips, what has problems, and a second of the same name', () => {
    const { items, skipped } = run([{ name: 'BUILT' }, {}, 'not an object', { name: 'twice' }, { name: 'twice' }]);
    expect(items.map((t) => t.name)).toEqual(['twice']);
    expect(skipped).toEqual(['built: a built-in one has this name.', '(no name): It needs a name.', '(no name): It needs a name.', 'twice: the file has this name more than once.']);
  });

  it('says of each item whether it is new, replaces yours, or is left out and why', () => {
    const { rows } = run([{ name: 'fresh' }, { name: ' NOTES ' }, { name: 'built' }, { name: 'twice' }, { name: 'twice' }]);
    expect(rows.map((r) => [r.name, r.status, r.why])).toEqual([
      ['fresh', 'new', undefined],
      ['NOTES', 'replaces', undefined],
      ['built', 'left-out', 'built: a built-in one has this name.'],
      ['twice', 'new', undefined],
      ['twice', 'left-out', 'twice: the file has this name more than once.'],
    ]);
    expect(rows[1]!.item).toEqual({ id: 'mine', name: 'NOTES', enabled: false });
    expect(rows[2]!.item).toBeUndefined();
  });

  it("says it is another section's file instead of reading it as one item", () => {
    expect(() => listFrom('{ "templates": [{ "name": "x" }] }', 'skills')).toThrow('This is a site templates file: import it in Site templates.');
    expect(listFrom('{ "name": "jira", "skills": ["review-pr"] }', 'agents')).toEqual([{ name: 'jira', skills: ['review-pr'] }]);
  });

  it('leaves out the second of a name the file has twice, also when that name is one of yours', () => {
    const { items, rows } = run([{ name: 'Notes' }, { name: 'notes' }]);
    expect(items).toHaveLength(1);
    expect(rows.map((r) => [r.status, r.why])).toEqual([['replaces', undefined], ['left-out', 'notes: the file has this name more than once.']]);
  });
});
