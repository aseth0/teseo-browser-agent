// A conversation's title may carry Markdown links, [text](url): the history shows them as links, and
// the model gets the title as it is written (only http and https; anything else stays text).
export type TitlePart = string | { text: string; url: string };

const LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;

export function titleParts(title: string): TitlePart[] {
  const parts: TitlePart[] = [];
  let at = 0;
  for (const m of title.matchAll(LINK)) {
    if (m.index > at) parts.push(title.slice(at, m.index));
    parts.push({ text: m[1]!, url: m[2]! });
    at = m.index + m[0].length;
  }
  if (at < title.length) parts.push(title.slice(at));
  return parts;
}

// The title as read: each link by its text (screen readers, confirmations).
export const plainTitle = (title: string) => titleParts(title).map((p) => (typeof p === 'string' ? p : p.text)).join('');
