// An answer's Markdown as a voice should read it: what is said, without its marks. Code blocks, images
// and tables' rules go; a link is its text; headings, lists, quotes, emphasis and inline code lose their
// marks. Not a Markdown parser: what reads well aloud.
export function speakable(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?(```|$)/g, ' ') // code blocks: not read
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links: their text
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+(.*)$/gm, '$1.') // a heading: a sentence of its own
    .replace(/^[ \t]*\|?([ \t]*:?-{3,}:?[ \t]*\|)+[ \t]*:?-*:?[ \t]*\|?[ \t]*$/gm, '') // a table's rule
    .replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, (_, cells: string) => cells.split('|').map((c) => c.trim()).join(', ')) // a row: its cells
    .replace(/^[ \t]*>[ \t]?/gm, '') // quotes
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, '') // list marks
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/g, '$1$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^[ \t]*(?:-{3,}|\*{3,})[ \t]*$/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
