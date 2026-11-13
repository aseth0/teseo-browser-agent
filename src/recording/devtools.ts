// The ⏺ recording through DevTools (Settings → Chromium DevTools on): every call the page makes, also
// those today's recording misses (before the page is hooked, Web Workers, beacons, form posts,
// WebSockets), in one tab or every tab the user goes to. What the preset leaves out (recording/filter),
// static resources always, is only counted as it comes; header values and cookies are never kept,
// secret-looking values hidden on arrival (recording.ts).
// Only the user starts it (recording/recorder, from the side panel, the popup or a shortcut); the model cannot.
import { browser } from 'wxt/browser';
import { errorText } from '../core/errors';
import { hostOf } from '../core/util';
import { holdForRecording, type RecordingSession } from '../devtools/cdp';
import { hasAccess } from '../page/access';
import { callPage } from '../page/bridge';
import { onRuntime } from '../core/runtime';
import { hideSecretsInUrl, type RecordedCall } from './recording';
import { bodyText, fromBase64, joined, readBody, sentBodyOf } from './bodies';
import { typeOfCdp } from './filter';
import { ledger, type CaptureMessage, type CaptureMode, type Ledger } from './ledger';
import type { RecordingPreset } from './presets';

export type { CaptureMessage, CaptureMode } from './ledger';

const MAX_FRAMES = 50;
const WORKERS = new Set(['worker', 'service_worker', 'shared_worker']);

