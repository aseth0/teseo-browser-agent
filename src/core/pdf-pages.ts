// The text of an attached PDF, read page by page (entrypoints/sidepanel/pdf): each page after a line
// with its number, and where each one starts, for the cuts to fall there (core/kept-results).
import { text } from './texts/registry';

export function pdfText(pages: string[]): { text: string; breaks: number[] } {
  const breaks: number[] = [];
  let out = '';
  pages.forEach((page, i) => {
    if (i) out += '\n\n';
    breaks.push(out.length);
    out += `${text('pdf.page', { page: String(i + 1), pages: String(pages.length) })}\n${page.trim()}`;
  });
  return { text: out, breaks };
}

// A PDF without a text layer (a scan) has none on any page.
export const hasText = (pages: string[]) => pages.some((p) => p.trim() !== '');

// The first `n` pages: "1", or "1–5".
export const pageRange = (n: number) => (n > 1 ? `1–${n}` : '1');

// What you are told of a PDF without text: nothing attached (no room for images, or no page rendered),
// or how many of its pages go as images when not all do. `shown` of its `pages` went, with `room` left
// of the `max` images per message.
export function scanNote(name: string, { shown, pages, room, max }: { shown: number; pages: number; room: number; max: number }): string | undefined {
  if (room <= 0) return `"${name}" has no text, and no more images fit in this message (at most ${max}, Settings → Limits): nothing attached.`;
  if (!shown) return `"${name}" has no text and its pages could not be rendered: nothing attached.`;
  return shown < pages ? `"${name}" has no text: ${shown} of its ${pages} pages go as images, at most ${max} images per message (Settings → Limits).` : undefined;
}
