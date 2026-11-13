// The model's Markdown (GFM) as Jira wiki markup, for the chat shown as Jira: what can be pasted in
// a Jira issue or comment (h1., *bold*, {code}, ||tables||, [text|url]). What Jira has no markup for
// stays as text.
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

// A node of the Markdown tree (mdast), only what is read here.
interface Node {
  type: string;
  children?: Node[];
  value?: string;
  depth?: number;
  lang?: string | null;
  ordered?: boolean | null;
  checked?: boolean | null;
  url?: string;
}

const parser = unified().use(remarkParse).use(remarkGfm);

export function markdownToJira(markdown: string): string {
  const tree = parser.runSync(parser.parse(markdown)) as Node;
  return blocks(tree, '').trim();
}

// Blocks, a blank line between them; `list` is the bullets of the list they are in ("*#").
function blocks(parent: Node, list: string): string {
  return (parent.children ?? []).map((n) => block(n, list)).filter(Boolean).join('\n\n');
}

function block(node: Node, list: string): string {
  switch (node.type) {
    case 'heading':
      return `h${node.depth ?? 1}. ${inlines(node)}`;
    case 'paragraph':
      return inlines(node);
    case 'blockquote':
      return `{quote}\n${blocks(node, '')}\n{quote}`;
    case 'code':
      // One that says {code} itself would end there: as it is, without colors.
      if (node.value?.includes('{code}')) return `{noformat}\n${node.value}\n{noformat}`;
      return `{code${node.lang ? `:${node.lang}` : ''}}\n${node.value ?? ''}\n{code}`;
    case 'thematicBreak':
      return '----';
    case 'list': {
      const bullets = list + (node.ordered ? '#' : '*');
      return (node.children ?? []).map((item) => listItem(item, bullets)).join('\n');
    }
    case 'table':
      return (node.children ?? [])
        .map((row, i) => {
          const sep = i === 0 ? '||' : '|';
          return `${sep}${(row.children ?? []).map((cell) => inlines(cell, true) || ' ').join(sep)}${sep}`;
        })
        .join('\n');
    case 'html':
      return escape(node.value ?? '');
    default:
      return node.children ? blocks(node, list) : '';
  }
}

// An item: its first paragraph on the bullet's line; what follows it, nested lists on their own
// lines, other blocks joined to it (Jira's items are one line).
function listItem(item: Node, bullets: string): string {
  const check = item.checked === true ? '(/) ' : item.checked === false ? '☐ ' : '';
  const lines: string[] = [];
  let text = '';
  for (const child of item.children ?? []) {
    if (child.type === 'list') lines.push(block(child, bullets));
    else text += (text ? ' \\\\ ' : '') + (child.type === 'paragraph' ? inlines(child) : block(child, '').replace(/\n/g, ' '));
  }
  return [`${bullets} ${check}${text}`, ...lines].join('\n');
}

function inlines(parent: Node, inTable = false): string {
  return (parent.children ?? []).map((n) => inline(n, inTable)).join('');
}

function inline(node: Node, inTable: boolean): string {
  switch (node.type) {
    case 'text':
      return escape(node.value ?? '', inTable);
    case 'strong':
      return `*${inlines(node, inTable)}*`;
    case 'emphasis':
      return `_${inlines(node, inTable)}_`;
    case 'delete':
      return `-${inlines(node, inTable)}-`;
    case 'inlineCode':
      return `{{${(node.value ?? '').replace(/([{}])/g, '\\$1')}}}`;
    case 'break':
      return inTable ? ' \\\\ ' : ' \\\\\n'; // a table's row is one line
    case 'link': {
      const label = inlines(node, inTable);
      const url = node.url ?? '';
      return label && label !== escape(url, inTable) ? `[${label}|${url}]` : `[${url}]`;
    }
    case 'image':
      return `!${node.url ?? ''}!`;
    case 'html':
      return escape(node.value ?? '', inTable);
    default:
      return node.children ? inlines(node, inTable) : '';
  }
}

// Text that would read as markup: braces and brackets always (macros, links), | in a table, and
// a marker (* _ - + ^ ~) at either end of a word; # or * at the start of a line, read as a list.
function escape(text: string, inTable = false): string {
  return text
    .replace(inTable ? /[{}[\]|]/g : /[{}[\]]/g, '\\$&')
    .replace(/(^|[\s(])([*_\-+^~])(?=\S)/g, '$1\\$2')
    .replace(/(\S)([*_+^~])(?=$|[\s).,;:!?])/g, '$1\\$2')
    .replace(/^#/gm, '\\#');
}
