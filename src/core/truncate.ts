import { clip, type Clipped } from './clip';
import { cutDetail, limit, type LimitId } from './limits';
import { cutNote } from './origin-marks';
import { text } from './texts/registry';

// The text with the marker for the model when it was cut, and the note of the limit for the views.
export const withMarker = (c: Clipped, limitId: LimitId, marker: 'result.truncated' | 'result.snapshot_truncated' = 'result.truncated') =>
  c.truncated ? c.text + cutNote(cutDetail(limitId, c.total, c.max)) + text(marker) : c.text;

export const truncate = (s: string, limitId: LimitId, max = limit(limitId)) => withMarker(clip(s, max), limitId);

// Cut where the tool reads on when called again with `from` (browser.get_page_text, web.read): the
// note says from where.
export const withReadOn = (c: Clipped, limitId: LimitId) =>
  c.truncated ? c.text + cutNote(cutDetail(limitId, c.total, c.end)) + text('result.cut_from', { shown: String(c.end), total: String(c.total) }) : c.text;

// What a tool that reads on from `from` gives: the text with its note when cut. Past the end: an error.
export function readOn(c: Clipped, limitId: LimitId, from?: number): string {
  if (from && from > 0 && !c.text && c.total !== undefined) throw new Error(pastEnd(from, c.total));
  return withReadOn(c, limitId);
}

// A concrete error, for a `from` at or past the end of the text.
export const pastEnd = (from: number, total: number) => `Nothing to read from ${from}: the text has ${total} characters.`;

// Cut where tools.read_more reads on, by the `id` its note gives (core/kept-results keeps the rest).
export const withReadMore = (c: Clipped, limitId: LimitId, id: string) =>
  c.truncated ? c.text + cutNote(cutDetail(limitId, c.total, c.end)) + text('result.cut_read_more', { shown: String(c.end), total: String(c.total), id }) : c.text;

// The latest `max` characters of a text, from a line's start when one is near: what is cut is the
// oldest part (a transcript to summarize).
export function keepLatest(s: string, max: number): string {
  if (s.length <= max) return s;
  const tail = s.slice(-max);
  const line = tail.indexOf('\n');
  return line >= 0 && line < max / 10 ? tail.slice(line + 1) : tail;
}
