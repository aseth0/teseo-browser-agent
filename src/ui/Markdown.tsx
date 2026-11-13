// Renders model text as Markdown (GFM), with syntax colors in code blocks. Raw HTML is never
// rendered: the model may echo untrusted page content, so it stays text. Nor are images loaded: a
// prompt injection could have the model write one whose URL carries what it read, fetched as soon
// as it is shown; each is a link instead (MarkdownImage).
import { useMemo, useRef, type ReactNode } from 'react';
import ReactMarkdown, { type Options } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CopyIconButton, type Clip } from './icons';
import { remarkMermaid } from '../markdown/mermaid';
import { rehypeFoldSections } from '../markdown/sections';
import { rehypeCodeColors, textOf, type HastNode } from '../markdown/tree';
import { FOLD_COMPONENTS, FoldsContext, useFolds } from './MarkdownFold';
import { MermaidBlock } from './MermaidBlock';
import { hostOf } from '../core/util';

// At module level: new ones at each render (each streamed token) would remount every code block and
// table, losing their copy button's state and the selection in them.
const REMARK_PLUGINS: Options['remarkPlugins'] = [remarkGfm, remarkMermaid];
const COMPONENTS: Options['components'] = {
  // Links open outside the panel.
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  img: ({ src, alt }) => <MarkdownImage src={typeof src === 'string' ? src : undefined} alt={alt} />,
  // Code blocks and tables with a copy button; closed Mermaid blocks drawn.
  pre: ({ node, ...props }) => {
    const mermaid = mermaidSource(node);
    if (mermaid !== undefined) return <MermaidBlock source={mermaid} />;
    return (
      <Copyable label="Copy the code" copy={(el) => (el.querySelector('code')?.textContent ?? '').replace(/\n$/, '')}>
        <pre {...props} />
      </Copyable>
    );
  },
  table: ({ node: _node, ...props }) => (
    <Copyable label="Copy the table" copy={(el) => {
      const table = el.querySelector('table');
      return table ? tableClip(table) : '';
    }}>
      <table {...props} />
    </Copyable>
  ),
};

// remarkPlugins and components: more, after these (your text in the chat, ui/chat/MessageView).
// `foldable`: its headings fold and unfold (the model's answers).
export function Markdown(props: { text: string; foldable?: boolean; rehypePlugins?: Options['rehypePlugins']; remarkPlugins?: Options['remarkPlugins']; components?: Options['components'] }) {
  const { text, foldable, rehypePlugins, remarkPlugins, components } = props;
  // Code blocks with syntax colors (the language from the fence, else detected).
  const rehype = useMemo(() => [rehypeCodeColors, ...(foldable ? [rehypeFoldSections] : []), ...(rehypePlugins ?? [])], [foldable, rehypePlugins]);
  const remark = useMemo(() => (remarkPlugins ? [...REMARK_PLUGINS!, ...remarkPlugins] : REMARK_PLUGINS), [remarkPlugins]);
  const shown = useMemo(() => ({ ...COMPONENTS, ...(foldable && FOLD_COMPONENTS), ...components }), [foldable, components]);
  const trimmed = text.trim();
  const folds = useFolds(foldable ? trimmed : ''); // no text: nothing to remember
  return (
    <div className="markdown">
      <FoldsContext.Provider value={foldable ? folds : undefined}>
        <ReactMarkdown remarkPlugins={remark} skipHtml rehypePlugins={rehype} components={shown}>
          {trimmed}
        </ReactMarkdown>
      </FoldsContext.Provider>
    </div>
  );
}

// The source of a <pre> that is a closed Mermaid block (remarkMermaid marked its <code>), else none.
function mermaidSource(pre: HastNode | undefined): string | undefined {
  const code = pre?.children?.find((c) => c.tagName === 'code');
  if (code?.properties?.dataMermaid === undefined) return undefined;
  return textOf(code).replace(/\n$/, '');
}

// An image in the model's text, never loaded: a link to it, named by its alt text or else by its
// URL's host, that opens in a new tab only when clicked. Without a URL (or one dropped as unsafe),
// its alt text alone.
function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const name = alt?.trim() || hostOf(src) || src || '';
  if (!src) return name ? <span>{name}</span> : null;
  return <a href={src} title={src} target="_blank" rel="noopener noreferrer">{name}</a>;
}

// A block with a copy button in its corner (shown on hover); what to copy is read from what it shows.
function Copyable({ label, copy, children }: { label: string; copy: (el: HTMLElement) => Clip; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className="copyable" ref={ref}>
      {children}
      <span className="copy-corner">
        <CopyIconButton label={label} text={() => (ref.current ? copy(ref.current) : '')} />
      </span>
    </div>
  );
}

// A table as Markdown (for text editors and chats) and as HTML (pastes as a table in documents and
// spreadsheets).
function tableClip(table: HTMLTableElement): { plain: string; html: string } {
  const rows = [...table.rows].map((r) => [...r.cells].map((c) => (c.textContent ?? '').trim().replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ')));
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  const [head = [], ...body] = rows;
  const plain = [line(head), line(head.map(() => '---')), ...body.map(line)].join('\n');
  return { plain, html: table.outerHTML };
}
