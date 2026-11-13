// The only module that uses chrome.debugger: the browser.* tools on the DevTools engine (tools/browser/engine*)
// and recordings through DevTools (recording/devtools). Attached to a tab
// for one call and detached in every case, one call per tab at a time, and only while Settings →
// Chromium DevTools is on. A call may send only the methods below: the tools build every parameter
// themselves, the model never chooses a method.
import { browser } from 'wxt/browser';
import { bestEffort, errorText } from '../core/errors';
import { text } from '../core/model-texts';
import { sleep } from '../core/util';
import { DEVTOOLS_STATUS } from '../core/protocol';
import { onRuntime, sendRuntime } from '../core/runtime';
import { isExtensionPage } from '../core/sender';
import { devtoolsOn } from '../storage/settings-select';
import type { Settings } from '../storage/settings-types';

export const CDP_METHODS = [
  'Input.dispatchMouseEvent', 'Input.dispatchKeyEvent', 'Input.insertText', 'Page.captureScreenshot', 'Emulation.setFocusEmulationEnabled',
  // The engine (tools/browser/engine): a screenshot's phone or dark view, waiting for the network to be idle.
  'Emulation.setDeviceMetricsOverride', 'Emulation.clearDeviceMetricsOverride', 'Emulation.setTouchEmulationEnabled', 'Emulation.setEmulatedMedia', 'Network.enable',
] as const;
export type CdpMethod = (typeof CDP_METHODS)[number];

// The events a call may listen to, its tab's only: requests starting and ending (counted by id for
// networkIdle; nothing else about them is kept).
const CDP_EVENTS = ['Network.requestWillBeSent', 'Network.loadingFinished', 'Network.loadingFailed'] as const;
export type CdpEvent = (typeof CDP_EVENTS)[number];

export interface CdpSession {
  send<T = unknown>(method: CdpMethod, params?: Record<string, unknown>): Promise<T>;
  on(event: CdpEvent, listener: (params: Record<string, unknown>) => void): void;
}

// The browser (or the user, with the infobar's Cancel, or DevTools taking over) detached it mid-call.
export class DevtoolsDetachedError extends Error {
  constructor(readonly reason: string) {
    super(text('error.devtools_detached', { reason }));
  }
}

// What the background gives the engine when it wires it up (listenDevtools): the settings as the
// worker has them applied (background/settings) and the icon badge's DBG (background/badge).
export interface DevtoolsDeps {
  settingsNow: () => Promise<Settings>;
  setDebuggerBadge: (tabs: number) => void;
}
let deps: DevtoolsDeps;

const VERSION = '1.3';
const DETACH_MS = 2000; // a detach that does not answer (a page held by a dialog) is let go

const ENGINE_OFF = 'Chromium DevTools tools are off: turn them on in Settings → Chromium DevTools.';
// Refuses while Settings → Chromium DevTools is off: before any attach, and before the engine's tools
// touch the page (tools/browser/engine-tools).
export async function requireEngine(): Promise<void> {
  if (!devtoolsOn(await deps.settingsNow())) throw new Error(ENGINE_OFF);
}
const TIME_LIMIT_MS = 15_000;

const attached = new Set<number>();
const queues = new Map<number, Promise<unknown>>(); // the last call on each tab, the next one waits for it
const stops = new Map<number, (e: Error) => void>(); // ends the running call on a tab
const listeners = new Map<number, { event: CdpEvent; listener: (params: Record<string, unknown>) => void }[]>(); // the running call's, by tab

export const attachedTabs = () => [...attached];

// The chat's chip and the icon's badge follow what is attached.
function changed() {
  const tabs = attachedTabs();
  deps.setDebuggerBadge(tabs.length);
  void bestEffort(sendRuntime({ type: DEVTOOLS_STATUS, tabs }), 'devtools-status');
}

