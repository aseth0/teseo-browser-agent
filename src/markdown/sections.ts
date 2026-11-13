// A text's headings as sections to fold (ui/MarkdownFold, the page widget's card): a section is its
// heading and all up to the next heading of its level or higher, so its subheadings fold with it.
import type { HastNode } from './tree';

const headingLevel = (n: HastNode): number | undefined => {
  const level = /^h([1-6])$/.exec(n.tagName ?? '')?.[1];
  return level ? Number(level) : undefined;
};
const shows = (n: HastNode) => n.type !== 'text' || !!n.value?.trim();

// The tree with each heading that has something under it, and only those at the top of the text (not
// in a quote or a list), as <section data-fold><hN data-fold>…</hN><div class="fold-body">…</div></section>.
// `data-fold` is the heading's place among the text's headings: streamed text only grows at its end,
// so it stays the same from token to token and in the finished text.
export function foldSections(root: HastNode): HastNode {
  const nodes = root.children ?? [];
  let at = 0;
  let headings = 0;
  const until = (level: number): HastNode[] => {
    const out: HastNode[] = [];
    while (at < nodes.length) {
      const node = nodes[at]!;
      const own = headingLevel(node);
      if (own !== undefined && own <= level) break;
      at++;
      if (own === undefined) {
        out.push(node);
        continue;
      }
      const dataFold = headings++;
      const body = until(own);
      if (!body.some(shows)) {
        out.push(node);
        continue;
      }
      out.push({
        type: 'element', tagName: 'section', properties: { dataFold }, children: [
          { ...node, properties: { ...node.properties, dataFold } },
          { type: 'element', tagName: 'div', properties: { className: ['fold-body'] }, children: body },
        ],
      });
    }
    return out;
  };
  return { ...root, children: until(0) };
}

// The rehype plugin of it.
export const rehypeFoldSections = () => foldSections;
