import { describe, expect, it } from 'vitest';
import { autoPicks } from '../src/storage/auto-picks';

const defaults = { threshold: 60, max: 1, most: 3 };
const ranked = [{ id: 'a', match: 0.9 }, { id: 'b', match: 0.8 }, { id: 'c', match: 0.7 }, { id: 'd', match: 0.5 }];
const ids = (r: { id: string }[]) => r.map((x) => x.id);

describe('autoPicks', () => {
  it('picks none while it is off', () => {
    expect(autoPicks(ranked, undefined, defaults)).toEqual([]);
    expect(autoPicks(ranked, { enabled: false }, defaults)).toEqual([]);
  });

  it('takes the best over the match needed, at most max (never over the most)', () => {
    expect(ids(autoPicks(ranked, { enabled: true }, defaults))).toEqual(['a']);
    expect(ids(autoPicks(ranked, { enabled: true, max: 9 }, defaults))).toEqual(['a', 'b', 'c']);
    expect(ids(autoPicks(ranked, { enabled: true, max: 9, threshold: 85 }, defaults))).toEqual(['a']);
  });

  it('leaves out those `keep` does not let through, before counting', () => {
    expect(ids(autoPicks(ranked, { enabled: true, max: 2 }, defaults, (r) => r.id !== 'a'))).toEqual(['b', 'c']);
  });
});
