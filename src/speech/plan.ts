// What a reading asks the model for: the text cut into pieces (speech/pieces), each as it is said
// (speech/spoken), and whether its clip's closing silence is to be trimmed.
import { rulesFor } from './languages';
import { cutPoint, isMidSentence, pieces } from './pieces';
import { spoken, type SpokenPair } from './spoken';

export interface PlannedPiece {
  input: string; // what the model is asked to say
  trim: boolean; // it stops inside a sentence: its closing silence goes
}

export interface PlanOptions {
  first: number;
  rest: number;
  language?: string; // whose reading rules apply (none: none)
  pairs?: readonly SpokenPair[];
}

// A text longer than `max` characters, cut to them at the end of its last whole sentence (past half of
// them; else at a pause or a space: speech/pieces cutPoint), so what is read does not stop mid-word.
export function capped(text: string, max: number): { text: string; cut: boolean } {
  if (text.length <= max) return { text, cut: false };
  const head = text.slice(0, max);
  let end = -1;
  for (const mark of head.matchAll(/[.!?…]["»)\]]*(?=\s)|\n/g)) end = mark.index + mark[0].length;
  return { text: head.slice(0, end > max / 2 ? end : cutPoint(head, max)).trim(), cut: true };
}

export function readingPlan(text: string, o: PlanOptions): PlannedPiece[] {
  const parts = pieces(text, o.first, o.rest);
  const rules = rulesFor(o.language);
  return parts.map((part, i) => ({ input: spoken(part, o.pairs ?? [], rules), trim: isMidSentence(parts, i) }));
}
