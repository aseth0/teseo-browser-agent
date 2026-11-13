// What changes between two texts, line by line, as the review card shows it: "+ " a line added,
// "− " one removed, "  " one kept. Folded, the kept lines far from a change are one "⋯" line.

export const ADDED = '+ ';
export const REMOVED = '− ';
const KEPT = '  ';
const CONTEXT = 2; // kept lines shown around a change when folded

const linesOf = (s: string) => (s === '' ? [] : s.split('\n'));

// The lines of both, each with its mark, in order (longest common subsequence, after the common
// start and end).
function marked(before: string[], after: string[]): string[] {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  const a = before.slice(start, before.length - end);
  const b = after.slice(start, after.length - end);
  // lcs[i][j]: the longest common subsequence of a[i..] and b[j..].
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  }
  const middle: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      middle.push(KEPT + a[i++]);
      j++;
    } else if (i < a.length && (j === b.length || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) middle.push(REMOVED + a[i++]);
    else middle.push(ADDED + b[j++]);
  }
  return [...before.slice(0, start).map((l) => KEPT + l), ...middle, ...after.slice(after.length - end).map((l) => KEPT + l)];
}

// Kept lines more than CONTEXT away from a change, as one line saying how many.
function folded(lines: string[]): string[] {
  const near = lines.map((l, i) => !l.startsWith(KEPT) || lines.slice(Math.max(0, i - CONTEXT), i + CONTEXT + 1).some((m) => !m.startsWith(KEPT)));
  const out: string[] = [];
  let hidden = 0;
  lines.forEach((l, i) => {
    if (near[i]) {
      if (hidden) out.push(`⋯ ${hidden} unchanged line${hidden === 1 ? '' : 's'}`);
      hidden = 0;
      out.push(l);
    } else hidden++;
  });
  if (hidden) out.push(`⋯ ${hidden} unchanged line${hidden === 1 ? '' : 's'}`);
  return out;
}

export function lineDiff(before: string, after: string, fold = false): string {
  const lines = marked(linesOf(before), linesOf(after));
  return (fold ? folded(lines) : lines).join('\n');
}
