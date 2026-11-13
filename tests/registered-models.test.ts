import { describe, expect, it } from 'vitest';
import { listsMore, pickerModels, recentModels, RECENT_MODELS, registeredCount, toggleRegistered, withPicked, withRecent } from '../src/providers/registered-models';

describe('pickerModels', () => {
  it('lists all the server lists when none is registered, the default first and once', () => {
    expect(pickerModels({ defaultModel: 'b', models: undefined }, ['a', 'b', 'c'])).toEqual(['b', 'a', 'c']);
    expect(pickerModels({ defaultModel: 'b', models: [] }, ['a'])).toEqual(['b', 'a']);
  });
  it('lists only those registered, even when the server lists none', () => {
    expect(pickerModels({ defaultModel: 'b', models: ['c', 'x'] }, ['a', 'b', 'c'])).toEqual(['b', 'c', 'x']);
    expect(pickerModels({ defaultModel: '', models: ['c'] })).toEqual(['c']);
  });
  it('with all, those registered and those listed', () => {
    expect(pickerModels({ defaultModel: 'b', models: ['x', 'c'] }, ['a', 'b', 'c'], { all: true })).toEqual(['b', 'x', 'c', 'a']);
  });
});

describe('recent models', () => {
  it('puts the one picked first, once, and keeps a few', () => {
    expect(withRecent(undefined, 'p', 'm')).toEqual(['p|m']);
    expect(withRecent(['p|a', 'p|m', 'q|b'], 'p', 'm')).toEqual(['p|m', 'p|a', 'q|b']);
    const many = Array.from({ length: 10 }, (_, i) => `p|m${i}`);
    expect(withRecent(many, 'q', 'x')).toHaveLength(RECENT_MODELS);
  });
  it('reads them back for the providers still set up, a model id with "|" whole', () => {
    expect(recentModels(['p|a|b', 'gone|m', 'q|c', 'bad', '|m', 'p|', 3 as unknown as string], [{ id: 'p' }, { id: 'q' }])).toEqual([
      { providerId: 'p', model: 'a|b' },
      { providerId: 'q', model: 'c' },
    ]);
    expect(recentModels('not a list' as unknown as string[], [{ id: 'p' }])).toEqual([]);
  });
});

describe('toggleRegistered', () => {
  it('adds at the end, takes out, and none left is none registered', () => {
    expect(toggleRegistered(undefined, 'a')).toEqual(['a']);
    expect(toggleRegistered(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleRegistered(['a', 'b'], 'a')).toEqual(['b']);
    expect(toggleRegistered(['a'], 'a')).toBeUndefined();
  });
});

describe('what the picker shows', () => {
  it('always lists the model chosen, once', () => {
    expect(pickerModels({ defaultModel: 'b', models: ['c'] }, ['a', 'b', 'c'], { selected: 'z' })).toEqual(['b', 'c', 'z']);
    expect(pickerModels({ defaultModel: 'b', models: ['c'] }, [], { selected: 'c' })).toEqual(['b', 'c']);
  });
  it('Show all only when the server lists one not registered', () => {
    expect(listsMore({ models: ['a'] }, ['a', 'b'])).toBe(true);
    expect(listsMore({ models: ['a', 'b'] }, ['a', 'b'])).toBe(false);
    expect(listsMore({ models: ['a'] }, [])).toBe(false);
    expect(listsMore({}, ['a'])).toBe(false);
  });
  it('counts those registered that the server lists', () => {
    expect(registeredCount({ models: ['a', 'gone'] }, ['a', 'b', 'c'])).toBe('1 of 3 registered');
    expect(registeredCount({ models: ['a', 'gone'] }, undefined)).toBe('2 registered');
  });
});

describe('withPicked', () => {
  const s = { activeProviderId: 'p', activeModel: 'm', recentModels: ['p|m', 'q|x'] };
  it('gives the same settings when the model picked is the chat’s and first already: nothing is saved', () => {
    expect(withPicked(s, 'p', 'm', { chat: true })).toBe(s);
    expect(withPicked(s, 'p', 'm', { chat: false })).toBe(s);
    expect(withRecent(s.recentModels, 'p', 'm')).toBe(s.recentModels);
  });
  it('an agent’s pick changes the recent models only; the chat’s, its model too', () => {
    expect(withPicked(s, 'q', 'x', { chat: false })).toEqual({ ...s, recentModels: ['q|x', 'p|m'] });
    expect(withPicked(s, 'q', 'x', { chat: true })).toEqual({ activeProviderId: 'q', activeModel: 'x', recentModels: ['q|x', 'p|m'] });
  });
  it('drops what is not a model key from what was stored', () => {
    expect(withRecent(['p|m', 3 as unknown as string], 'p', 'm')).toEqual(['p|m']);
    expect(withRecent('nope' as unknown as string[], 'p', 'm')).toEqual(['p|m']);
  });
});
