// A language's reading rules (speech/spoken): how its numbers and units are said, as data. A text-to-speech
// model reads digits well, but not the marks between them nor the short units after them.
export interface ReadingRules {
  // A unit written right after a number ("45 ms", "30%"), as it is said: one of it, and several.
  units: Record<string, readonly [one: string, many: string]>;
  // The mark between thousands ("1.000.000", read as 1000000); none: no thousands are joined.
  thousands?: '.' | ',';
  // A decimal mark as it is said ("0,26" → "0 coma 26"), and the word for a leading zero after it.
  decimal: { ',': string; '.': string; zero: string };
}
