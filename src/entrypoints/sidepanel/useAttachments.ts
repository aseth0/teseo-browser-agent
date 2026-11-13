// What you attach to your next message: images, text files and PDFs from the paperclip's File…, pasted
// or dropped, or a screenshot of the page's visible tab, whole or a section of it dragged on the page;
// a tab's audio transcribed, from the toolbar popup or its review page (background/audio-host).
// Images go as images; a text file as its text (context/attached-file), and a PDF as its pages' text,
// or, with none, as images of its pages (./pdf). Each one made smaller before it goes (Settings → Limits: its longest
// side, and how many per message) and sent as JPEG; saved conversations do not keep them.
import { useState, type ClipboardEvent, type DragEvent } from 'react';
import { browser } from 'wxt/browser';
import { limit } from '../../core/limits';
import type { ImagePayload } from '../../core/types';
import { errorText } from '../../core/errors';
import { shrinkImage } from '../../core/image';
import type { AudioAttach } from '../../audio/protocol';
import type { PdfContent } from '../../context/attached-file';
import { isPdf, MAX_PDF, readPdf } from './pdf';
import { crop, dragArea, type Area } from '../../capture/area';

// Text files by their extension (browsers give many of them no type, or a vague one).
const TEXT_EXTENSIONS = ['txt', 'md', 'markdown', 'json', 'jsonl', 'csv', 'tsv', 'xml', 'yaml', 'yml', 'toml', 'ini', 'log', 'html', 'htm', 'css',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'rb', 'php', 'java', 'kt', 'go', 'rs', 'c', 'h', 'cpp', 'hpp', 'cs', 'swift', 'sh', 'bash', 'zsh', 'sql', 'graphql', 'env.example'];
const isText = (f: Blob) => f.type.startsWith('text/') || /^application\/(json|xml|x-yaml|yaml|javascript|sql)/.test(f.type)
  || (f instanceof File && TEXT_EXTENSIONS.some((x) => f.name.toLowerCase().endsWith(`.${x}`)));
