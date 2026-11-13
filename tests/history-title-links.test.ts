import { describe, expect, it } from 'vitest';
import { plainTitle, titleParts } from '../src/history/title-links';

describe('history title links', () => {
  it('splits a title into text and its Markdown links', () => {
    expect(titleParts('Notes on [the spec](https://example.com/spec) and [more](http://docs.example.com/a?b=1)')).toEqual([
      'Notes on ', { text: 'the spec', url: 'https://example.com/spec' }, ' and ', { text: 'more', url: 'http://docs.example.com/a?b=1' },
    ]);
  });

  it('keeps a title without links, and links that are not http(s), as text', () => {
    expect(titleParts('Plain title')).toEqual(['Plain title']);
    expect(titleParts('[x](javascript:alert(1)) [y](file:///etc)')).toEqual(['[x](javascript:alert(1)) [y](file:///etc)']);
    expect(titleParts('[unclosed](https://example.com')).toEqual(['[unclosed](https://example.com']);
  });

  it('reads a title with each link by its text', () => {
    expect(plainTitle('See [the spec](https://example.com/spec) now')).toBe('See the spec now');
  });
});