let listening = false;
function listenDetach() {
  if (listening) return;
  listening = true;
  browser.debugger.onDetach.addListener((source, reason) => {
    if (source.tabId === undefined || !attached.delete(source.tabId)) return;
    stops.get(source.tabId)?.(new DevtoolsDetachedError(reason));
    const hold = holds.get(source.tabId);
    holds.delete(source.tabId);
    hold?.onEnded(reason);
    changed();
  });
  browser.debugger.onEvent.addListener((source, method, params) => {
    if (source.tabId === undefined) return;
    for (const l of listeners.get(source.tabId) ?? []) if (l.event === method) l.listener((params ?? {}) as Record<string, unknown>);
    // A recording's: the tab's own events and its workers' (their child session in flat mode).
    for (const l of holds.get(source.tabId)?.listeners ?? []) if (l.event === method) l.listener((params ?? {}) as Record<string, unknown>, source.sessionId);
  });
}

async function attach(tabId: number) {
  try {
    await browser.debugger.attach({ tabId }, VERSION);
  } catch (e) {
    if (/already attached/i.test(errorText(e))) throw new Error(text('error.devtools_busy'));
    throw e;
  }
  attached.add(tabId);
  changed();
}

async function detach(tabId: number) {
  if (!attached.delete(tabId)) return; // detached by the browser already
  await Promise.race([browser.debugger.detach({ tabId }).catch(() => undefined), sleep(DETACH_MS)]);
  changed();
}

// A call's session: once the call ends (done, timed out, detached) it sends nothing more, so a step
// still running after a time limit cannot act inside the tab's next call.
const session = (tabId: number, live: () => boolean): CdpSession => ({
  send: async <T>(method: CdpMethod, params?: Record<string, unknown>) => {
    if (!(CDP_METHODS as readonly string[]).includes(method)) throw new Error(`CDP method not allowed: ${method}`);
    if (!live()) throw new Error('This Chromium DevTools call has ended');
    return (await browser.debugger.sendCommand({ tabId }, method, params)) as T;
  },
  on: (event, listener) => {
    if (!(CDP_EVENTS as readonly string[]).includes(event)) throw new Error(`CDP event not allowed: ${event}`);
    if (live()) listeners.set(tabId, [...(listeners.get(tabId) ?? []), { event, listener }]);
  },
});

const HELD = 'A recording is in progress on this tab: stop it first.';

