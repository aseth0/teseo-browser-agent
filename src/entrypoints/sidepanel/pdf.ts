// A PDF you attach (useAttachments): its pages' text, or, when no page has any (a scan), its first
// pages rendered as images. pdfjs-dist loads only then; its worker is one of the extension's files and
// so is its data (cmaps, standard fonts, wasm decoders: wxt.config.ts copies them to pdfjs/), read from
// the page's own origin, which the floating chat's frame shares.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PdfContent } from '../../context/attached-file';
import { hasText, scanNote } from '../../core/pdf-pages';

export const MAX_PDF = 20 * 1024 * 1024; // a PDF this big is not read at all
export const isPdf = (f: Blob) => f.type === 'application/pdf' || (f instanceof File && f.name.toLowerCase().endsWith('.pdf'));

// What a PDF gives: its content for the model (none: nothing to attach), the pages rendered (a scan),
// and the note for you, if any.
export interface PdfRead { pdf?: PdfContent; images: Blob[]; note?: string }

// `room`: how many images may still go with the message, of the `max` per message; `side`: their longest.
export async function readPdf(blob: Blob, name: string, { room, max, side }: { room: number; max: number; side: number }): Promise<PdfRead> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const data = new URL('/pdfjs/', location.href).href;
  const task = pdfjs.getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
    cMapUrl: `${data}cmaps/`,
    standardFontDataUrl: `${data}standard_fonts/`,
    wasmUrl: `${data}wasm/`,
    iccUrl: `${data}iccs/`,
    enableXfa: false,
  });
  try {
    let doc: PDFDocumentProxy;
    try {
      doc = await task.promise;
    } catch (e) {
      const why = e instanceof Error ? e.name : '';
      if (why === 'PasswordException') return { images: [], note: `"${name}" is password-protected and cannot be read.` };
      if (why === 'InvalidPDFException') return { images: [], note: `"${name}" could not be read: the PDF is damaged.` };
      throw e;
    }
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) pages.push(await pageText(doc, n));
    if (hasText(pages)) return { pdf: { pages }, images: [] };
    const images: Blob[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, room); n++) {
      try {
        images.push(await renderPage(doc, n, side));
      } catch {
        // a page that cannot be rendered is left out
      }
    }
    const note = scanNote(name, { shown: images.length, pages: doc.numPages, room, max });
    return { ...(images.length ? { pdf: { scanned: { shown: images.length, pages: doc.numPages } } } : {}), images, ...(note && { note }) };
  } finally {
    void task.destroy();
  }
}

async function pageText(doc: PDFDocumentProxy, n: number): Promise<string> {
  const page = await doc.getPage(n);
  const content = await page.getTextContent();
  page.cleanup();
  return content.items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : '')).join('');
}

// The page at a scale that fits it within `side` (shrinkImage then makes it a JPEG).
async function renderPage(doc: PDFDocumentProxy, n: number, side: number): Promise<Blob> {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: side / Math.max(base.width, base.height) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({ canvas, viewport }).promise;
  page.cleanup();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The page could not be rendered.'))), 'image/png'));
}
