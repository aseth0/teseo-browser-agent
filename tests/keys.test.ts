import { describe, expect, it } from 'vitest';
import { keyOf, patchAt } from '../src/ui/keys';

describe('stable keys for lists being edited', () => {
  it('follow the items when one is edited, moved or removed', () => {
    const list = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
    const [a, b, c] = list.map(keyOf);
    expect(new Set([a, b, c]).size).toBe(3);
    const edited = patchAt(list, 1, { name: 'B' });
    expect(edited[1]).toEqual({ name: 'B' });
    expect(edited.map(keyOf)).toEqual([a, b, c]);
    expect([edited[2]!, edited[0]!].map(keyOf)).toEqual([c, a]); // moved
    expect(edited.filter((_, i) => i !== 0).map(keyOf)).toEqual([b, c]); // removed
  });
});
