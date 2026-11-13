import { describe, expect, it } from 'vitest';
import { markdownTree, type HastNode } from '../src/markdown/tree';

const tags = (n: HastNode): string[] => [...(n.tagName ? [n.tagName] : []), ...(n.children ?? []).flatMap(tags)];
const text = (n: HastNode): string => n.value ?? (n.children ?? []).map(text).join('');

describe('markdownTree', () => {
  it('parses GFM, colors code, and never keeps raw HTML', () => {
    const tree = markdownTree('**Bold** and ~~gone~~\n\n| a |\n|---|\n| 1 |\n\n```js\nconst x = 1;\n```\n\n<b onclick="x()">raw</b>');
    expect(tags(tree)).toEqual(expect.arrayContaining(['strong', 'del', 'table', 'pre', 'code', 'span']));
    expect(tags(tree)).not.toContain('b');
    expect(JSON.stringify(tree)).not.toContain('position');
    expect(text(tree)).toContain('raw');
  });
});
