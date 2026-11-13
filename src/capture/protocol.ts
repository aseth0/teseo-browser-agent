// Screenshots started from the toolbar popup or a keyboard shortcut (background/capture-host): their
// kinds and shortcuts, and what the background hands to the chat that is to attach them.
import { isHandoff, type Handoff } from '../core/handoff';
import type { ImagePayload } from '../core/types';

// A section dragged on the page, its visible part, or the whole scrolling page.
export type CaptureKind = 'section' | 'visible' | 'full-page';

// The manifest's commands (wxt.config.ts), one per kind.
export const CAPTURE_COMMANDS: Record<CaptureKind, string> = { section: 'capture-section', visible: 'capture-visible', 'full-page': 'capture-full-page' };
export const captureKindOf = (command: string): CaptureKind | undefined =>
  (Object.keys(CAPTURE_COMMANDS) as CaptureKind[]).find((kind) => CAPTURE_COMMANDS[kind] === command);

// storage.session: a handoff (core/handoff) for the chat to attach to its message box, not sent: the
// images (made smaller already), or a note on why there are none; or, under the same key, a tab's
// audio transcribed (audio/protocol AudioPayload). Taken by that chat once read, also while a turn runs.
export const CHAT_ATTACH = 'chatAttach';
export interface ImagesPayload {
  kind: 'images';
  images: ImagePayload[];
  note?: string;
}
export type ChatAttach = Handoff<ImagesPayload>;
// One read back from storage.session, which another version of the extension may have written.
export function isImagesPayload(v: unknown): v is ImagesPayload {
  if (!v || typeof v !== 'object') return false;
  const a = v as Record<string, unknown>;
  const isImage = (i: unknown) => !!i && typeof i === 'object' && typeof (i as ImagePayload).mediaType === 'string' && typeof (i as ImagePayload).data === 'string';
  return a.kind === 'images' && Array.isArray(a.images) && a.images.every(isImage) && (a.note === undefined || typeof a.note === 'string');
}
export const isChatAttach = (v: unknown): v is ChatAttach => isHandoff(v, isImagesPayload);
