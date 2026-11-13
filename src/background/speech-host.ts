// The background's side of Speak (speech/protocol, its state in speech/session): the one reading, played
// in the offscreen document, which goes on when the tab changes or the side panel closes. Started from the
// side panel's buttons, Settings' Test, the page widget's button beside a selection and the shortcut, which
// reads the tab's selection with the key's own access to it; Stopped from any of them, the pill on the
// page and the popup. Its pill shows on the tab it was started for, while the extension may reach it.
import { browser } from 'wxt/browser';
import { offscreenReady } from '../audio/offscreen-document';
import { bestEffort, errorText } from '../core/errors';
import { onRuntime, sendRuntime, sendTab } from '../core/runtime';
import { isExtensionPage, senderOf } from '../core/sender';
import { unreachable } from '../providers/provider-access';
import { showSpeechPill } from '../speech/pill';
import { pageSelection } from '../speech/selection';
import { SPEAK_COMMAND, SPEAK_ENDED, SPEAK_HALT, SPEAK_HELD, SPEAK_PILL, SPEAK_PILL_STOP, SPEAK_PLAY, SPEAK_PROGRESS, SPEAK_STATUS, SPEAK_STOP, SPEAK_GROW, SPEAK_MORE, SPEAK_TEXT, SPEAK_UNQUEUE, speakText, type SpeakStatus } from '../speech/protocol';
import { createSpeechSession, type SpeechDeps } from '../speech/session';
import { storageGet } from '../storage/area';
import { agentById, agentStore } from '../agents/profiles';
import { DEFAULT_AGENT_ID } from '../agents/builtins';
import type { Settings } from '../storage/settings';
import { notify } from './notify';
import { settingsNow } from './settings';
import { onShortcut } from './shortcuts';
import { keepAwake } from './keep-awake';
import { createSystemVoice } from '../speech/system-voice';
import { profilesOf } from '../speech/settings';
import { actionStore } from '../widget/store';
import { actionOwner } from '../widget/actions';

const PILL_TYPES = { stop: SPEAK_PILL_STOP, update: SPEAK_PILL };
const NOTHING_SELECTED = 'Select some text on the page first, then press the shortcut again.';

// The selection on a tab, from any of its frames: the first that has one.
async function selectionOn(tabId: number): Promise<string> {
  const results = await browser.scripting.executeScript({ target: { tabId, allFrames: true }, func: pageSelection });
  return results.map((r) => (typeof r.result === 'string' ? r.result.trim() : '')).find(Boolean) ?? '';
}

// The voice profile of an agent (none named: the active one; Browser's in the settings), if it has one.
export async function agentVoiceProfile(s: Settings, agentId: string | undefined): Promise<string | undefined> {
  const id = agentId ?? s.activeAgentId ?? DEFAULT_AGENT_ID;
  if (id === DEFAULT_AGENT_ID) return s.browserAgent?.voiceProfileId;
  return agentById(await agentStore.load(), id)?.voiceProfileId; // one switched off or removed: none
}

// The voice of an action, by the action's id: the profile it chose (one removed: none), else its agent's
// (Default's id when it has none, or its agent is off); none for an action not found (the active agent's voice).
async function actionVoice(actionId: string): Promise<{ profileId?: string; agentId?: string }> {
  const action = (await actionStore.load()).find((a) => a.id === actionId);
  if (!action) return {};
  const own = action.speak?.profileId;
  if (own && profilesOf(await settingsNow()).some((p) => p.id === own)) return { profileId: own };
  return { agentId: actionOwner(action, await agentStore.load())?.id ?? DEFAULT_AGENT_ID };
}

