// What the model asks for, read as the tools take it.
import { describe, expect, it } from 'vitest';
import { countArg } from '../src/tools/define';

describe('countArg', () => {
  it('is a whole number from 1 to the most, the default when none or not a number', () => {
    expect([countArg(3, 5, 10), countArg(2.6, 5, 10), countArg(50, 5, 10), countArg(0, 5, 10)]).toEqual([3, 3, 10, 1]);
    expect([countArg(undefined, 5, 10), countArg('lots', 5, 10), countArg('4', 5, 10)]).toEqual([5, 5, 4]);
  });
});

describe('clip', async () => {
  const { clip } = await import('../src/core/clip');
  it('never cuts a character in two', () => {
    expect(clip('ab😀cd', 3).text).toBe('ab');
    expect(clip('ab😀cd', 4).text).toBe('ab😀');
    expect(clip('abc', 5)).toEqual({ text: 'abc', truncated: false });
  });
});