// `site`: the recorded tab's host, for a preset that keeps only its site.
export async function startCapture(opts: { tabId: number; mode: CaptureMode; preset: RecordingPreset; site: string }, emit: (m: CaptureMessage) => void): Promise<{ stop(): Promise<void> }> {
  const { preset } = opts;
  const held = new Map<number, RecordingSession>();
  let calls: Ledger; // the calls kept and left out, once the tab is known
  // Secrets hidden in the whole body, then cut (recording/bodies): a cut JSON could no longer be read to hide them.
  const max = preset.maxBody;
  const text = (body: string, type?: string) => bodyText(body, max, type);
  let over = false;
  const mouse = opts.mode === 'tabs-mouse';
  const key = `ba-steps-${crypto.randomUUID()}`;
  // The user's steps, from the recorded tabs only, under this recording's key.
  const offSteps = mouse
    ? onRuntime('recording-step', (msg, sender) => {
        const tabId = sender.tab?.id;
        if (over || msg.key !== key || tabId === undefined || !held.has(tabId)) return;
        emit({ step: { ...msg.step, tabId } });
      })
    : undefined;
  let windowId: number;
  try {
    windowId = (await browser.tabs.get(opts.tabId)).windowId;
  } catch (e) {
    offSteps?.();
    emit({ ended: errorText(e) });
    return { stop: async () => undefined };
  }

  const stop = async (why?: string) => {
    if (over) return;
    over = true;
    calls.end();
    browser.tabs.onActivated.removeListener(activated);
    browser.tabs.onUpdated.removeListener(updated);
    offSteps?.();
    if (mouse) for (const tabId of held.keys()) void callPage(tabId, { op: 'steps-stop', key }).catch(() => undefined);
    await Promise.all([...held.values()].map((h) => h.release().catch(() => undefined)));
    if (why) emit({ ended: why });
  };

  // One tab's calls, as they come.
  const record = (tabId: number, hold: RecordingSession) => {
    // A request's call: a redirect keeps the browser's request id for the next hop, which becomes a call
    // of its own (the id given a hop number).
    const hops = new Map<string, number>();
    const keyOf = (requestId: unknown, child?: string) => `${tabId}:${child ?? ''}:${String(requestId)}`;
    const idOf = (requestId: unknown, child?: string) => {
      const key = keyOf(requestId, child);
      const hop = hops.get(key);
      return hop ? `${key}~${hop}` : key;
    };
    const known = (id: string) => calls.has(id);
    const answered = calls.answered;
    hold.on('Network.requestWillBeSent', (p, child) => {
      if (over) return;
      const redirected = p.redirectResponse as { status: number } | undefined;
      if (redirected && known(idOf(p.requestId, child))) {
        const hop = idOf(p.requestId, child);
        if (answered(hop, { status: redirected.status })) emit({ update: { id: hop, status: redirected.status } });
        const key = keyOf(p.requestId, child);
        hops.set(key, (hops.get(key) ?? 0) + 1);
      }
      const req = p.request as { method: string; url: string; headers?: Record<string, string>; postData?: string; hasPostData?: boolean; postDataEntries?: { bytes?: string }[] };
      const url = hideSecretsInUrl(req.url);
      const id = idOf(p.requestId, child);
      // Its bytes as sent (postData is text DevTools made of them, garbled when they are not UTF-8); the
      // values of Content-Encoding and Content-Type only read to unpack them, never kept.
      const header = (name: string) => Object.entries(req.headers ?? {}).find(([k]) => k.toLowerCase() === name)?.[1];
      const how = { encoding: header('content-encoding'), type: header('content-type'), max };
      const entries = (req.postDataEntries ?? []).flatMap((e) => (e.bytes === undefined ? [] : [fromBase64(e.bytes)]));
      const { requestBody, sameAs, unpacked } = sentBodyOf(entries.length ? joined(entries) : req.postData, how);
      if (!calls.keeps({ method: req.method, url, type: typeOfCdp(String(p.type)), requestBody: sameAs })) return;
      const kept = calls.add({
        id, method: req.method, url, at: Date.now(), included: true, tabId,
        headerNames: Object.keys(req.headers ?? {}),
        ...(requestBody !== undefined && { requestBody }),
      }, sameAs);
      if (!kept) return;
      // A packed body comes once unpacked; one DevTools did not give, once asked for.
      const later = (body: Promise<string>) => void body.then((b) => known(id) && emit({ update: { id, requestBody: b } }), () => undefined);
      if (unpacked) later(unpacked);
      else if (req.hasPostData && entries.length === 0 && req.postData === undefined) {
        later(hold.send<{ postData: string; base64Encoded?: boolean }>('Network.getRequestPostData', { requestId: p.requestId }, child).then(
          (r) => (r.base64Encoded ? readBody(fromBase64(r.postData), how) : text(r.postData, how.type)),
        ));
      }
    });
    const types = new Map<string, string>(); // each answer's type, to read its body by
    hold.on('Network.responseReceived', (p, child) => {
      const id = idOf(p.requestId, child);
      const res = p.response as { status: number; mimeType?: string };
      if (res.mimeType) types.set(id, res.mimeType);
      if (known(id) && answered(id, { status: res.status, responseType: res.mimeType })) emit({ update: { id, status: res.status, ...(res.mimeType && { responseType: res.mimeType }) } });
    });
    // The body asked at once: later it may be gone (the spike showed it). The browser has undone its
    // Content-Encoding already; one packed by the site itself is known by its first bytes.
    hold.on('Network.loadingFinished', (p, child) => {
      const id = idOf(p.requestId, child);
      if (!known(id)) return;
      void hold.send<{ body: string; base64Encoded: boolean }>('Network.getResponseBody', { requestId: p.requestId }, child)
        .then((r) => (r.base64Encoded ? readBody(fromBase64(r.body), { type: types.get(id), max }) : text(r.body, types.get(id))))
        .then((responseBody) => known(id) && emit({ update: { id, responseBody } }), () => undefined);
    });
    hold.on('Network.loadingFailed', (p, child) => {
      const id = idOf(p.requestId, child);
      const error = String(p.errorText ?? 'failed');
      if (known(id) && answered(id, { error })) emit({ update: { id, error } });
    });
    // A WebSocket: one call, its text frames inside it.
    const frames = new Map<string, NonNullable<RecordedCall['frames']>>();
    hold.on('Network.webSocketCreated', (p, child) => {
      if (over) return;
      const id = idOf(p.requestId, child);
      const url = hideSecretsInUrl(String(p.url));
      if (!calls.keeps({ method: 'WS', url, type: 'socket' })) return;
      frames.set(id, []);
      calls.add({ id, method: 'WS', url, at: Date.now(), included: true, tabId });
    });
    const frame = (dir: 'sent' | 'got') => (p: Record<string, unknown>, child?: string) => {
      const id = idOf(p.requestId, child);
      const list = frames.get(id);
      const res = p.response as { opcode: number; payloadData: string };
      if (!list || list.length >= MAX_FRAMES || res.opcode !== 1) return;
      list.push({ dir, text: text(res.payloadData) });
      emit({ update: { id, frames: [...list] } });
    };
    hold.on('Network.webSocketFrameSent', frame('sent'));
    hold.on('Network.webSocketFrameReceived', frame('got'));
    // Workers report their own requests in their child sessions.
    hold.on('Target.attachedToTarget', (p) => {
      const info = p.targetInfo as { type: string };
      const child = String(p.sessionId);
      // A worker waits for its debugger: let it run, with its requests reported (any other target too).
      const enable = WORKERS.has(info.type) ? hold.send('Network.enable', undefined, child) : Promise.resolve();
      void enable.catch(() => undefined).then(() => hold.send('Runtime.runIfWaitingForDebugger', undefined, child)).catch(() => undefined);
    });
  };

  // A tab joins: only one the extension may read, held for the recording.
  const join = async (tabId: number, first: boolean) => {
    if (over || held.has(tabId)) return;
    const tab = await browser.tabs.get(tabId);
    if (over) return;
    const site = hostOf(tab.url);
    if (!tab.url || !/^https?:/.test(tab.url) || !(await hasAccess(tab.url))) {
      if (first) return void stop(`no access to ${site || 'this page'}`);
      return emit({ note: `not recorded: no access to ${site || 'this page'}` });
    }
    let hold: RecordingSession;
    try {
      hold = await holdForRecording(tabId, (reason) => {
        held.delete(tabId);
        if (first || !held.size) void stop(`the debugger was detached (${reason})`);
        else emit({ note: `${site}: the debugger was detached (${reason})` });
      });
    } catch (e) {
      if (first) return void stop(errorText(e));
      return emit({ note: `${site}: not recorded (${errorText(e)})` });
    }
    // Stopped while it waited for the tab (a tool call on it): let it go at once.
    if (over) return void hold.release().catch(() => undefined);
    held.set(tabId, hold);
    record(tabId, hold);
    await hold.send('Network.enable');
    await hold.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    // "Now here, now there": the move to another tab, in its place among the calls.
    if (!first) emit({ step: { at: Date.now(), tabId, kind: 'tab', target: `${tab.title ?? ''} (${site})` } });
    if (!mouse) return;
    await callPage(tabId, { op: 'steps-start', key }).catch((e: unknown) => emit({ note: `${site}: your steps are not recorded (${errorText(e)})` }));
  };

  const many = opts.mode !== 'tab';
  const activated = (info: { tabId: number; windowId: number }) => {
    if (many && info.windowId === windowId) void join(info.tabId, false);
  };
  // A held tab that goes to a site the extension may not read is let go; one that loads a page gets
  // its steps watched again (a new page has a new page script).
  const leave = async (tabId: number, url: string) => {
    if (await hasAccess(url).catch(() => false)) return;
    const hold = held.get(tabId);
    if (!hold || over) return;
    held.delete(tabId);
    await hold.release().catch(() => undefined);
    const site = hostOf(url) || 'this page';
    if (!held.size) return void stop(`no access to ${site}`);
    emit({ note: `not recorded: no access to ${site}` });
  };
  const updated = (tabId: number, change: { url?: string; status?: string }, tab: { windowId: number; url?: string }) => {
    if (over) return;
    if (held.has(tabId)) {
      if (change.url && /^https?:/.test(change.url)) void leave(tabId, change.url);
      else if (change.url) void leave(tabId, 'about:blank');
      if (mouse && change.status === 'complete') void callPage(tabId, { op: 'steps-start', key }).catch(() => undefined);
      return;
    }
    if (many && change.url && tab.windowId === windowId) void join(tabId, false);
  };
  browser.tabs.onActivated.addListener(activated);
  browser.tabs.onUpdated.addListener(updated);
  calls = ledger(preset, opts.site, emit, (why) => void stop(why));

  // The first tab failing once held (its Network refused…): let go, the capture ends saying why.
  await join(opts.tabId, true).catch((e: unknown) => stop(errorText(e)));
  return { stop: () => stop() };
}