// What File… lets you pick.
export const ATTACHABLE = ['image/*', 'text/*', 'application/pdf', '.pdf', ...TEXT_EXTENSIONS.map((x) => `.${x}`)].join(',');
const MAX_TEXT_FILE = 5 * 1024 * 1024; // a text file this big is not read at all
// A file attached: its name and what it says (cut when it goes, Settings → Limits), a PDF's content,
// or a tab's audio transcribed. `id`: which one, to remove it (and to key it while shown).
export type AttachedFile = { id: string; name: string } & ({ text: string } | { pdf: PdfContent } | { audio: AudioAttach });
// An image attached, with its id as a file's; `of`: the PDF it is a page of, removed with it.
interface AttachedImage { id: string; image: ImagePayload; of?: string }
const MAX_IMAGE = 20 * 1024 * 1024; // a picture this big is not read at all
const tooMany = (max: number, out: number) => `At most ${max} images per message (Settings → Limits): ${out} left out.`;
export function useAttachments() {
  const [images, setImages] = useState<AttachedImage[]>([]);
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [note, setNote] = useState('');

  const add = async (blobs: Blob[]) => {
    const pictures = blobs.filter((b) => b.type.startsWith('image/'));
    const pdfs = blobs.filter((b) => !b.type.startsWith('image/') && isPdf(b));
    const texts = blobs.filter((b) => !b.type.startsWith('image/') && !isPdf(b) && isText(b));
    const notes: string[] = [];
    const others = blobs.length - pictures.length - pdfs.length - texts.length;
    if (others) notes.push(`${others === 1 ? 'A file' : `${others} files`} left out: only images, text files and PDFs can be attached.`);
    const read: AttachedFile[] = [];
    for (const f of texts) {
      const name = f instanceof File ? f.name : 'pasted text';
      if (f.size > MAX_TEXT_FILE) notes.push(`"${name}" is too big (at most ${MAX_TEXT_FILE / 1024 / 1024} MB).`);
      else read.push({ id: crypto.randomUUID(), name, text: await f.text() });
    }
    const max = limit('imagesPerMessage');
    let room = max - images.length;
    if (pictures.length > room) notes.push(tooMany(max, pictures.length - Math.max(0, room)));
    const taken: AttachedImage[] = [];
    for (const b of pictures.slice(0, Math.max(0, room))) {
      if (b.size > MAX_IMAGE) {
        notes.push(`An image of ${Math.round(b.size / 1024 / 1024)} MB is too big (at most ${MAX_IMAGE / 1024 / 1024} MB).`);
        continue;
      }
      try {
        taken.push({ id: crypto.randomUUID(), image: await shrinkImage(b, limit('imageSize')) });
      } catch {
        notes.push('An image could not be read.');
      }
    }
    room -= taken.length;
    for (const f of pdfs) {
      const name = f instanceof File ? f.name : 'pasted PDF';
      if (f.size > MAX_PDF) {
        notes.push(`"${name}" is too big (at most ${MAX_PDF / 1024 / 1024} MB).`);
        continue;
      }
      try {
        const got = await readPdf(f, name, { room: Math.max(0, room), max, side: limit('imageSize') });
        if (got.note) notes.push(got.note);
        if (!got.pdf) continue;
        const id = crypto.randomUUID();
        const pages = await Promise.all(got.images.map((page) => shrinkImage(page, limit('imageSize'))));
        read.push({ id, name, pdf: got.pdf });
        for (const image of pages) taken.push({ id: crypto.randomUUID(), image, of: id });
        room -= pages.length;
      } catch (e) {
        notes.push(`"${name}" could not be read (${errorText(e)}).`);
      }
    }
    if (read.length) setFiles((now) => [...now, ...read]);
    if (taken.length) setImages((now) => [...now, ...taken].slice(0, max));
    setNote(notes.join(' '));
  };

  // Images made smaller already (a screenshot from the popup or a shortcut), as they are, as many as
  // there is room for; `note`: said with them.
  const addImages = (added: ImagePayload[], note?: string) => {
    const max = limit('imagesPerMessage');
    const room = Math.max(0, max - images.length);
    const notes = [added.length > room && tooMany(max, added.length - room), note].filter(Boolean);
    setImages((now) => [...now, ...added.slice(0, room).map((image) => ({ id: crypto.randomUUID(), image }))].slice(0, max));
    setNote(notes.join(' '));
  };

  // A tab's audio transcribed: the one sent before for the same audio (a review sent again) replaced.
  const addAudio = (audio: AudioAttach) =>
    setFiles((now) => [...now.filter((f) => !('audio' in f && f.audio.name === audio.name)), { id: crypto.randomUUID(), name: audio.name, audio }]);

  // The visible part of the page's tab, while it is the one shown in its window; or only the section
  // of it you drag on the page.
  const screenshot = async (tabId: number | undefined, section: boolean) => {
    try {
      if (tabId === undefined) throw new Error('There is no page.');
      const tab = await browser.tabs.get(tabId);
      if (!tab.active) throw new Error('Show the page first: only the visible tab can be captured.');
      let area: Area | null = null;
      if (section) {
        setNote('Drag over the part of the page to capture (Esc cancels).');
        const [run] = await browser.scripting.executeScript({ target: { tabId }, func: dragArea });
        area = run?.result ?? null;
        setNote('');
        if (!area) return; // cancelled
      }
      const shot = await (await fetch(await browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' }))).blob();
      await add([area ? await crop(shot, area) : shot]);
    } catch (e) {
      setNote(`Could not capture the page (${errorText(e)}). Allowing access to all websites, or opening the panel with the extension's icon, lets it.`);
    }
  };
  const capture = (tabId: number | undefined) => screenshot(tabId, false);
  const captureSection = (tabId: number | undefined) => screenshot(tabId, true);

  // On the message box: images, text files and PDFs pasted (not their names, as text) or dropped there.
  const dropProps = {
    onPaste: (e: ClipboardEvent<HTMLElement>) => {
      const files = [...e.clipboardData.files];
      if (!files.some((f) => f.type.startsWith('image/') || isPdf(f) || isText(f))) return;
      e.preventDefault();
      void add(files);
    },
    onDragOver: (e: DragEvent<HTMLElement>) => e.dataTransfer.types.includes('Files') && e.preventDefault(),
    onDrop: (e: DragEvent<HTMLElement>) => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      void add([...e.dataTransfer.files]);
    },
  };

  const remove = (id: string) => setImages((now) => now.filter((a) => a.id !== id));
  const removeFile = (id: string) => {
    setFiles((now) => now.filter((f) => f.id !== id));
    setImages((now) => now.filter((a) => a.of !== id));
  };
  // Those sent: what was attached meanwhile (while the earlier turns were compacted) stays.
  const clear = (sent: { id: string }[]) => {
    const ids = new Set(sent.map((x) => x.id));
    setImages((now) => now.filter((a) => !ids.has(a.id)));
    setFiles((now) => now.filter((f) => !ids.has(f.id)));
    setNote('');
  };
  return { images, files, note, say: setNote, add, addImages, addAudio, capture, captureSection, remove, removeFile, clear, dropProps };
}
