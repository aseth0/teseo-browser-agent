// What the hosts of a background session share: a recording of a page's requests (recording-host) and
// a tab's audio (audio-host). Each keeps its state machine apart (recording/recorder, audio/session),
// which writes its status to storage.session and tells it here; the host shows it: the pill on each
// tab the session is on (recording/pill), shown again when that tab loads a page, and the shortcut
// that starts, stops or reviews it. Every answer waits for `ready`: what a worker that just woke
// found (a session waiting, or one it lost, whose pills go).
import { browser } from 'wxt/browser';
import { chatTarget } from '../capture/plan';
import { bestEffort } from '../core/errors';
import { sendTab, type MessageOf } from '../core/runtime';
import { AUDIO_PILL } from '../audio/protocol';
import { showRecordingPill, type PillSpec } from '../recording/pill';
import { RECORDING_PILL } from '../recording/protocol';
import type { HandoffTo } from '../widget/protocol';
import { floatingNow } from './floating-tabs';
import { panelFollowsNow } from './panel-mode';
import { onShortcut } from './shortcuts';

// The pill's messages from the background (recording/protocol RECORDING_PILL, audio/protocol AUDIO_PILL).
type PillMessage = MessageOf<typeof RECORDING_PILL | typeof AUDIO_PILL>;
type PillUpdate = Omit<MessageOf<typeof RECORDING_PILL>, 'type'> & Omit<MessageOf<typeof AUDIO_PILL>, 'type'>; // what either is told

export interface SessionHostSpec<S> {
  tag: string; // in the console: '[recording]'
  command: string; // the manifest's command (wxt.config.ts) that starts, stops or reviews it
  status: () => S | undefined;
  resume: () => Promise<number[]>; // what a worker that woke left: the tabs whose pills are to go
  pill: {
    types: { stop: string; update: PillMessage['type'] };
    live: (s: S) => boolean; // its pills show while this holds
    tabs: (s: S) => number[];
    spec: (s: S) => PillSpec; // what the pill shows
    update?: (s: S) => PillUpdate; // told to a pill shown already, on each change
    shown?: (tabId: number) => Promise<unknown> | undefined; // once a pill is shown (again)
  };
}

// Where the chat for a tab is: the one floating on it, else the side panel (its own or the window's).
export const chatRoute = (tabId: number): HandoffTo => chatTarget(tabId, floatingNow(tabId), panelFollowsNow()).to;

export interface SessionHost<S> {
  ready: Promise<void>;
  logged: (p: Promise<unknown>) => void;
  onToggle: (f: (here: { id: number; windowId: number }, from: 'browser' | 'page') => void) => void;
  pills: { tell: (tabId: number, msg: PillUpdate) => Promise<unknown>; has: (tabId: number) => boolean; changed: (s: S | undefined) => void };
}

export function hostSession<S>(spec: SessionHostSpec<S>): SessionHost<S> {
  const { tag, pill } = spec;
  const pillTag = `${tag.replace(/^\[|\]$/g, '')}-pill`;
  const logged = (p: Promise<unknown>) => void p.catch((e: unknown) => console.error(tag, e));
  const pills = new Set<number>(); // the tabs showing the pill
  const tell = (tabId: number, msg: PillUpdate) => bestEffort(sendTab(tabId, { type: pill.types.update, ...msg }), pillTag);
  const hide = (tabId: number) => void tell(tabId, { off: true });
  const show = (tabId: number, s: S) => {
    pills.add(tabId);
    void bestEffort(browser.scripting.executeScript({ target: { tabId }, func: showRecordingPill, args: [pill.types, pill.spec(s)] }).then(() => pill.shown?.(tabId)), pillTag);
  };
  // The status changed: the pills follow it, and go with it.
  const changed = (s: S | undefined) => {
    if (!s || !pill.live(s)) {
      for (const tabId of pills) hide(tabId);
      return pills.clear();
    }
    for (const tabId of pill.tabs(s)) {
      if (!pills.has(tabId)) show(tabId, s);
      else if (pill.update) void tell(tabId, pill.update(s));
    }
  };
  // A tab the session is on that loaded a page gets its pill again.
  browser.tabs.onUpdated.addListener((tabId, change) => {
    const s = spec.status();
    if (change.status === 'complete' && s && pill.live(s) && pills.has(tabId)) show(tabId, s);
  });
  const ready = spec.resume().then(
    (lost) => lost.forEach(hide),
    (e: unknown) => console.error(tag, e),
  );
  // The shortcut, pressed on a tab: inside the key's gesture, where a chat may open.
  const onToggle = (f: (here: { id: number; windowId: number }, from: 'browser' | 'page') => void) =>
    onShortcut((command, tab, from) => {
      if (command !== spec.command || tab?.id === undefined) return;
      f({ id: tab.id, windowId: tab.windowId }, from);
    });
  return { ready, logged, onToggle, pills: { tell, has: (tabId: number) => pills.has(tabId), changed } };
}
