// Settings → Actions' values from the page: rows, none lost to a repeated or empty name.
import { describe, expect, it } from 'vitest';
import { freeName, readsOf, repeatedName } from '../src/ui/widget-actions/reads';

describe("an action's values from the page, as edited", () => {
  it('say a name two rows have, empty ones aside', () => {
    expect(repeatedName([{ name: 'owner', value: 'a' }, { name: ' owner ', value: 'b' }])).toBe('owner');
    expect(repeatedName([{ name: '', value: 'a' }, { name: '', value: 'b' }, { name: 'repo', value: 'c' }])).toBeUndefined();
  });

  it('give a new row a name no row has', () => {
    expect(freeName([])).toBe('value1');
    expect(freeName([{ name: 'value2', value: '' }])).toBe('value3');
    expect(freeName([{ name: 'value2', value: '' }, { name: 'value3', value: '' }])).toBe('value4');
  });

  it('keep the named rows, by name', () => {
    expect(readsOf([{ name: ' owner ', value: '{{url}}' }, { name: '', value: 'x' }])).toEqual({ owner: '{{url}}' });
  });
});
