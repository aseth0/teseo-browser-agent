// The images and files attached to the next message: shown above the message box, and the buttons that add them.
import { Icon } from '../../ui/chat-icons';
import { useRef, useState } from 'react';
import { menuKeys, useDismiss } from '../../ui/MenuButton';
import { dataUrlOf } from '../../core/types';
import { ATTACHABLE, type AttachedFile, type useAttachments } from './useAttachments';
import { Chip } from '../../ui/Chip';

type Attachments = ReturnType<typeof useAttachments>;

export function AttachmentStrip({ attachments }: { attachments: Attachments }) {
  if (!attachments.images.length && !attachments.files.length && !attachments.note) return null;
  return (
    <div className="attachments">
      {attachments.images.map(({ id, image }, i) => (
        <span key={id} className="attachment">
          <img src={dataUrlOf(image)} alt={`Image ${i + 1}`} />
          <button className="attachment-remove" title="Do not send this image" aria-label={`Remove image ${i + 1}`} onClick={() => attachments.remove(id)}><Icon name="close" size={12} /></button>
        </span>
      ))}
      {attachments.files.map((f) => (
        <Chip key={f.id} className="mention" icon="file" title={fileTitle(f)}
          remove={{ label: `Remove file ${f.name}`, title: 'Do not send this file', onClick: () => attachments.removeFile(f.id) }}>
          {f.name}
        </Chip>
      ))}
      {attachments.note && <span className="muted small">{attachments.note}</span>}
    </div>
  );
}

// What a file's chip says it is: how much goes as text, a PDF's pages that go as images, or a tab's audio.
const count = (n: number, one: string) => `${n.toLocaleString('en-US')} ${one}${n === 1 ? '' : 's'}`;
function fileTitle(f: AttachedFile): string {
  if ('text' in f) return `${count(f.text.length, 'character')}, sent as text`;
  if ('audio' in f) return `A tab's audio, ${count(f.audio.lines.filter((l) => !('gap' in l)).length, 'line')} transcribed, sent as text`;
  if ('scanned' in f.pdf) return `PDF without text: ${count(f.pdf.scanned.shown, 'page')} sent as images`;
  return `PDF, ${count(f.pdf.pages.length, 'page')}, ${count(f.pdf.pages.reduce((n, p) => n + p.trim().length, 0), 'character')}, sent as text`;
}

// The paperclip: a menu with File… (pick files) and Web Screenshot, which unfolds into a screenshot of the
// visible part of the page or of a section of it dragged there.
export function AttachButtons({ attachments, tabId }: { attachments: Attachments; tabId: number | undefined }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [images, setImages] = useState(false); // Web Screenshot unfolded
  const ref = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(false);
    setImages(false);
  };
  useDismiss(ref, open, close);
  const pick = (run: () => void) => () => {
    close();
    run();
  };
  const noPage = tabId === undefined ? 'There is no page' : undefined;
  return (
    <div className="split-button attach-menu" ref={ref}>
      <button className="icon-button" aria-haspopup="menu" aria-expanded={open} title="Attach a file or a screenshot (or paste or drop images in the message box)" aria-label="Attach"
        onClick={() => (open ? close() : setOpen(true))}>
        <Icon name="attach" size={16} />
      </button>
      {open && (
        <div className="split-menu" role="menu" aria-label="Attach" onKeyDown={menuKeys}>
          <button role="menuitem" onClick={pick(() => fileInput.current?.click())}><Icon name="file" /> File…</button>
          <button role="menuitem" aria-haspopup="menu" aria-expanded={images} onClick={() => setImages(!images)}>
            <Icon name="capture" /> Web Screenshot <span className="spacer" />{images ? '▾' : '▸'}
          </button>
          {images && (
            <div className="submenu" role="menu" aria-label="Web Screenshot">
              <button role="menuitem" disabled={!!noPage} title={noPage} onClick={pick(() => void attachments.capture(tabId))}>Take a full screenshot</button>
              <button role="menuitem" disabled={!!noPage} title={noPage} onClick={pick(() => void attachments.captureSection(tabId))}>Take a section screenshot</button>
            </div>
          )}
        </div>
      )}
      <input ref={fileInput} type="file" accept={ATTACHABLE} multiple hidden aria-label="Files to attach" onChange={(e) => {
        void attachments.add([...(e.target.files ?? [])]);
        e.target.value = ''; // the same file can be chosen again
      }} />
    </div>
  );
}
