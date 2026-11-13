import { describe, expect, it } from 'vitest';
import { block, estimateTokens, fitBlocks } from '../src/context/budget';

describe('fitBlocks', () => {
  it('keeps highest priority first and drops what does not fit', () => {
    const blocks = [block('a11y-tree', 50, 'x'.repeat(4000)), block('page-meta', 100, 'meta'), block('selection', 90, '')];
    const out = fitBlocks(blocks, 100, 50);
    expect(out.map((b) => b.kind)).toEqual(['page-meta', 'a11y-tree']);
    expect(out[1]!.content).toContain('[truncated]');
    expect(out.reduce((n, b) => n + b.tokensEstimate, 0)).toBeLessThanOrEqual(100);
  });

  it('cuts by what the text weighs in its script: Japanese, a token a character', () => {
    const out = fitBlocks([block('page-meta', 100, 'meta'), block('a11y-tree', 50, '日本語のページ'.repeat(500))], 300, 50);
    expect(out[1]!.content).toContain('[truncated]');
    expect(out.reduce((n, b) => n + b.tokensEstimate, 0)).toBeLessThanOrEqual(300);
  });

  it('skips truncation when the remaining room is too small to be useful', () => {
    const out = fitBlocks([block('page-meta', 100, 'm'.repeat(360)), block('a11y-tree', 50, 'x'.repeat(4000))], 100, 50);
    expect(out.map((b) => b.kind)).toEqual(['page-meta']);
  });

  it('estimates ~4 chars per token', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});
