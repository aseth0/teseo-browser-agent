// Marks of the size limits (core/limits): on what has one (✂ and the limit; what happens past it
// on hover, next to the "model" mark), and where a message was cut. The limits are listed, and some
// changed, in Settings → Limits.
import { LIMIT_DEFS, limitText, type LimitId } from '../core/limits';

// What has a limit.
export function LimitMark({ id }: { id: LimitId }) {
  const def = LIMIT_DEFS[id];
  const where = def.range ? 'Change it in Settings → Limits.' : 'Listed in Settings → Limits.';
  return (
    <span className="limit-mark" title={`${def.label}: at most ${limitText(id)}. Past it: ${def.over}. ${where}`} aria-hidden="true">
      ✂ {limitText(id)}
    </span>
  );
}

// Where a message was cut to a limit: which limit and how much, on hover.
export const CUT_LABEL = '✂ cut';
export const CutMark = ({ detail }: { detail: string }) => <span className="cut-mark" title={detail}>{CUT_LABEL}</span>;
