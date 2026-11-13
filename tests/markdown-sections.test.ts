import { describe, expect, it } from 'vitest';
import { foldSections } from '../src/markdown/sections';
import { markdownTree, textOf, type HastNode } from '../src/markdown/tree';

// A tree as nested lists: a section as [its heading, ...what is under it], anything else as its tag.
type Shape = string | Shape[];
const shape = (n: HastNode): Shape[] => (n.children ?? []).filter((c) => c.type === 'element').map((c): Shape => {
  if (c.tagName !== 'section') return c.tagName === 'p' ? textOf(c) : `${c.tagName}:${textOf(c)}`;
  const [heading, body] = c.children!;
  return [`${heading!.tagName}:${textOf(heading!)}#${String(heading!.properties?.dataFold)}`, ...shape(body!)];
});
const sections = (text: string) => shape(foldSections(markdownTree(text)));

describe('foldSections', () => {
  it('leaves a text without headings as it is', () => {
    expect(sections('one\n\ntwo')).toEqual(['one', 'two']);
  });

  it('keeps what comes before the first heading outside', () => {
    expect(sections('intro\n\n## A\n\na')).toEqual(['intro', ['h2:A#0', 'a']]);
  });

  it('ends a section at the next heading of its level', () => {
    expect(sections('## A\n\na\n\n## B\n\nb')).toEqual([['h2:A#0', 'a'], ['h2:B#1', 'b']]);
  });

  it('nests lower headings, which fold with it', () => {
    expect(sections('## A\n\na\n\n### B\n\nb\n\n#### C\n\nc\n\n### D\n\nd')).toEqual([
      ['h2:A#0', 'a', ['h3:B#1', 'b', ['h4:C#2', 'c']], ['h3:D#3', 'd']],
    ]);
  });

  it('ends a section at a higher heading, whatever the depth', () => {
    expect(sections('## A\n\n#### B\n\nb\n\n# C\n\nc')).toEqual([['h2:A#0', ['h4:B#1', 'b']], ['h1:C#2', 'c']]);
  });

  it('does not nest a heading under a lower one before it', () => {
    expect(sections('### A\n\na\n\n## B\n\nb\n\n### C\n\nc')).toEqual([['h3:A#0', 'a'], ['h2:B#1', 'b', ['h3:C#2', 'c']]]);
  });

  it('leaves a heading with nothing under it plain, and still counts it', () => {
    expect(sections('## A\n\n## B\n\nb\n\n## C')).toEqual(['h2:A', ['h2:B#1', 'b'], 'h2:C']);
    expect(sections('## A\n\n### B')).toEqual([['h2:A#0', 'h3:B']]);
  });

  it('groups only the headings at the top of the text, not those in a quote or a list', () => {
    const shapes = sections('> ## Quoted\n>\n> q\n\n- ## Listed\n\nend');
    expect(shapes.every((n) => typeof n === 'string')).toBe(true);
    expect(shapes[2]).toBe('end');
  });

  it('ignores what looks like a heading in a code block', () => {
    expect(sections('## A\n\n```\n# not a heading\n```')).toEqual([['h2:A#0', 'pre:# not a heading\n']]);
  });

  it('gives each heading the same place at every point of the stream', () => {
    const text = '## A\n\na\n\n### B\n\nb\n\n## C\n\nc';
    const places = (t: string) => [...JSON.stringify(sections(t)).matchAll(/h\d:(\w+)#(\d)/g)].map((m) => [m[1]!, m[2]!]);
    const final = new Map(places(text).map(([name, at]) => [name, at]));
    for (let end = 1; end <= text.length; end++) {
      for (const [name, at] of places(text.slice(0, end))) expect(at).toBe(final.get(name));
    }
    expect([...final]).toEqual([['A', '0'], ['B', '1'], ['C', '2']]);
  });
});
