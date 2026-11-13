// The background's one offscreen document (entrypoints/offscreen): the browser allows one per extension,
// so it is created once, the first time a tab's audio is captured (background/audio-host) or something is
// read aloud (background/speech-host), with both reasons. Chrome closes a document whose only reason is
// AUDIO_PLAYBACK after 30 seconds without sound; USER_MEDIA sets no limit, and a document is closed only
// once none of its reasons holds it (Chromium's offscreen lifetime enforcers), so it stays open: a capture
// in progress is never cut. One created by an earlier build (USER_MEDIA only) plays as well. Should it be
// closed anyway, the next reading opens it again.
import { browser } from 'wxt/browser';

export const OFFSCREEN_PATH = '/offscreen.html';

let creating: Promise<void> | undefined;

export async function offscreenReady(): Promise<void> {
  if (!browser.offscreen) throw new Error('This needs offscreen documents, which this browser does not have.');
  const open = await browser.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (open.length) return;
  creating ??= browser.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
      justification: "Records a tab's audio, and reads text aloud, when you ask.",
    })
    .finally(() => (creating = undefined));
  await creating;
}

// Whether it is open now (never created by asking).
export const offscreenOpen = async (): Promise<boolean> => !!browser.offscreen && (await browser.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length > 0;
