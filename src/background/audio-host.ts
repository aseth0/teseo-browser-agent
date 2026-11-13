// The background's side of a tab's audio (audio/protocol, its state in audio/session), started from the
// toolbar popup's Audio line or its shortcut, whose gesture lets the extension capture that tab
// (tabCapture.getMediaStreamId): the offscreen document captures and keeps it, transcribed as it goes
// with Settings → Voice's model unless it goes to the file only. Once stopped it goes where the popup
// said: the review page opens, or the chat for the captured tab (opened inside the gesture that stopped
// it) gets the transcript once every chunk is back. Its minutes on the toolbar icon, and a pill with
// Stop on the captured page (where the extension may reach it): background/session-host.
import { browser } from 'wxt/browser';
import { AUDIO_CHANGED, AUDIO_COMMAND, AUDIO_DISCARD, AUDIO_ENDED, AUDIO_LEVEL, AUDIO_PILL, AUDIO_PILL_STOP, AUDIO_REVIEW, AUDIO_START, AUDIO_STOP, AUDIO_TO_CHAT, AUDIO_TRANSCRIPT,
  audioToOf, type AudioReplies, type AudioStatus, type AudioTo } from '../audio/protocol';
import { createAudioSession } from '../audio/session';
import { previewLines } from '../audio/transcript';
import { errorText } from '../core/errors';
import { limit } from '../core/limits';
import { onRuntime, sendRuntime } from '../core/runtime';
import { isExtensionPage, senderOf } from '../core/sender';
import { hostOf, secondsSince } from '../core/util';
import { openAudioReview } from '../browser/open-manager';
import { tabAudioTarget, tabAudioView } from '../voice/settings';
import { setBadgePart } from './badge';
import { keepAwake } from './keep-awake';
import { notify } from './notify';
import { openChat } from './open-chat';
import { unreachable } from '../providers/provider-access';
import { chatRoute, hostSession, type SessionHost } from './session-host';
import { settingsNow } from './settings';
import { whyNot } from './tab-access';

const BADGE_MS = 15_000;
const minutesOf = (s: AudioStatus) => Math.floor(((s.endedAt ?? Date.now()) - s.startedAt) / 60_000);
const NO_MODEL = 'Choose an audio model in Settings → Voice to transcribe it, or capture the audio only.';
// tabCapture.getMediaStreamId needs the extension invoked on the tab (the toolbar button, a browser
// shortcut): a key set in Settings → Shortcuts (PAGE_KEY) is not that, whatever sites are allowed.
const PAGE_KEY_REFUSED = "A key set in Settings → Shortcuts cannot capture a tab's audio: use the browser's shortcut or the toolbar popup.";
// What was chosen for the pill (Settings → Voice): the text only if it is being transcribed.
const pillText = (s: AudioStatus) => !!s.progress && (s.view === 'transcript' || s.view === 'waves');

