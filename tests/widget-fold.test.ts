// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { markdownTree } from '../src/markdown/tree';
import { foldableTree, markdown } from '../src/widget/ui/dom';

describe("the widget card's headings", () => {
  const tree = markdownTree('intro\n\n## One\n\nfirst\n\n### Two\n\nsecond\n\n## Three\n\nthird');
  const folded = (root: Element) => [...root.querySelectorAll('.fold-section.folded')].map((s) => s.querySelector('h2,h3')?.textContent);

  it('gives each section a button, none to what comes before them', () => {
    const root = markdown(tree);
    expect([...root.querySelectorAll('.fold-toggle')].map((b) => b.getAttribute('aria-label'))).toEqual(['Fold One', 'Fold Two', 'Fold Three']);
    expect(root.firstElementChild?.tagName).toBe('P');
  });

  it('builds what is folded as folded, as when the streamed answer is built again', () => {
    const root = document.createElement('div');
    root.append(...foldableTree(tree, new Set([0])));
    expect(folded(root)).toEqual(['One']);
    expect(root.querySelector('.fold-toggle[data-fold="0"]')?.getAttribute('aria-expanded')).toBe('false');
    expect(root.querySelector('.fold-section.folded')?.textContent).toContain('second');
  });

  it('ignores a click no user made: a page script cannot fold it', () => {
    const into = new Set<number>();
    const root = markdown(tree, into);
    root.querySelector<HTMLButtonElement>('.fold-toggle')!.click();
    expect(into.size).toBe(0);
    expect(folded(root)).toEqual([]);
  });
});
