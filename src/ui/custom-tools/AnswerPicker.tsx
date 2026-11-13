// A tried request's JSON answer as nested lists whose keys are clicked to build "Answer cut to" (the
// request's extract), with how much smaller the answer gets. A list shows its first element only: a
// key picked there stands for that key of each one.
import { useMemo, useRef } from 'react';
import { pickOf, picksOf, pickState, togglePick, type Pick } from '../../tools/custom/extract-picks';
import { isObject } from '../../core/util';
import { extractPath } from '../../tools/http';

const MAX_DEPTH = 8;
const MAX_KEYS = 200; // of one object: a map of thousands is not drawn whole

// The JSON in the answer text, or undefined when it is not JSON.
export function parseAnswer(raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

// A length in characters, as the limits count them.
export const charsText = (chars: number) => `${chars.toLocaleString('en')} ${chars === 1 ? 'character' : 'characters'}`;

// The answer as the model gets it with that extract (as tools/http reads it), from the JSON read once;
// undefined when the path finds nothing.
export function cutAnswer(json: unknown, raw: string, extract: string | undefined): string | undefined {
  const path = extract?.trim();
  if (!path || json === undefined) return raw;
  const found = extractPath(json, path);
  if (found === undefined) return undefined;
  return typeof found === 'string' ? found : JSON.stringify(found, null, 1);
}

export function AnswerPicker({ json, rawLength, cutLength, extract, onExtract }: {
  json: unknown;
  rawLength: number;
  cutLength: number | undefined; // undefined: nothing at the path
  extract: string;
  onExtract: (extract: string | undefined) => void;
}) {
  const picks = picksOf(extract);
  // The tree is drawn again only when the answer or the picks change; a click reads the extract as
  // it is then.
  const latest = useRef({ extract, picks, onExtract });
  latest.current = { extract, picks, onExtract };
  const approximate = useRef(false);
  const key = picks ? JSON.stringify(picks) : '';
  const tree = useMemo(() => {
    const pick = (path: (string | number)[]) => {
      const p = pickOf(path);
      if (!p) return;
      const now = latest.current;
      const next = togglePick(now.picks ? now.extract : '', p);
      approximate.current = next.approximate;
      now.onExtract(next.extract || undefined);
    };
    return <JsonNode value={json} path={[]} picks={latest.current.picks ?? []} onPick={pick} depth={0} />;
  }, [json, key]); // eslint-disable-line react-hooks/exhaustive-deps -- the picks are read through `key`
  return (
    <div className="answer-picker">
      <p className="hint">Click the keys the model needs: the answer is cut to them. In a list, a key stands for that key of each element.</p>
      <div className="json-tree">{tree}</div>
      <p className="hint" role="status">
        {cutLength === undefined
          ? `Nothing at ${extract}: the model would be told so, with the keys there are.`
          : extract.trim()
            ? `${charsText(rawLength)} → ${charsText(cutLength)}${rawLength ? ` (${Math.max(0, Math.round((1 - cutLength / rawLength) * 100))}% smaller)` : ''}.`
            : `The whole answer: ${charsText(rawLength)}.`}
        {approximate.current && extract.trim() ? ' A key picked deeper than the others keeps all of its parent key.' : ''}
        {!picks && extract.trim() ? ' Written by hand: clicking a key starts again from it.' : ''}
      </p>
    </div>
  );
}

type NodeProps = { value: unknown; path: (string | number)[]; picks: Pick[]; onPick: (path: (string | number)[]) => void; depth: number };

function JsonNode({ value, path, picks, onPick, depth }: NodeProps) {
  if (Array.isArray(value)) {
    if (!value.length) return <span className="muted">[ ] empty list</span>;
    return (
      <>
        <span className="muted small">list of {value.length}{value.length > 1 ? ', the first shown' : ''}</span>
        {depth < MAX_DEPTH ? <ul><li><JsonNode value={value[0]} path={[...path, 0]} picks={picks} onPick={onPick} depth={depth + 1} /></li></ul> : null}
      </>
    );
  }
  if (!isObject(value)) return <Scalar value={value} />;
  if (depth >= MAX_DEPTH) return <span className="muted">{'{…}'}</span>;
  const entries = Object.entries(value);
  return (
    <ul>
      {entries.slice(0, MAX_KEYS).map(([k, v]) => {
        const at = [...path, k];
        const p = pickOf(at);
        const state = p && pickState(p, picks);
        const nested = Array.isArray(v) || isObject(v);
        const title = !p ? 'A key with . , [ ] or braces, or of digits only, cannot be picked'
          : state === 'inside' ? 'Kept with the key it is in: click that key to leave it out first'
          : state === 'picked' ? 'Picked: click to leave it out'
          : 'Keep this key';
        return (
          <li key={k}>
            <button type="button" className="json-key mono" data-state={state} disabled={!p || state === 'inside'} aria-pressed={state === 'picked'} title={title} onClick={() => onPick(at)}>
              {k}
            </button>
            {nested ? <JsonNode value={v} path={at} picks={picks} onPick={onPick} depth={depth + 1} /> : <Scalar value={v} />}
          </li>
        );
      })}
      {entries.length > MAX_KEYS && <li className="json-more">… and {entries.length - MAX_KEYS} more keys (type one in Answer cut to)</li>}
    </ul>
  );
}

function Scalar({ value }: { value: unknown }) {
  const text = JSON.stringify(value) ?? String(value);
  return <span className="json-value mono">{text.length > 80 ? `${text.slice(0, 80)}…` : text}</span>;
}
