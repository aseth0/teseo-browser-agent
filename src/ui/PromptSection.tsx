// Building blocks of the prompt preview: collapsible sections with a small icon toolbar
// (render Markdown, show the JSON sent to the model, copy), and text blocks that follow it.
import { createContext, Fragment, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { originRuns, stripMarks, type Origin } from '../core/model-texts';
import { CopyIconButton, HIGHLIGHT_ICON, IconButton, MARKDOWN_ICON } from './icons';
import { JsonTree } from './JsonTree';
import { CUT_LABEL, CutMark } from './LimitMark';
import { Markdown } from './Markdown';
import type { HastNode } from '../markdown/tree';
import { ORIGIN_INFO, ORIGINS, originClass } from './origins';
import { Segmented } from './Segmented';

// How a section shows its texts: rendered as Markdown or not, and colored by origin or not
// (the values marked by core/model-texts withMarkedValues). Copy, JSON and token counts always
// use the text without marks.
interface BlockView {
  markdown: boolean;
  origin: boolean;
}

const ViewContext = createContext<BlockView>({ markdown: true, origin: false });
const useBlockView = () => useContext(ViewContext);

// Sections start folded; those opened are remembered per browser (a convenience: works without storage too).
const OPEN_KEY = 'promptPreview.open';
function readOpen(): string[] {
  try {
    const open: unknown = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]');
    return Array.isArray(open) ? open.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}
function writeOpen(id: string, open: boolean) {
  try {
    const rest = readOpen().filter((x) => x !== id);
    localStorage.setItem(OPEN_KEY, JSON.stringify(open ? [...rest, id] : rest));
  } catch {
    // not persisted: fine
  }
}

export function PromptSection(props: {
  id: string;
  className?: string; // added to prompt-section
  title: string;
  icon?: ReactNode; // before the title
  meta?: string; // e.g. token count, next to the title
  hint?: ReactNode;
  copyText: string | (() => string); // what "copy" copies in the text and Markdown views (a function: made on copying)
  json?: unknown; // the JSON sent to the model for this section
  viewsInTitle?: boolean; // its buttons (origin colors, Markdown, JSON, copy) in the title instead of a toolbar
  origin?: boolean; // contains filled-in values: offer the origin colors
  originOn?: boolean; // and start with them on (default: yes)
  defaultOpen?: boolean; // initial state instead of the remembered one
  asSent?: ReactNode; // another render of it: the text as sent, part by part (the system message)
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => props.defaultOpen ?? readOpen().includes(props.id));
  const [view, setView] = useState<BlockView>({ markdown: true, origin: !!props.origin && (props.originOn ?? true) });
  // What the section shows: its parts as sent (where it can), its blocks, or the JSON sent.
  const [mode, setMode] = useState<'asSent' | 'blocks' | 'json'>(props.asSent !== undefined ? 'asSent' : 'blocks');
  const showJson = mode === 'json';
  const showAsSent = mode === 'asSent' && props.asSent !== undefined;
  const show = (m: typeof mode) => {
    setMode(m);
    setOpen(true);
  };
  const toggle = (key: keyof BlockView) => {
    if (showJson) setMode(props.asSent !== undefined ? 'asSent' : 'blocks');
    setView((v) => ({ ...v, [key]: !v[key] }));
    setOpen(true);
  };
  const views: [typeof mode, string, string][] = [
    ...(props.asSent !== undefined ? [['asSent', 'As sent', 'Show it as sent, part by part'] as [typeof mode, string, string]] : []),
    ['blocks', 'Blocks', 'Show its texts, each editable where it can be'],
    ...(props.json !== undefined ? [['json', 'JSON', 'Show the JSON sent to the model'] as [typeof mode, string, string]] : []),
  ];
  // One control for what it shows; then how texts look, and copy.
  const viewButtons = views.length > 1 && (
    <Segmented className="compact" label={`${props.title}: show`} value={mode} onChange={show}
      options={views.map(([m, label, title]) => ({ value: m, label, title, ...(m === 'json' && { ariaLabel: title }) }))} />
  );
  const originButton = props.origin && (
    <IconButton label="Highlight where the text comes from" pressed={!showJson && view.origin} icon={HIGHLIGHT_ICON} onClick={() => toggle('origin')} />
  );
  const markdownButton = <IconButton label="Render Markdown" pressed={!showJson && view.markdown} icon={MARKDOWN_ICON} onClick={() => toggle('markdown')} />;
  // Made on copying: a request's whole JSON and text are long, and most sections are never copied.
  const copied = () => (showJson ? (props.json === undefined ? '' : JSON.stringify(props.json, null, 2)) : stripMarks(typeof props.copyText === 'function' ? props.copyText() : props.copyText));
  const copyButton = <CopyIconButton text={copied} label={showJson ? 'Copy the JSON' : 'Copy to clipboard'} />;
  const buttons = <>{viewButtons}{originButton}{markdownButton}{copyButton}</>;

  // The origins shown in the section, for its legend: read from what was rendered.
  const body = useRef<HTMLDivElement>(null);
  const [present, setPresent] = useState<Origin[]>([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- after every render: it reads what was rendered, and sets state only when that changed
  useLayoutEffect(() => {
    if (!view.origin || showJson || !open) return;
    const found = ORIGINS.filter((o) => body.current?.querySelector(`.origin-${o.origin}`)).map((o) => o.origin);
    if (found.join() !== present.join()) setPresent(found);
  });

  return (
    <details
      className={props.className ? `prompt-section ${props.className}` : 'prompt-section'}
      open={open}
      onToggle={(e) => {
        setOpen(e.currentTarget.open);
        writeOpen(props.id, e.currentTarget.open);
      }}
    >
      <summary>
        <span className="prompt-section-title">{props.icon}{props.icon && ' '}{props.title}</span>
        {props.meta && <span className="muted">{props.meta}</span>}
        {props.viewsInTitle && (
          // A click on them changes the view (opening the section), without folding it.
          <span className="title-tools" role="toolbar" aria-label={`${props.title} actions`} onClick={(e) => e.preventDefault()}>{buttons}</span>
        )}
      </summary>
      <div className="prompt-section-body">
        {!props.viewsInTitle && (
          <div className="icon-toolbar" role="toolbar" aria-label={`${props.title} actions`}>
            {buttons}
          </div>
        )}
        {props.hint && <p className="hint">{props.hint}</p>}
        {!showJson && view.origin && <OriginLegend present={present} />}
        {showJson ? (
          <div className="text-block"><JsonTree value={props.json} /></div>
        ) : (
          <div ref={body}>
            <ViewContext.Provider value={view}>{showAsSent && props.asSent !== undefined ? props.asSent : props.children}</ViewContext.Provider>
          </div>
        )}
      </div>
    </details>
  );
}

// Which colors mean what, for the origins present.
export function OriginLegend({ present }: { present: Origin[] }) {
  if (!present.length) return <p className="hint">No values filled in here: all of it is fixed text.</p>;
  return (
    <p className="hint origin-legend">
      {present.map((origin) => (
        <mark key={origin} className={originClass(origin)} title={ORIGIN_INFO[origin].about}>{ORIGIN_INFO[origin].label}</mark>
      ))}
      <span>the rest is fixed text</span>
    </p>
  );
}

// Filled-in values in their origin colors, whatever the section's choice (an "as sent" render).
export function OriginView({ children }: { children: ReactNode }) {
  const view = useBlockView();
  return <ViewContext.Provider value={{ ...view, origin: true }}>{children}</ViewContext.Provider>;
}

// A block's own choice of Markdown or not, keeping the section's origin colors.
export function MarkdownView({ on, children }: { on: boolean; children: ReactNode }) {
  const view = useBlockView();
  return <ViewContext.Provider value={{ ...view, markdown: on }}>{children}</ViewContext.Provider>;
}
export const useSectionMarkdown = () => useBlockView().markdown;

// A text exactly as written, line by line, with the origin colors (outside a section's toolbar).
export function RawText({ text }: { text: string }) {
  return (
    <ViewContext.Provider value={{ markdown: false, origin: true }}>
      <BlockText text={text} />
    </ViewContext.Provider>
  );
}

// A text as the section's view shows it: plain with highlighted placeholders, or rendered.
export function BlockText({ text }: { text: string }) {
  const { markdown, origin } = useBlockView();
  const shown = origin ? text : stripMarks(text);
  if (markdown) {
    // Tags such as <untrusted_page_content> are text here, not HTML to drop.
    return <div className="prompt-markdown"><Markdown text={afterLinePrefixes(shown).replace(/</g, '&lt;')} rehypePlugins={[rehypeHighlights]} /></div>;
  }
  return <pre>{origin ? <OriginText text={shown} /> : <Highlighted text={shown} />}</pre>;
}

// Marks at the start of a line go after its Markdown prefix ("- ", "## ", "1. "), so they do
// not break list or heading syntax.
const afterLinePrefixes = (s: string) =>
  s.replace(/^([\uE000-\uE00D\uE010-\uE013]+)(\s*(?:[-*+]|\d+[.)]|#{1,6}|>)\s+)/gm, '$2$1');

const PLACEHOLDERS = /(\{[a-z_]+\})/g; // split keeps them at odd indexes

// The same colors inside rendered Markdown: a rehype plugin that splits the text nodes, in
// document order, into <mark> (origin) and <span class="placeholder"> elements.
const element = (tagName: string, className: string, children: HastNode[]): HastNode => ({ type: 'element', tagName, properties: { className: [className] }, children });
function rehypeHighlights() {
  return (tree: HastNode) => {
    const stack: Origin[] = [];
    const split = (value: string): HastNode[] =>
      originRuns(value, stack).flatMap(({ text, origin, cut }) => {
        if (cut) return [{ ...element('span', 'cut-mark', [{ type: 'text', value: CUT_LABEL }]), properties: { className: ['cut-mark'], title: cut } }];
        const parts = text.split(PLACEHOLDERS).map((c, i): HastNode => (i % 2 ? element('span', 'placeholder', [{ type: 'text', value: c }]) : { type: 'text', value: c }));
        return origin ? [element('mark', originClass(origin), parts)] : parts;
      });
    const walk = (node: HastNode) => {
      if (!node.children) return;
      node.children = node.children.flatMap((child) => (child.type === 'text' ? split(child.value ?? '') : (walk(child), [child])));
    };
    walk(tree);
  };
}

// Plain text colored by origin.
function OriginText({ text }: { text: string }) {
  return (
    <>
      {originRuns(text).map(({ text: run, origin, cut }, i) =>
        cut ? <CutMark key={i} detail={cut} /> : origin ? <mark key={i} className={originClass(origin)}>{run}</mark> : <Highlighted key={i} text={run} showLeadingBreaks={i === 0} />,
      )}
    </>
  );
}

const TAGS = /(<\/?[A-Za-z_][\w.-]*(?:\s[^<>]*?)?\/?>)/g; // split keeps them at odd indexes

// Placeholders and XML-like tags (<skill name="…">) in color; a leading line break (texts appended
// to others) as a visible ↵.
function Highlighted({ text, showLeadingBreaks = true }: { text: string; showLeadingBreaks?: boolean }) {
  const breaks = showLeadingBreaks ? (text.match(/^\n+/)?.[0].length ?? 0) : 0;
  const placeholders = (s: string) => s.split(PLACEHOLDERS).map((chunk, i) => (i % 2 ? <span key={i} className="placeholder">{chunk}</span> : chunk));
  return (
    <>
      {breaks > 0 && <span className="muted" title="Starts with a line break">{'↵'.repeat(breaks)}</span>}
      {text.slice(breaks).split(TAGS).map((chunk, i) => (i % 2 ? <span key={i} className="xml-tag">{placeholders(chunk)}</span> : <Fragment key={i}>{placeholders(chunk)}</Fragment>))}
    </>
  );
}
