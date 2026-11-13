// The background's one capture of a tab's audio (the toolbar popup's Audio line, the shortcut:
// background/audio-host), as recording/recorder is for a recording. The offscreen document (audio/offscreen)
// captures and keeps it; this is its state: capturing, or stopped and kept until it is discarded,
// published as its status (AUDIO_STATUS, storage.session) for the popup, the badge and the review page.
// Once stopped it goes where the popup said (AudioTo): the review page opens, or the chat for the
// captured tab gets the transcript once every chunk is back.
import { browser } from 'wxt/browser';
import { CHAT_ATTACH, type ImagesPayload } from '../capture/protocol';
import { handoff, type HandoffTo } from '../core/handoff';
import { offscreenOpen, offscreenReady } from './offscreen-document';
import { sendRuntime } from '../core/runtime';
import { secondsSince } from '../core/util';
import { storageGet } from '../storage/area';
import type { TabAudioView } from '../storage/settings-types';
import { AUDIO_CAPTURE, AUDIO_DROP, AUDIO_END, AUDIO_HELD, AUDIO_STATUS, AUDIO_TRANSCRIPT, audioFileName, audioName, type AudioPayload, type AudioProgress, type AudioStatus, type AudioTo, type AudioTranscriber } from './protocol';
import { attachLines } from './transcript';

const NO_ANSWER = 'The offscreen document did not answer.';
const TRANSCRIBING = "The tab's audio is being transcribed…";

export interface StartOptions {
  tabId: number;
  windowId: number;
  site: string;
  streamId: string; // tabCapture.getMediaStreamId, got inside the gesture
  to: AudioTo;
  view: TabAudioView;
  transcribe?: AudioTranscriber; // none: the file only
  maxMs: number;
}

interface Deps {
  awake: (on: boolean) => void; // the worker kept awake while it captures (background/keep-awake)
  route: (tabId: number) => HandoffTo; // the chat a transcript goes to by itself
  onChange: (status: AudioStatus | undefined) => void; // the badge and the pill
  openReview: () => Promise<void>; // the review page (entrypoints/audio)
}

export function createAudioSession(deps: Deps) {
  let status: AudioStatus | undefined;

  const set = async (next: AudioStatus | undefined) => {
    status = next;
    deps.awake(next?.state === 'capturing');
    deps.onChange(next);
    await (next ? browser.storage.session.set({ [AUDIO_STATUS]: next }) : browser.storage.session.remove(AUDIO_STATUS));
  };

  // The transcript, as reviewed so far, into the message box of the chat `to` names.
  const toChat = async (to: HandoffTo): Promise<Record<string, never> | { error: string }> => {
    const s = status;
    if (!s?.progress) return { error: 'This audio is not transcribed.' };
    const r = await sendRuntime({ type: AUDIO_TRANSCRIPT });
    if (!r || !('transcript' in r)) return { error: (r && 'error' in r && r.error) || NO_ANSWER };
    const seconds = secondsSince(s);
    const audio: AudioPayload = { kind: 'audio', name: audioName(s.site, seconds), site: s.site, seconds, lines: attachLines(r.transcript, seconds) };
    await browser.storage.session.set({ [CHAT_ATTACH]: handoff(audio, to) });
    if (status === s) await set({ ...s, sent: true });
    return {};
  };
  // Going to the chat and every chunk back: it goes, once.
  const handIfDone = async () => {
    const s = status;
    if (s?.state === 'stopped' && s.to === 'chat' && !s.sent && s.progress?.done && !s.progress.sending) await toChat(deps.route(s.tabId));
  };

  return {
    status: () => status,
    toChat,
    // Why none can start now: one at a time, and one kept is saved or discarded first.
    whyNotStart(): string | undefined {
      if (status?.state === 'capturing') return "A tab's audio is being captured already: stop it first.";
      if (status?.state === 'stopped') return 'Save or discard the audio kept first.';
      return undefined;
    },
    async start(o: StartOptions): Promise<'started' | { error: string }> {
      const why = this.whyNotStart();
      if (why) return { error: why };
      await offscreenReady();
      const r = await sendRuntime({ type: AUDIO_CAPTURE, streamId: o.streamId, name: audioFileName(o.site, Date.now()), maxMs: o.maxMs, transcribe: o.transcribe, waves: o.view === 'waves' });
      if (!r || 'error' in r || !('startedAt' in r)) return { error: (r && 'error' in r && r.error) || NO_ANSWER };
      await set({ state: 'capturing', tabId: o.tabId, windowId: o.windowId, site: o.site, startedAt: r.startedAt, to: o.to, view: o.view, ...(o.transcribe && { progress: { sending: 0, failed: 0, done: false } }) });
      return 'started';
    },
    // `openChat`: inside a click's message or a key, where the chat for the captured tab may open now;
    // it is told the transcript is on its way. Known now (the worker is kept awake while it captures).
    stop(openChat?: (tab: { id: number; windowId: number }) => HandoffTo): Promise<void> {
      const s = status;
      if (openChat && s?.state === 'capturing' && s.to === 'chat') {
        const to = openChat({ id: s.tabId, windowId: s.windowId });
        browser.storage.session.set({ [CHAT_ATTACH]: handoff<ImagesPayload>({ kind: 'images', images: [], note: TRANSCRIBING }, to) }).catch((e: unknown) => console.error('[audio]', e));
      }
      return (async () => {
        if (status?.state !== 'capturing') return;
        const r = await sendRuntime({ type: AUDIO_END });
        await set({ ...status, state: 'stopped', endedAt: Date.now(), ...(r && 'size' in r && { size: r.size }) });
        if (status.to === 'review') await deps.openReview();
        await handIfDone();
      })();
    },
    // The offscreen document transcribed more: true while it captures and its pill shows text.
    async progressed(progress: AudioProgress): Promise<void> {
      if (!status?.progress) return;
      await set({ ...status, progress });
      await handIfDone();
    },
    async discard(): Promise<void> {
      if (await offscreenOpen()) await sendRuntime({ type: AUDIO_DROP });
      await set(undefined);
    },
    // A worker that woke takes up what the offscreen document still holds; without it, there is nothing.
    // The tabs whose pill is to go: the captured one, when the capture was lost.
    async resume(): Promise<number[]> {
      const kept = await storageGet<AudioStatus>('session', AUDIO_STATUS);
      if (!kept) return [];
      const held = (await offscreenOpen()) ? (await sendRuntime({ type: AUDIO_HELD }))?.held : 'none';
      if (held === kept.state) {
        await set(kept);
        return [];
      }
      const lost = kept.state === 'capturing' ? [kept.tabId] : [];
      if (held === 'stopped') await set({ ...kept, state: 'stopped', endedAt: kept.endedAt ?? Date.now() });
      else await set(undefined);
      return lost;
    },
  };
}
