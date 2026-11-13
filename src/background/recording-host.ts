// The background's recording of a page's requests (recording/recorder), started and stopped from the
// toolbar popup (extension pages only) and its shortcut, and stopped from the pill on a recorded page.
// Whatever opens a chat for the review does it first, inside the click or the key,
// which the side panel's opening needs: the chat floating on the recorded tab, else the side panel.
// While it records, the toolbar icon counts its calls and a pill shows on each recorded tab
// (background/session-host).
import { browser } from 'wxt/browser';
import { onRuntime } from '../core/runtime';
import { isExtensionPage, senderOf } from '../core/sender';
import { presetFor } from '../recording/presets';
import { RECORDING_DISCARD, RECORDING_PILL, RECORDING_PILL_STOP, RECORDING_REVIEW, RECORDING_START, RECORDING_STOP } from '../recording/protocol';
import { createRecorder } from '../recording/recorder';
import { RECORDING_COMMAND, type RecordingStatus } from '../recording/recorder-protocol';
import type { CaptureMode } from '../recording/devtools';
import { devtoolsOn } from '../storage/settings-select';
import { setBadgePart } from './badge';
import { keepAwake } from './keep-awake';
import { chatShownIn, clearAlert, raiseAlert } from './alerts';
import { notify } from './notify';
import { openChat } from './open-chat';
import { chatRoute, hostSession } from './session-host';
import { settingsNow } from './settings';
import { whyNot } from './tab-access';

const REVIEW_ALERT = 'recording-review';
const pillAt = (s: RecordingStatus) => ({ calls: s.calls, leftOut: s.leftOut, startedAt: s.startedAt });

export function hostRecording() {
  const recorder = createRecorder({
    awake: keepAwake(),
    // One that stopped by itself (its tab closed, the extension restarted): it waits for review.
    route: (tabId) => {
      waits();
      return chatRoute(tabId);
    },
    onChange: changed,
  });
  const host = hostSession<RecordingStatus>({
    tag: '[recording]',
    command: RECORDING_COMMAND,
    status: recorder.status,
    resume: recorder.resume,
    pill: {
      types: { stop: RECORDING_PILL_STOP, update: RECORDING_PILL },
      live: (s) => s.state === 'recording',
      tabs: (s) => s.tabs,
      spec: (s) => ({ kind: 'recording', ...pillAt(s) }),
      update: pillAt,
    },
  });
  const { ready, logged } = host;

  // A recording waits for review, by its level (Settings → Alerts): until it is saved, discarded or another starts.
  function waits(where = recorder.status()) {
    void raiseAlert(REVIEW_ALERT, 'recording', {
      message: 'Open the chat to review it.',
      where: { tabId: where?.tabId, windowId: where?.windowId, sidePanel: true },
      inView: chatShownIn(where?.windowId),
    });
  }

  function changed(s: RecordingStatus | undefined) {
    if (s?.state !== 'stopped') clearAlert(REVIEW_ALERT);
    setBadgePart('recording', s && { state: s.state, calls: s.calls });
    host.pills.changed(s);
  }

  const start = async (tabId: number, windowId: number, mode: CaptureMode, presetId?: string): Promise<{ started: true } | { waiting: true } | { error: string }> => {
    await ready;
    if (recorder.status()?.state === 'stopped') return { waiting: true };
    const [settings, tab] = await Promise.all([settingsNow(), browser.tabs.get(tabId)]);
    const why = await whyNot(tab.url, 'recorded');
    if (why) return { error: why };
    // Settings → Recording refuses one; one saved before it did would record nothing.
    const preset = presetFor(settings, presetId);
    if (!preset.types.length) return { error: `The preset "${preset.name}" keeps no kind of call: tick one in Settings → Recording.` };
    const r = await recorder.start({ tabId, windowId, url: tab.url!, mode, preset, devtools: devtoolsOn(settings) });
    return r === 'started' ? { started: true } : r === 'waiting' ? { waiting: true } : r;
  };
  // Stopped, and handed to the chat opened for it (now, before anything is awaited).
  const stopInto = (tab: { id: number; windowId: number }) => {
    const to = openChat(tab);
    return ready.then(() => recorder.stop()).then(async (r) => {
      if (r) await recorder.handOff(to);
      return { opened: !!r };
    });
  };
  // The one waiting, in the chat for the tab the user is on (opened now): it may be another than the
  // recorded one, which may be gone.
  const review = (tab: { id: number; windowId: number }) => {
    const to = openChat(tab);
    return ready.then(async () => {
      if (recorder.status()?.state !== 'stopped') return { opened: false };
      await recorder.handOff(to, { again: true });
      return { opened: true };
    });
  };
  const recordedTab = (s: RecordingStatus) => ({ id: s.tabId, windowId: s.windowId });

  onRuntime(RECORDING_START, (msg, sender) => (isExtensionPage(sender) ? start(msg.tabId, msg.windowId, msg.mode, msg.presetId) : undefined));
  onRuntime(RECORDING_STOP, (_msg, sender) => {
    if (!isExtensionPage(sender)) return;
    const s = recorder.status();
    return s ? stopInto(recordedTab(s)).then(() => ({})) : {};
  });
  onRuntime(RECORDING_REVIEW, (msg, sender) => (isExtensionPage(sender) ? review({ id: msg.tabId, windowId: msg.windowId }) : undefined));
  onRuntime(RECORDING_DISCARD, (_msg, sender) => (isExtensionPage(sender) ? ready.then(() => recorder.discard()) : undefined));
  // From the pill of a tab being recorded (a page's own scripts cannot send this).
  onRuntime(RECORDING_PILL_STOP, (_msg, sender) => {
    const tab = sender.tab;
    if (!senderOf(sender).fromPage || tab?.id === undefined || !host.pills.has(tab.id) || recorder.status()?.state !== 'recording') return;
    return stopInto({ id: tab.id, windowId: tab.windowId });
  });

  host.onToggle((here) => {
    // Known now (the worker was awake): inside the key's gesture.
    const s = recorder.status();
    if (s?.state === 'recording') return logged(stopInto(recordedTab(s)));
    if (s?.state === 'stopped') return logged(review(here));
    logged(
      settingsNow().then(async (settings) => {
        const r = await start(here.id, here.windowId, 'tab', settings.recordingPreset);
        if ('error' in r) return notify('Recording not started', r.error);
        // One was waiting, found only once the worker woke: too late to open a chat, it goes to this tab's.
        if ('waiting' in r) {
          await recorder.handOff(chatRoute(here.id), { again: true });
          waits({ ...recorder.status()!, tabId: here.id, windowId: here.windowId });
        }
      }),
    );
  });
}
