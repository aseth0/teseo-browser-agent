// A dictated text put into the box at `at`, nothing replaced: a space before and after it where the
// text around is not already whitespace. `caret`: right after the inserted text.
export function insertText(value: string, at: number, text: string): { value: string; caret: number } {
  const i = Math.max(0, Math.min(at, value.length));
  const before = i > 0 && !/\s/.test(value[i - 1]!) ? ' ' : '';
  const after = i < value.length && !/\s/.test(value[i]!) ? ' ' : '';
  return { value: value.slice(0, i) + before + text + after + value.slice(i), caret: i + before.length + text.length };
}