export function hostSpeech(agentProfileId: SpeechDeps['agentProfileId'] = agentVoiceProfile) {
  const logged = (p: Promise<unknown>) => void p.catch((e: unknown) => console.error('[speech]', e));
  const pills = new Set<number>();
  const tell = (tabId: number, msg: { off?: true; text?: string; key?: string; waiting?: string[] }) => bestEffort(sendTab(tabId, { type: SPEAK_PILL, ...msg }), 'speech-pill');
  const show = (tabId: number, s: SpeakStatus) => {
    pills.add(tabId);
    void bestEffort(browser.scripting.executeScript({ target: { tabId }, func: showSpeechPill, args: [PILL_TYPES, speakText(s)] }), 'speech-pill');
  };
  const pillsFollow = (s: SpeakStatus | undefined, before: SpeakStatus | undefined) => {
    for (const tabId of pills) {
      if (tabId !== s?.tabId) {
        void tell(tabId, { off: true });
        pills.delete(tabId);
      }
    }
    if (!s && before?.tabId !== undefined) void tell(before.tabId, { off: true }); // a worker that woke has no pills listed
    if (s?.tabId === undefined) return;
    if (!pills.has(s.tabId)) show(s.tabId, s);
    // What is read and what waits, for the pill and for the page widget's speakers.
    void tell(s.tabId, { text: speakText(s), ...(s.key && { key: s.key }), ...(s.waiting && { waiting: s.waiting }) });
  };

  // The system's voice reads without the offscreen document, the worker kept awake meanwhile.
  const system = createSystemVoice({ progressed: (m) => logged(session.progressed(m)), ended: (m) => logged(session.ended(m)) }, undefined, keepAwake());
  const session = createSpeechSession({
    system,
    settings: settingsNow,
    agentProfileId,
    unreachable,
    open: offscreenReady,
    play: (run, pieces, target, done) => sendRuntime({ type: SPEAK_PLAY, run, pieces, target, done }),
    more: (run, pieces, done) => sendRuntime({ type: SPEAK_MORE, run, pieces, done }),
    halt: async () => void (await sendRuntime({ type: SPEAK_HALT }).catch(() => undefined)),
    held: async () => (await sendRuntime({ type: SPEAK_HELD }))?.run,
    load: () => storageGet<SpeakStatus>('session', SPEAK_STATUS),
    save: (s) => (s ? browser.storage.session.set({ [SPEAK_STATUS]: s }) : browser.storage.session.remove(SPEAK_STATUS)),
    onChange: pillsFollow,
    failed: (error) => notify('Reading aloud stopped', error),
    newRun: () => crypto.randomUUID(),
  });

  const fromWidget = async (msg: { text: string; action?: string; box?: number; queued?: boolean; growing?: boolean }, tabId: number) => {
    if (typeof msg.action !== 'string') return session.start({ text: msg.text, tabId, key: 'selection' });
    const box = Number.isInteger(msg.box) ? msg.box : 0;
    return session.start({ text: msg.text, tabId, key: `action:${msg.action}:${box}`, ...(await actionVoice(msg.action)), ...(msg.queued === true && { queued: true }), ...(msg.growing === true && { growing: true }) });
  };

  // A tab that loaded a page while it is read for gets its pill again.
  browser.tabs.onUpdated.addListener((tabId, change) => {
    const s = session.status();
    if (change.status === 'complete' && s?.tabId === tabId) show(tabId, s);
  });

  onRuntime(SPEAK_TEXT, (msg, sender) => {
    const { fromExtension, fromPage } = senderOf(sender);
    if (typeof msg.text !== 'string') return;
    // The page widget's buttons: its own tab's selection, with the active agent's voice; a box of an
    // action's card, with the voice of the agent the action belongs to (the page names only the action).
    if (!fromExtension) return fromPage ? fromWidget(msg, sender.tab!.id!).catch((e: unknown) => ({ error: errorText(e) })) : undefined;
    const { text, agentId, profileId, profile, tabId, key } = msg;
    return session.start({ text, agentId, profileId, profile, tabId, key, ...(msg.queued === true && { queued: true }), ...(msg.growing === true && { growing: true }) }).catch((e: unknown) => ({ error: errorText(e) }));
  });
  onRuntime(SPEAK_STOP, (_msg, sender) => {
    const { fromExtension, fromPage } = senderOf(sender);
    return fromExtension || fromPage ? session.stop().then(() => ({})) : undefined;
  });
  // A text read as it is written grew, or is done: from the extension's pages, or a page's own boxes ("action:…").
  onRuntime(SPEAK_GROW, (msg, sender) => {
    const { fromExtension, fromPage } = senderOf(sender);
    if (typeof msg.key !== 'string' || typeof msg.text !== 'string') return;
    if (!fromExtension && !(fromPage && msg.key.startsWith('action:'))) return;
    return session.grow(msg.key, msg.text, msg.done === true).then(() => ({}));
  });
  // An action's boxes that wait, dropped once its card goes: a page's only on its own tab.
  onRuntime(SPEAK_UNQUEUE, (msg, sender) => {
    const { fromExtension, fromPage } = senderOf(sender);
    if (typeof msg.prefix !== 'string' || !msg.prefix) return;
    if (fromPage) return session.unqueue(msg.prefix, sender.tab!.id).then(() => ({}));
    return fromExtension ? session.unqueue(msg.prefix).then(() => ({})) : undefined;
  });
  // From the pill on the page (a page's own scripts cannot send this).
  onRuntime(SPEAK_PILL_STOP, (_msg, sender) => {
    if (!senderOf(sender).fromPage || sender.tab?.id !== session.status()?.tabId) return;
    return session.stop().then(() => ({}));
  });
  onRuntime(SPEAK_PROGRESS, (msg, sender) => {
    if (isExtensionPage(sender)) logged(session.progressed(msg));
  });
  onRuntime(SPEAK_ENDED, (msg, sender) => {
    if (isExtensionPage(sender)) logged(session.ended(msg));
  });

  // The shortcut: stops what is being read, or reads the tab's selection, with the key's access to it.
  onShortcut((command, tab) => {
    if (command !== SPEAK_COMMAND || tab?.id === undefined) return;
    const tabId = tab.id;
    logged(
      (async () => {
        await session.ready;
        if (session.status()) return session.stop();
        const text = await selectionOn(tabId).catch(() => '');
        if (!text) return notify('Nothing read aloud', NOTHING_SELECTED);
        const r = await session.start({ text, tabId, key: 'selection' });
        if ('error' in r) notify('Nothing read aloud', r.error);
      })(),
    );
  });
  return session;
}
