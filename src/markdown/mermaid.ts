// Mermaid code blocks in the model's text, drawn as diagrams (ui/MermaidBlock) once their fence is
// closed: while the answer streams, an unfinished one stays code and is not drawn again at each token.

const MERMAID_LANG = 'mermaid';

// A fence line: up to three spaces, or a container's markers (> of a quote, a list's indent), then
// three or more ` or ~.
const FENCE = /^[ \t>]*(`{3,}|~{3,})/;

// Whether a fenced code block, as written in the text (`raw`, its fences included), is closed: its
// last line is a fence of the same character, at least as long as the opening one, and nothing else.
export function fenceClosed(raw: string): boolean {
  const lines = raw.replace(/\n+$/, '').split('\n');
  if (lines.length < 2) return false;
  const open = FENCE.exec(lines[0]!)?.[1];
  const close = /^[ \t>]*(`{3,}|~{3,})[ \t]*$/.exec(lines.at(-1)!)?.[1];
  return !!open && !!close && close[0] === open[0] && close.length >= open.length;
}

// A node of the Markdown tree remark plugins work on (only what this one uses).
interface MdNode {
  type: string;
  lang?: string | null;
  position?: { start: { offset?: number }; end: { offset?: number } };
  data?: { hProperties?: Record<string, unknown> };
  children?: MdNode[];
}

// A remark plugin: each closed mermaid block's <code> gets data-mermaid, which ui/Markdown draws.
export function remarkMermaid() {
  return (tree: MdNode, file: { value: unknown }) => {
    const text = String(file.value);
    const walk = (node: MdNode) => {
      if (node.type === 'code' && node.lang?.toLowerCase() === MERMAID_LANG) {
        const { start, end } = node.position ?? {};
        if (start?.offset !== undefined && end?.offset !== undefined && fenceClosed(text.slice(start.offset, end.offset))) {
          node.data = { ...node.data, hProperties: { ...node.data?.hProperties, dataMermaid: '' } };
        }
      }
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}
