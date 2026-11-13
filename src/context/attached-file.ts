// A file you attach to a message (the paperclip → File…): its block for the model, cut to Settings →
// Limits with a note, and the part it goes as. When cut, the whole file goes with the message for the
// background to keep (core/kept-results), so tools.read_more reads on. A PDF goes as its pages' text,
// cut at a page's start when it can; one without text as a note that its pages go as images. A tab's
// audio transcribed (background/audio-host) goes as a file does, in its own block.
import type { AudioAttach } from '../audio/protocol';
import { clock } from '../audio/transcript';
import { cutForReadMore, type KeptText } from '../core/kept-results';
import { text } from '../core/model-texts';
import { markPageData } from '../core/origin-marks';
import { pageRange, pdfText } from '../core/pdf-pages';
import type { Part } from '../core/types';
import { fileSource, pdfSource } from './sources';

export function fileBlock(name: string, content: string, { source = fileSource(name), breaks }: { source?: string; breaks?: number[] } = {}): { block: string; kept?: KeptText } {
  // Past the limit: the model is told where it was cut and how to read on, the views mark where.
  const cut = cutForReadMore(content, 'attachedFile', source, { breaks });
  return { block: text('file.block', { name, text: cut.text }), ...(cut.kept && { kept: cut.kept }) };
}

export function filePart(name: string, content: string): { part: Part; kept?: KeptText } {
  const { block, kept } = fileBlock(name, content);
  return { part: { type: 'text', context: 'page', source: fileSource(name), text: block }, ...(kept && { kept }) };
}

// A PDF read (entrypoints/sidepanel/pdf): its pages' text, or, with none, how many of its pages go as images.
export type PdfContent = { pages: string[] } | { scanned: { shown: number; pages: number } };

export function pdfPart(name: string, pdf: PdfContent): { part: Part; kept?: KeptText } {
  const source = pdfSource(name);
  const part = (block: string): Part => ({ type: 'text', context: 'page', source, text: block });
  if ('scanned' in pdf) {
    const { shown, pages } = pdf.scanned;
    return { part: part(text('file.block', { name, text: text('pdf.scanned', { shown: pageRange(shown), pages: String(pages) }) })) };
  }
  const { text: content, breaks } = pdfText(pdf.pages);
  const { block, kept } = fileBlock(name, content, { source, breaks });
  return { part: part(block), ...(kept && { kept }) };
}

// The block a saved conversation keeps in place of a PDF's: its name, not its content.
export const pdfNotKept = (name: string) => text('file.block', { name, text: text('pdf.not_kept') });

// Its lines, each after its time, and a note in place of each stretch not transcribed. What was said
// on the page is the page's: marked so, its untrusted tags neutralized.
export function audioPart(a: AudioAttach): { part: Part; kept?: KeptText } {
  const lines = a.lines.map((l) => ('gap' in l ? text('audio.gap', { from: clock(l.at), to: clock(l.to) }) : `[${clock(l.at)}] ${markPageData(l.text)}`));
  const source = fileSource(a.name);
  const cut = cutForReadMore(lines.join('\n'), 'tabAudio', source);
  const block = text('audio.block', { site: a.site, duration: clock(a.seconds), transcript: cut.text });
  return { part: { type: 'text', context: 'page', source, text: block }, ...(cut.kept && { kept: cut.kept }) };
}
