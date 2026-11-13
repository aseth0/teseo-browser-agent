import { describe, expect, it } from 'vitest';
import { closestNames } from '../src/core/similar';

describe('closestNames', () => {
  it('finds a name written in another case or with other separators first', () => {
    const names = ['memory__read', 'memory__search', 'memory__save'];
    expect(closestNames(names, 'memory_search')[0]).toBe('memory__search');
    expect(closestNames(names, 'Memory_Search')[0]).toBe('memory__search');
    expect(closestNames(names, 'memory.search')[0]).toBe('memory__search');
  });

  it('finds the names that start with what was written', () => {
    const names = ['mcp__docs__docs-get', 'mcp__docs__docs-list', 'mcp__docs__docs-find', 'mcp__other__x', 'browser__click'];
    expect(closestNames(names, 'mcp__docs', Infinity)).toEqual(['mcp__docs__docs-get', 'mcp__docs__docs-list', 'mcp__docs__docs-find']);
    expect(closestNames(names, 'mcp__docs')).toHaveLength(3);
  });

  it('keeps the dotted and alike matches, each name once', () => {
    expect(closestNames(['custom.gpt.ask', 'other'], 'gpt.ask')).toEqual(['custom.gpt.ask']);
    expect(closestNames(['browser.type', 'browser.click'], 'browser.clik')[0]).toBe('browser.click');
    expect(closestNames(['abc', 'xyz'], 'nothing')).toEqual([]);
  });
});
