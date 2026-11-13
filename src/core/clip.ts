// Content cut to fit, as returned by the page: the marker is added in core/truncate so it can be
// edited. No imports: the page script (content/) uses it without the model's texts.
export interface Clipped {
  text: string;
  truncated: boolean;
  total?: number; // the length before the cut (also when read from a `from`)
  max?: number; // where it was cut
  end?: number; // where the next part starts, when cut: `from` plus what is shown
}

// Never between the two halves of a character outside the basic plane (an emoji, a CJK extension).
// `from`: the character to start from, to read on after a cut (none, or past the end: none left).
export const clip = (s: string, max: number, from = 0): Clipped => {
  const start = Number.isFinite(from) ? Math.min(Math.max(0, Math.floor(from)), s.length) : 0;
  const rest = start ? s.slice(start) : s;
  if (rest.length <= max) return { text: rest, truncated: false, ...(start > 0 && { total: s.length }) };
  const end = max > 0 && /[\uD800-\uDBFF]/.test(rest[max - 1]!) ? max - 1 : max;
  return { text: rest.slice(0, end), truncated: true, total: s.length, max, end: start + end };
};
