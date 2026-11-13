// The model's headings folded and unfolded (markdown/sections groups them): what is folded is kept
// here, above what Markdown renders, so that no streamed token loses it.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import type { Components, ExtraProps } from 'react-markdown';
import { textOf, type HastNode } from '../markdown/tree';

type Folds = { folded: ReadonlySet<number>; toggle: (heading: number) => void };
export const FoldsContext = createContext<Folds | undefined>(undefined);

const NONE: ReadonlySet<number> = new Set();

// What is folded by text, for as long as the panel is open. The answer that streamed is shown anew
// once it is a message of the history, and a conversation when you come back to it; these are the
// same text, or, when its last tokens came along with the message, more of it.
const REMEMBERED = 200;
const remembered = new Map<string, ReadonlySet<number>>();
function recall(text: string): ReadonlySet<number> {
  const exact = remembered.get(text);
  if (exact) return exact;
  let best: string | undefined;
  for (const key of remembered.keys()) if (text.startsWith(key) && key.length > (best?.length ?? 0)) best = key;
  return best === undefined ? NONE : remembered.get(best)!;
}

// What is folded in this text, and how to change it: for as long as the text only grows; another
// text (a message regenerated in its place) has its own.
export function useFolds(text: string): Folds {
  const [own, setOwn] = useState(() => ({ of: text, folded: recall(text) }));
  const folded = text.startsWith(own.of) ? own.folded : recall(text);
  const kept = useRef<string | undefined>(undefined);
  useEffect(() => {
    // A text that grows moves its entry along. All unfolded, it needs one only where a shorter text
    // would otherwise answer for it.
    if (kept.current !== undefined) remembered.delete(kept.current);
    kept.current = folded.size || recall(text).size ? text : undefined;
    if (kept.current === undefined) return;
    remembered.set(text, folded);
    if (remembered.size > REMEMBERED) remembered.delete(remembered.keys().next().value!);
  }, [text, folded]);
  return useMemo(() => ({
    folded,
    toggle: (heading: number) => {
      const next = new Set(folded);
      if (!next.delete(heading)) next.add(heading);
      setOwn({ of: text, folded: next });
    },
  }), [text, folded]);
}

// The place foldSections gave a heading or its section, if it did.
const foldOf = (node: HastNode | undefined): number | undefined => {
  const fold = node?.properties?.dataFold;
  return typeof fold === 'number' ? fold : undefined;
};

function FoldSection({ node, children }: ComponentProps<'section'> & ExtraProps) {
  const folds = useContext(FoldsContext);
  const fold = foldOf(node);
  const folded = fold !== undefined && folds?.folded.has(fold);
  return <section className={`fold-section${folded ? ' folded' : ''}`}>{children}</section>;
}

const foldHeading = (Tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') => function FoldHeading({ node, children, ...props }: ComponentProps<typeof Tag> & ExtraProps) {
  const folds = useContext(FoldsContext);
  const fold = foldOf(node);
  if (!folds || fold === undefined) return <Tag {...props}>{children}</Tag>;
  const folded = folds.folded.has(fold);
  return (
    <Tag {...props} data-fold={undefined}>
      <button type="button" className="fold-toggle" aria-expanded={!folded} aria-label={`${folded ? 'Unfold' : 'Fold'} ${textOf(node!)}`} onClick={() => folds.toggle(fold)} />
      {children}
    </Tag>
  );
};

export const FOLD_COMPONENTS: Components = {
  section: FoldSection,
  h1: foldHeading('h1'),
  h2: foldHeading('h2'),
  h3: foldHeading('h3'),
  h4: foldHeading('h4'),
  h5: foldHeading('h5'),
  h6: foldHeading('h6'),
};
