import { describe, expect, it } from 'vitest';
import { globMatches } from '../src/core/util';
import { matchesUrlPattern } from '../src/recording/filter';
import { matchesSearch, parseSearch } from '../src/recording/search';
import type { RecordedCall } from '../src/recording/recording';

// A glob (`*` any characters) matched without a RegExp: one the user typed cannot make the matcher
// backtrack for ages on a long address.
describe('globMatches', () => {
  it('* anywhere, the rest as written, the whole text', () => {
    expect(globMatches('*analytics*', 'shop.example.com/js/analytics.js')).toBe(true);
    expect(globMatches('*/collect', 'shop.example.com/collect')).toBe(true);
    expect(globMatches('*/collect', 'shop.example.com/collect?v=2')).toBe(false);
    expect(globMatches('shop.*.com/a*b*c', 'shop.example.com/a-x-b-y-c')).toBe(true);
    expect(globMatches('shop.*.com/a*b*c', 'shop.example.com/a-x-c')).toBe(false);
    expect(globMatches('exact', 'exact')).toBe(true);
    expect(globMatches('exact', 'exactly')).toBe(false);
    expect(globMatches('*', '')).toBe(true);
    expect(globMatches('', 'x')).toBe(false);
  });
  it('a segment used by the prefix is not reused by the suffix', () => {
    expect(globMatches('ab*ab', 'ab')).toBe(false);
    expect(globMatches('ab*ab', 'abab')).toBe(true);
  });
  it('ignores case unless told not to', () => {
    expect(globMatches('*Analytics*', 'x/analytics.js')).toBe(true);
    expect(globMatches('*Analytics*', 'x/analytics.js', { caseSensitive: true })).toBe(false);
  });
  it('a pattern made to backtrack answers at once', () => {
    const url = `https://shop.example.com/${'a'.repeat(30_000)}b`;
    const t0 = performance.now();
    expect(matchesUrlPattern('*a*a*a*a*a*a*a*a*a*a*c', url)).toBe(false);
    expect(globMatches('*a*a*a*a*a*a*a*a*a*a*c', url)).toBe(false);
    const c: RecordedCall = { id: '1', method: 'GET', url: `https://${'a'.repeat(30_000)}b.example.com/`, at: 0, included: true };
    expect(matchesSearch(c, parseSearch('domain:*a*a*a*a*a*a*a*a*a*a*c'))).toBe(false);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
