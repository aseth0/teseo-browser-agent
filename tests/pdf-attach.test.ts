// A PDF attached to a message: its pages' text with their markers, cut at a page's start when it can,
// read on page by page; one without text goes as images of its pages; a saved conversation keeps its name only.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', async () => (await import('./fakes/browser')).emptyBrowser());
const { pdfPart } = await import('../src/context/attached-file');
const { attachedByYou, fileOf, pdfOf } = await import('../src/context/sources');
const { clearKept, keep, readKept } = await import('../src/core/kept-results');
const { stripMarks } = await import('../src/core/model-texts');
const { setLimitOverrides } = await import('../src/core/limits');
const { hasText, pageRange, pdfText, scanNote } = await import('../src/core/pdf-pages');
const { keptHistory } = await import('../src/history/store');
type Message = import('../src/core/types').Message;

afterEach(() => {
  setLimitOverrides({});
  clearKept();
});

const blockText = (p: { type: string; text?: string }) => stripMarks(p.text ?? '');

describe('the pages of a PDF', () => {
  it('each go after a line with its number, and where each starts is a break', () => {
    const { text, breaks } = pdfText(['First page.', 'Second page.']);
    expect(text).toBe('[Page 1 of 2]\nFirst page.\n\n[Page 2 of 2]\nSecond page.');
    expect(breaks).toEqual([0, text.indexOf('[Page 2 of 2]')]);
  });

  it('have text when any page has some beyond spaces', () => {
    expect(hasText(['', ' \n ', ''])).toBe(false);
    expect(hasText([])).toBe(false);
    expect(hasText(['', 'a'])).toBe(true);
  });

  it('shown as a range', () => {
    expect(pageRange(1)).toBe('1');
    expect(pageRange(5)).toBe('1–5');
  });
});

describe('an attached PDF with text', () => {
  const pages = (n: number, size: number) => Array.from({ length: n }, (_, i) => String.fromCharCode(97 + i).repeat(size));

  it('goes whole within its limit, as a file named by it', () => {
    const { part, kept } = pdfPart('report.pdf', { pages: ['Hello from example.com.'] });
    expect(blockText(part)).toBe('<attached_file name="report.pdf">\n[Page 1 of 1]\nHello from example.com.\n</attached_file>');
    expect(part).toMatchObject({ type: 'text', context: 'page', source: 'pdf:report.pdf' });
    expect(kept).toBeUndefined();
    expect(fileOf('pdf:report.pdf')).toBe('report.pdf');
    expect(pdfOf('pdf:report.pdf')).toBe('report.pdf');
    expect(pdfOf('file:report.pdf')).toBeUndefined();
    expect(attachedByYou('pdf:report.pdf')).toBe(true);
  });

  it('is cut at the start of the last page that fits, when it is in the limit\'s second half', () => {
    setLimitOverrides({ attachedFile: 2000 });
    const { part, kept } = pdfPart('long.pdf', { pages: pages(5, 600) });
    const block = blockText(part);
    expect(block).toContain('[Page 3 of 5]');
    expect(block).not.toContain('[Page 4 of 5]');
    expect(block).toContain('c'.repeat(600));
    expect(kept!.next).toBe(kept!.text.indexOf('[Page 4 of 5]'));
    expect(block).toContain(`…[cut at ${kept!.next} of ${kept!.text.length} characters: tools__read_more with id "${kept!.id}" reads on]`);
  });

  it('is cut at the limit when no page starts in its second half', () => {
    setLimitOverrides({ attachedFile: 2000 });
    const { kept } = pdfPart('dense.pdf', { pages: pages(2, 3000) });
    expect(kept!.next).toBe(2000);
  });

  it('is read on page by page', () => {
    setLimitOverrides({ attachedFile: 2000 });
    const { kept } = pdfPart('long.pdf', { pages: pages(8, 600) });
    keep('c1', kept!);
    const next = readKept('c1', kept!.id, 2000);
    expect(next?.source).toBe('pdf:long.pdf');
    const part = stripMarks(next!.part);
    expect(part.startsWith('[Page 4 of 8]\n')).toBe(true);
    expect(part).toContain('[Page 6 of 8]');
    expect(part).not.toContain('[Page 7 of 8]');
  });
});

describe('an attached PDF without text', () => {
  it('says which of its pages go as images', () => {
    const { part, kept } = pdfPart('scan.pdf', { scanned: { shown: 3, pages: 12 } });
    expect(blockText(part)).toBe('<attached_file name="scan.pdf">\nThis PDF has no text layer: pages 1–3 of 12 are attached as images.\n</attached_file>');
    expect(kept).toBeUndefined();
  });
});

describe('a saved conversation with a PDF', () => {
  it('keeps its name, not its text', () => {
    const { part } = pdfPart('report.pdf', { pages: ['Secret-free text from example.com.'] });
    const message: Message = { role: 'user', parts: [{ type: 'text', text: 'summarize it' }, part, { type: 'image', mediaType: 'image/jpeg', data: 'AAAA' }] };
    const [saved] = keptHistory([message]);
    expect(blockText(saved!.parts[1]!)).toBe('<attached_file name="report.pdf">\n[PDF not kept in the saved conversation: ask the user to attach it again]\n</attached_file>');
    expect(saved!.parts[1]).toMatchObject({ source: 'pdf:report.pdf', context: 'page' });
    expect(saved!.parts[2]).toMatchObject({ data: '' });
  });

  it('keeps a text file as before', () => {
    const message: Message = { role: 'user', parts: [{ type: 'text', context: 'page', source: 'file:a.md', text: 'whole' }] };
    expect(keptHistory([message])[0]).toBe(message);
  });
});

describe('scanNote', () => {
  it('says nothing was attached when no image can go with the message', () => {
    expect(scanNote('scan.pdf', { shown: 0, pages: 12, room: 0, max: 5 }))
      .toBe('"scan.pdf" has no text, and no more images fit in this message (at most 5, Settings → Limits): nothing attached.');
  });
  it('says the pages could not be rendered when there was room', () => {
    expect(scanNote('scan.pdf', { shown: 0, pages: 12, room: 3, max: 5 })).toBe('"scan.pdf" has no text and its pages could not be rendered: nothing attached.');
  });
  it('says how many pages go as images when some are left out', () => {
    expect(scanNote('scan.pdf', { shown: 3, pages: 12, room: 3, max: 5 }))
      .toBe('"scan.pdf" has no text: 3 of its 12 pages go as images, at most 5 images per message (Settings → Limits).');
  });
  it('says nothing when every page goes', () => {
    expect(scanNote('scan.pdf', { shown: 2, pages: 2, room: 3, max: 5 })).toBeUndefined();
  });
});
