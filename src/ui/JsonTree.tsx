// JSON as a tree: each object and array folds under its key, with how many entries it has; values in
// the syntax colors of the code blocks (markdown.css). The first levels start open.
import type { ReactNode } from 'react';

const OPEN_DEPTH = 3; // levels open at first

export function JsonTree({ value }: { value: unknown }) {
  return <div className="json-tree"><Node value={value} depth={0} /></div>;
}

function Node({ name, value, depth, last = true }: { name?: string; value: unknown; depth: number; last?: boolean }) {
  const key = name !== undefined && <><span className="hljs-attr">{JSON.stringify(name)}</span>: </>;
  const comma = last ? '' : ',';
  if (value === null || typeof value !== 'object') return <div className="json-line">{key}<Scalar value={value} />{comma}</div>;
  const entries: [string | undefined, unknown][] = Array.isArray(value) ? value.map((v) => [undefined, v]) : Object.entries(value);
  const [open, close] = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
  if (!entries.length) return <div className="json-line">{key}{open}{close}{comma}</div>;
  const count = `${entries.length} ${Array.isArray(value) ? (entries.length === 1 ? 'item' : 'items') : entries.length === 1 ? 'key' : 'keys'}`;
  return (
    <details className="json-node" open={depth < OPEN_DEPTH}>
      <summary className="json-line">{key}{open}<span className="json-fold muted"> {count} {close}{comma}</span></summary>
      <div className="json-children">
        {entries.map(([k, v], i) => <Node key={k ?? i} name={k} value={v} depth={depth + 1} last={i === entries.length - 1} />)}
      </div>
      <div className="json-line">{close}{comma}</div>
    </details>
  );
}

function Scalar({ value }: { value: unknown }): ReactNode {
  if (typeof value === 'string') return <span className="hljs-string">{JSON.stringify(value)}</span>;
  if (typeof value === 'number') return <span className="hljs-number">{String(value)}</span>;
  return <span className="hljs-literal">{JSON.stringify(value) ?? 'undefined'}</span>;
}
