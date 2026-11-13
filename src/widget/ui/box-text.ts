import type { OutputLine } from '../actions';

// What a box's Copy puts in the clipboard, as Markdown: its text as it came, or its lines as a list
// (a line with a link as a Markdown link).
export function boxText(box: { lines: OutputLine[]; text?: string }): string {
  if (!box.lines.length) return box.text?.trim() ?? '';
  return box.lines.map((l) => `- ${l.href ? `[${l.text.replace(/[[\]]/g, '\\$&')}](${l.href.replace(/[()]/g, (c) => (c === '(' ? '%28' : '%29'))})` : l.text}`).join('\n');
}
