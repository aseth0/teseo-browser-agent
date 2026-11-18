// The background's side of the floating chat's dictation (voice/protocol): the offscreen document opened
// for it (audio/offscreen-document, the one the background creates), which then records on the chat's
// port. Where there is none (Firefox, which has no floating chat either), nothing listens.
import { browser } from 'wxt/browser';
import { offscreenReady } from '../audio/offscreen-document';
import { errorText } from '../core/errors';
import { onRuntime } from '../core/runtime';
import { isExtensionPage } from '../core/sender';
import { DICTATION_OFFSCREEN } from '../voice/protocol';

export function hostDictation() {
  if (!browser.offscreen) return;
  onRuntime(DICTATION_OFFSCREEN, (_msg, sender) =>
    isExtensionPage(sender) ? offscreenReady().then(() => ({}), (e: unknown) => ({ error: errorText(e) })) : undefined);
}