async function run<T>(tabId: number, fn: (s: CdpSession) => Promise<T>, timeoutMs: number): Promise<T> {
  if (holds.has(tabId)) throw new Error(HELD);
  await requireEngine();
  listenDetach();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stopped = new Promise<never>((_, reject) => {
    stops.set(tabId, reject);
    timer = setTimeout(() => reject(new Error(`Chromium DevTools call timed out after ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
  });
  let attaching: Promise<void> | undefined;
  let settled = false;
  let live = true;
  try {
    attaching = attach(tabId).finally(() => (settled = true));
    await Promise.race([attaching, stopped]);
    return await Promise.race([fn(session(tabId, () => live)), stopped]);
  } finally {
    live = false;
    listeners.delete(tabId);
    clearTimeout(timer);
    stops.delete(tabId);
    // An attach still going on when the call ended is undone once it is done, without waiting for it.
    if (attaching && !settled) void attaching.then(() => detach(tabId), () => undefined);
    else await detach(tabId);
  }
}

// Runs `fn` with the debugger attached to the tab, after the tab's earlier call has ended.
export function withDebugger<T>(tabId: number, fn: (s: CdpSession) => Promise<T>, opts: { timeoutMs?: number } = {}): Promise<T> {
  if (holds.has(tabId)) return Promise.reject(new Error(HELD)); // at once, not after the recording
  const call = (queues.get(tabId) ?? Promise.resolve()).catch(() => undefined).then(() => run(tabId, fn, opts.timeoutMs ?? TIME_LIMIT_MS));
  queues.set(tabId, call);
  void call.finally(() => {
    if (queues.get(tabId) === call) queues.delete(tabId);
  }).catch(() => undefined);
  return call;
}

// --- A recording's hold (recording/devtools): the debugger kept on a tab while the user records it,
// with the methods and events only a recording may use. Tool calls on the tab fail meanwhile.
// Runtime.runIfWaitingForDebugger: a worker the recording attached to waits for it before it runs.
export const RECORDING_METHODS = ['Network.enable', 'Network.getResponseBody', 'Network.getRequestPostData', 'Target.setAutoAttach', 'Runtime.runIfWaitingForDebugger'] as const;
export type RecordingMethod = (typeof RECORDING_METHODS)[number];
export const RECORDING_EVENTS = [
  'Network.requestWillBeSent', 'Network.responseReceived', 'Network.loadingFinished', 'Network.loadingFailed',
  'Network.webSocketCreated', 'Network.webSocketFrameSent', 'Network.webSocketFrameReceived', 'Target.attachedToTarget',
] as const;
export type RecordingEvent = (typeof RECORDING_EVENTS)[number];
type RecordingListener = (params: Record<string, unknown>, childSessionId?: string) => void;

export interface RecordingSession {
  send<T = unknown>(method: RecordingMethod, params?: Record<string, unknown>, childSessionId?: string): Promise<T>;
  on(event: RecordingEvent, listener: RecordingListener): void;
  release(): Promise<void>;
}

const holds = new Map<number, { listeners: { event: RecordingEvent; listener: RecordingListener }[]; onEnded: (reason: string) => void }>();

// Holds the tab for a recording, once its running call has ended (the tab's queue).
export function holdForRecording(tabId: number, onEnded: (reason: string) => void): Promise<RecordingSession> {
  if (holds.has(tabId)) return Promise.reject(new Error(HELD));
  const held = (queues.get(tabId) ?? Promise.resolve()).catch(() => undefined).then(async (): Promise<RecordingSession> => {
    await requireEngine();
    listenDetach();
    await attach(tabId);
    const hold = { listeners: [] as { event: RecordingEvent; listener: RecordingListener }[], onEnded };
    holds.set(tabId, hold);
    return {
      send: async <T>(method: RecordingMethod, params?: Record<string, unknown>, childSessionId?: string) => {
        if (!(RECORDING_METHODS as readonly string[]).includes(method)) throw new Error(`CDP method not allowed: ${method}`);
        if (holds.get(tabId) !== hold) throw new Error('This recording has ended');
        return (await browser.debugger.sendCommand(childSessionId ? { tabId, sessionId: childSessionId } : { tabId }, method, params)) as T;
      },
      on: (event, listener) => {
        if (!(RECORDING_EVENTS as readonly string[]).includes(event)) throw new Error(`CDP event not allowed: ${event}`);
        hold.listeners.push({ event, listener });
      },
      release: async () => {
        if (holds.get(tabId) !== hold) return;
        holds.delete(tabId);
        await detach(tabId);
      },
    };
  });
  queues.set(tabId, held);
  return held;
}

// The background: the tabs attached now, for a chat that opens while a call runs.
export function listenDevtools(given: DevtoolsDeps) {
  deps = given;
  onRuntime(DEVTOOLS_STATUS, (_msg, sender) => (isExtensionPage(sender) ? { tabs: attachedTabs() } : undefined));
  if (!browser.debugger) return; // the store's build has no debugger permission (core/build)
  listenDetach();
  // A worker that stopped mid-call (the browser stops idle ones) left its debugger attached and the
  // badge on: undone when it starts again. getTargets cannot tell who attached a tab (its extensionId
  // names a background page's extension, and attached is true for any client, the user's DevTools too):
  // each attached tab is detached, which fails harmlessly where this extension is not the one attached.
  // Not a tab a call of this worker has attached since.
  void bestEffort(
    browser.debugger.getTargets().then(async (targets) => {
      for (const t of targets) if (t.attached && t.tabId !== undefined && !attached.has(t.tabId)) await browser.debugger.detach({ tabId: t.tabId }).catch(() => undefined);
      deps.setDebuggerBadge(attached.size);
    }),
    'devtools-left-attached',
  );
}
