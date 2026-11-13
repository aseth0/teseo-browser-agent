// Small icon buttons (the label shows on hover) and their icons, shared by the side panel and
// the options page.
import { useState, type ReactNode } from 'react';

export function IconButton(props: { label: string; icon: ReactNode; onClick: () => void; pressed?: boolean; disabled?: boolean }) {
  return (
    <button className="icon-button" title={props.label} aria-label={props.label} aria-pressed={props.pressed} disabled={props.disabled} onClick={props.onClick}>
      {props.icon}
    </button>
  );
}

// What is copied: text, or text with an HTML version (a table pastes as a table where HTML is read).
export type Clip = string | { plain: string; html: string };

// Copies it; in the chat floating on a page, with the old copy command when the page does not let
// the frame write the clipboard. Throws when neither works.
export async function writeClip(clip: Clip) {
  const { plain, html } = typeof clip === 'string' ? { plain: clip, html: undefined } : clip;
  try {
    if (html === undefined) return await navigator.clipboard.writeText(plain);
    const blob = (s: string, type: string) => new Blob([s], { type });
    try {
      return await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob(plain, 'text/plain'), 'text/html': blob(html, 'text/html') })]);
    } catch {
      return await navigator.clipboard.writeText(plain);
    }
  } catch (err) {
    // In the chat floating on a page (a frame there), the page's permissions policy may not let the
    // frame write the clipboard; the old copy command needs only the click.
    if (!copyCommand(plain, html)) throw err;
  }
}

function copyCommand(plain: string, html?: string): boolean {
  const onCopy = (e: ClipboardEvent) => {
    e.clipboardData?.setData('text/plain', plain);
    if (html !== undefined) e.clipboardData?.setData('text/html', html);
    e.preventDefault();
  };
  document.addEventListener('copy', onCopy);
  try {
    return document.execCommand('copy');
  } finally {
    document.removeEventListener('copy', onCopy);
  }
}

// `text`: a function when what to copy is only known at the click (e.g. read from the page).
export function CopyIconButton({ text, label = 'Copy to clipboard' }: { text: Clip | (() => Clip); label?: string }) {
  const [state, setState] = useState<'copied' | 'failed'>();
  return (
    <IconButton
      label={state === 'copied' ? 'Copied' : state === 'failed' ? 'Could not copy (the browser blocked the clipboard)' : label}
      icon={state === 'copied' ? CHECK_ICON : COPY_ICON}
      onClick={async () => {
        try {
          await writeClip(typeof text === 'function' ? text() : text);
          setState('copied');
        } catch (err) {
          console.warn('Copy failed', err);
          setState('failed');
        }
        setTimeout(() => setState(undefined), 1500);
      }}
    />
  );
}

const svg = (paths: ReactNode) => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {paths}
  </svg>
);
export const MARKDOWN_ICON = svg(<><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M6 15V9l3 3 3-3v6M17 9v6m-2.5-2.5L17 15l2.5-2.5" /></>);
export const JSON_ICON = svg(<><path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1" /><path d="M16 21h1a2 2 0 0 0 2-2v-5a2 2 0 0 1 2-2 2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1" /></>);
const COPY_ICON = svg(<><rect x="8" y="8" width="14" height="14" rx="2" /><path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2" /></>);
export const HIGHLIGHT_ICON = svg(<><path d="m9 11-6 6v3h9l3-3" /><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" /></>);
export const JIRA_ICON = svg(<><path d="M12 2 2 12l10 10 10-10z" /><path d="m12 8-4 4 4 4 4-4z" /></>);
export const TEXT_ICON = svg(<path d="M4 7V4h16v3M9 20h6M12 4v16" />);
export const THINKING_ICON = svg(<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z" />);
// Two lifelines and the messages between them (a sequence diagram).
export const DIAGRAM_ICON = svg(<><path d="M6 3v18M18 3v18" /><path d="M6 8h10m-2-2 2 2-2 2M18 15H8m2-2-2 2 2 2" /></>);
export const TECH_ICON = svg(<><path d="m12 2 10 5-10 5L2 7z" /><path d="m2 17 10 5 10-5M2 12l10 5 10-5" /></>);
export const PAGE_ICON = svg(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></>);
export const REGENERATE_ICON = svg(<><path d="M21 12a9 9 0 1 1-2.6-6.4L21 8" /><path d="M21 3v5h-5" /></>);
const CHECK_ICON = svg(<path d="M20 6 9 17l-5-5" />);
export const TO_MODEL_ICON = svg(<><path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z" /><path d="M9 12h6m-2.5-2.5L15 12l-2.5 2.5" /></>);
export const EYE_ICON = svg(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>);
export const EYE_OFF_ICON = svg(<><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.2 3.1M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 5.4-1.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M2 2l20 20" /></>);
