// Markdown (GFM) as an HTML tree, with syntax colors in code blocks: what ui/Markdown renders with
// React, and what the background sends the page widget to build its card from. Raw HTML is never
// kept: the model may echo untrusted page content.
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { createLowlight } from 'lowlight';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

// The languages code blocks are colored in (their aliases too: js, ts, sh, html, yml…); a few
// common ones keep the panel small.
export const lowlight = createLowlight({ bash, css, diff, javascript, json, markdown, python, shell, sql, typescript, xml, yaml });

// A node of the HTML tree rehype plugins work on (only what they use).
export type HastNode = { type: string; value?: string; tagName?: string; properties?: Record<string, unknown>; children?: HastNode[] };

// The text of a node and all under it.
export const textOf = (n: HastNode): string => n.value ?? (n.children ?? []).map(textOf).join('');

// A rehype plugin: each code block (<pre><code>) gets the syntax colors of its fence's language,
// or of the one detected when there is none; unknown languages stay plain.
export function rehypeCodeColors() {
  const walk = (node: HastNode) => {
    for (const child of node.children ?? []) {
      const code = child.tagName === 'pre' ? child.children?.find((c) => c.tagName === 'code') : undefined;
      if (!code) {
        walk(child);
        continue;
      }
      const classes = (code.properties?.className as string[] | undefined) ?? [];
      const lang = classes.find((c) => c.startsWith('language-'))?.slice('language-'.length);
      const source = textOf(code);
      const tree = lang ? (lowlight.registered(lang) ? lowlight.highlight(lang, source) : undefined) : lowlight.highlightAuto(source);
      if (!tree) continue;
      code.children = tree.children;
      code.properties = { ...code.properties, className: [...classes, 'hljs'] };
    }
  };
  return (tree: HastNode) => walk(tree);
}

// The tree of a text, without positions (it goes in a message).
const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype).use(rehypeCodeColors);
export function markdownTree(text: string): HastNode {
  const strip = (n: HastNode): HastNode => ({ type: n.type, ...(n.value !== undefined && { value: n.value }), ...(n.tagName && { tagName: n.tagName }),
    ...(n.properties && { properties: n.properties }), ...(n.children && { children: n.children.map(strip) }) });
  return strip(processor.runSync(processor.parse(text)));
}