export function hostAudio() {
  let ticking: ReturnType<typeof setInterval> | undefined;
  let lines: string[] = []; // the last ones transcribed, for a pill shown again
  const session = createAudioSession({
    awake: keepAwake(),
    route: chatRoute,
    onChange: changed,
    openReview: openAudioReview,
  });
  const host: SessionHost<AudioStatus> = hostSession<AudioStatus>({
    tag: '[audio]',
    command: AUDIO_COMMAND,
    status: session.status,
    resume: session.resume,
    pill: {
      types: { stop: AUDIO_PILL_STOP, update: AUDIO_PILL },
      live: (s) => s.state === 'capturing',
      tabs: (s) => [s.tabId],
      spec: (s) => ({ kind: 'audio', startedAt: s.startedAt, text: pillText(s), waves: s.view === 'waves' }),
      shown: (tabId) => (lines.length ? host.pills.tell(tabId, { lines }) : undefined),
    },
  });
  const { ready, logged } = host;

  // The badge counts its minutes, kept up while it captures.
  const showBadge = () => setBadgePart('audio', session.status() && { state: session.status()!.state, minutes: minutesOf(session.status()!) });
  function changed(s: AudioStatus | undefined) {
    if (s?.state === 'capturing') ticking ??= setInterval(showBadge, BADGE_MS);
    else {
      clearInterval(ticking);
      ticking = undefined;
    }
    showBadge();
    host.pills.changed(s);
  }

  const start = async (tabId: number, windowId: number, to: AudioTo): Promise<AudioReplies[typeof AUDIO_START]> => {
    await ready;
    const busy = session.whyNotStart();
    if (busy) return { error: busy };
    const [settings, tab] = await Promise.all([settingsNow(), browser.tabs.get(tabId)]);
    const why = await whyNot(tab.url, 'captured');
    if (why) return { error: why };
    const view = tabAudioView(settings);
    const transcribe = to === 'file' ? undefined : tabAudioTarget(settings);
    if (to !== 'file') {
      if (!transcribe) return { error: NO_MODEL, settings: 'voice' };
      const noAccess = await unreachable(transcribe.provider);
      if (noAccess) return { error: noAccess };
    }
    if (!browser.tabCapture) return { error: "This browser cannot capture a tab's audio." };
    let streamId: string;
    try {
      streamId = await browser.tabCapture.getMediaStreamId({ targetTabId: tabId });
    } catch (e) {
      return { error: `The browser did not let the extension capture this tab (${errorText(e)}).` };
    }
    lines = [];
    const r = await session.start({ tabId, windowId, site: hostOf(tab.url), streamId, to, view, transcribe, maxMs: limit('tabAudioMinutes') * 60_000 });
    return r === 'started' ? { started: true } : r;
  };
  // `inGesture`: inside a click's message or a key, where the chat may open now.
  const stop = ({ inGesture }: { inGesture: boolean }) => {
    const stopping = session.stop(inGesture ? openChat : undefined);
    return ready.then(() => stopping);
  };
  // The offscreen document transcribed more: the pill gets the last lines, where it shows text.
  const progressed = async (progress: Parameters<typeof session.progressed>[0]) => {
    await ready;
    await session.progressed(progress);
    const s = session.status();
    if (s?.state !== 'capturing' || !pillText(s)) return;
    const seconds = secondsSince(s);
    const r = await sendRuntime({ type: AUDIO_TRANSCRIPT });
    if (!r || !('transcript' in r)) return;
    lines = previewLines(r.transcript, seconds);
    if (lines.length) await host.pills.tell(s.tabId, { lines });
  };

  onRuntime(AUDIO_START, (msg, sender) => (isExtensionPage(sender) ? start(msg.tabId, msg.windowId, audioToOf(msg.to)).catch((e: unknown) => ({ error: errorText(e) })) : undefined));
  onRuntime(AUDIO_STOP, (_msg, sender) => (isExtensionPage(sender) ? stop({ inGesture: true }).then(() => ({})) : undefined));
  onRuntime(AUDIO_DISCARD, (_msg, sender) => (isExtensionPage(sender) ? ready.then(() => session.discard()) : undefined));
  onRuntime(AUDIO_REVIEW, (_msg, sender) => (isExtensionPage(sender) ? openAudioReview() : undefined));
  // From the review page, inside its click: the chat for the tab it names (the captured one, or the
  // page's own once that closed) opens now.
  onRuntime(AUDIO_TO_CHAT, (msg, sender) => {
    if (!isExtensionPage(sender)) return;
    const to = openChat({ id: msg.tabId, windowId: msg.windowId });
    return ready.then(() => session.toChat(to)).catch((e: unknown) => ({ error: errorText(e) }));
  });
  onRuntime(AUDIO_CHANGED, (msg, sender) => {
    if (isExtensionPage(sender)) logged(progressed(msg.progress));
  });
  // Many a second, while it captures: nothing to say if the page has no pill.
  onRuntime(AUDIO_LEVEL, (msg, sender) => {
    const s = session.status();
    if (isExtensionPage(sender) && s?.state === 'capturing') void host.pills.tell(s.tabId, { level: msg.level });
  });
  // The captured tab closed, or the time is up: what it got is kept, as with Stop.
  onRuntime(AUDIO_ENDED, (_msg, sender) => {
    if (isExtensionPage(sender)) logged(stop({ inGesture: false }));
  });
  // From the pill on the captured page (a page's own scripts cannot send this).
  onRuntime(AUDIO_PILL_STOP, (_msg, sender) => {
    if (!senderOf(sender).fromPage || sender.tab?.id !== session.status()?.tabId) return;
    return stop({ inGesture: true }).then(() => ({}));
  });

  host.onToggle((here, from) => {
    const s = session.status();
    if (s?.state === 'capturing') return logged(stop({ inGesture: true }));
    if (s?.state === 'stopped' && s.progress) return logged(openAudioReview());
    if (from === 'page') return notify('Audio not captured', PAGE_KEY_REFUSED);
    logged(
      settingsNow().then(async (settings) => {
        const r = await start(here.id, here.windowId, audioToOf(settings.audioTo));
        if ('error' in r) notify('Audio not captured', r.error);
      }),
    );
  });
}
