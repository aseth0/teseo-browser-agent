// A text read while it is still being written (an answer as it streams): which of its pieces are final.
// The voice starts once the first piece is (its size: Settings → Speak → First piece), and each next one
// is sent once nothing more can join it, so what was sent never changes. A piece is final once a sentence
// after it is complete, or once the sentence being written already would not fit in it; the last one only
// once the text is done. A sentence still being written is never read.
import { pieces } from './pieces';
import { spoken } from './spoken';
import { rulesFor } from './languages';
import type { PlanOptions, PlannedPiece } from './plan';

// Where the last whole sentence of `text` ends (as speech/pieces splits them: its mark before a space, or
// a line break); 0: none yet.
export function wholeSentencesEnd(text: string): number {
  let end = 0;
  for (const m of text.matchAll(/[.!?…]["»)\]]*(?=\s)|\n/g)) end = m.index + m[0].length;
  return end;
}

// The pieces of `text` that are final; all of them when it is `done`.
export function finalPieces(text: string, done: boolean, first: number, rest: number): string[] {
  if (done) return pieces(text, first, rest);
  const stable = wholeSentencesEnd(text);
  const parts = pieces(text.slice(0, stable), first, rest);
  const last = parts.at(-1);
  if (!last) return [];
  const tail = text.slice(stable).trim();
  const limit = parts.length === 1 ? first : rest;
  return tail && last.length + 1 + tail.length > limit ? parts : parts.slice(0, -1);
}

const ENDS_SENTENCE = /[.!?…]["»)\]]*$/;
// Those pieces from `from` on, as said (speech/plan); one that stops inside a sentence has its closing
// silence trimmed, the next one going on with it (the last of a text done does not).
export function plannedFrom(parts: string[], from: number, done: boolean, o: Pick<PlanOptions, 'language' | 'pairs'>): PlannedPiece[] {
  const rules = rulesFor(o.language);
  return parts.slice(from).map((part, k) => {
    const i = from + k;
    const lastOfAll = done && i === parts.length - 1;
    return { input: spoken(part, (o.pairs ?? []), rules), trim: !lastOfAll && !ENDS_SENTENCE.test(part) };
  });
}
