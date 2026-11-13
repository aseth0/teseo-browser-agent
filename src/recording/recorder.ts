// The background's one recording of a page's requests (the toolbar popup's Record line, the shortcut:
// background/recording-host). It runs an engine — DevTools when its engine is on
// (recording/devtools), else webRequest and the page's hooks (recording/webrequest) — with the preset
// chosen, publishes its status (RECORDING_STATUS), mirrors what it caught (RECORDING_LIVE) for a worker
// that restarts, and once stopped waits for a chat to review it (RECORDING_HANDOFF). It never sends
// anything to the model: the review does, once the user says so.
import { browser } from 'wxt/browser';
import { errorText } from '../core/errors';
import { hostOf } from '../core/util';
import { storageGet } from '../storage/area';
import { watchKey } from '../storage/watch';
import type { HandoffTo } from '../core/handoff';
import { startCapture, type CaptureMessage, type CaptureMode } from './devtools';
import type { RecordingPreset } from './presets';
import type { Recording } from './recording';
import { RECORDING_HANDOFF, RECORDING_LIVE, RECORDING_STATUS, RECORDING_WAIT_MS, isRecordingHandoff, recordingHandoff, type RecordingStatus } from './recorder-protocol';
import { initialTicks } from './review';
import { SETTLE_MS, startWebRequest } from './webrequest';

const CUT_BODY = 2000;
const CUT_NOTE = `Bodies cut to ${CUT_BODY.toLocaleString('en-US')} characters: the recording was too big to hand to the chat.`;
// An engine's reason ("no access to shop.example.test") as the sentence a failed start says.
const sentence = (why: string) => `${why.charAt(0).toUpperCase()}${why.slice(1).replace(/\.?$/, '.')}`;

export interface StartOptions {
  tabId: number;
  windowId: number;
  url: string;
  mode: CaptureMode; // only through DevTools: else this tab
  preset: RecordingPreset;
  devtools: boolean;
}

interface Deps {
  awake: (on: boolean) => void; // the worker kept awake while it records (background/keep-awake)
  route: (tabId: number) => HandoffTo; // the chat a recording that stopped by itself goes to
  onChange: (status: RecordingStatus | undefined) => void; // the badge and the pill
  // How long bodies on their way still come after a stop; how often the status and the mirror are written.
  timing?: { settleMs: number; statusMs: number; mirrorMs: number };
}

type Live = { recording: Recording; status: RecordingStatus; engine: Promise<{ stop(): Promise<void> }>; finishing?: Promise<Recording> };

export function createRecorder(deps: Deps) {
  const timing = deps.timing ?? { settleMs: SETTLE_MS, statusMs: 250, mirrorMs: 3000 };
  let live: Live | undefined;
  let starting = false; // its engine not started yet: nothing shown, nothing kept
  // Stopped, until a chat takes it; `handed`: its handoff written (once, unless Review asks again).
  let waiting: { recording: Recording; status: RecordingStatus; handed?: boolean } | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined; // one handed off and not taken is dropped at RECORDING_WAIT_MS
  const status = () => live?.status ?? waiting?.status;

  // Written at once (0 ms), or at most once per `ms`.
  const throttled = (ms: number, write: () => Promise<void>) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return (now = false) => {
      if (now || !ms) {
        clearTimeout(timer);
        timer = undefined;
        return write();
      }
      timer ??= setTimeout(() => {
        timer = undefined;
        void write();
      }, ms);
      return Promise.resolve();
    };
  };
  const writeStatus = throttled(timing.statusMs, async () => {
    const s = status();
    deps.onChange(s);
    await (s ? browser.storage.session.set({ [RECORDING_STATUS]: s }) : browser.storage.session.remove(RECORDING_STATUS));
  });
  // Best effort: storage refusing it (its quota) leaves only a worker restart without what was caught.
  // Written with its bodies whole: the mirror is what a restarted worker hands to the chat, and bodies
  // cut there (as to CUT_BODY on a quota failure) would be cut for the user with no need. It holds no
  // more than the handoff that follows, is removed when the recording ends, and that handoff expires.
  const writeMirror = throttled(timing.mirrorMs, async () => {
    if (live && !live.finishing) await browser.storage.session.set({ [RECORDING_LIVE]: { recording: live.recording, status: live.status } }).catch((e: unknown) => console.error('[recording]', e));
  });

  const change = (f: (r: Recording) => Recording) => {
    if (!live) return;
    const recording = f(live.recording);
    const tabs = [...new Set([live.status.tabId, ...recording.calls.flatMap((c) => (c.tabId === undefined ? [] : [c.tabId])), ...(recording.steps ?? []).map((s) => s.tabId)])];
    live = { ...live, recording, status: { ...live.status, calls: recording.calls.length, leftOut: recording.leftOut ?? 0, tabs } };
    void writeStatus();
    void writeMirror();
  };
  const apply = (m: CaptureMessage) => {
    if ('call' in m) change((r) => ({ ...r, calls: [...r.calls, m.call] }));
    else if ('update' in m) change((r) => ({ ...r, calls: r.calls.map((c) => (c.id === m.update.id ? { ...c, ...m.update } : c)) }));
    else if ('drop' in m) change((r) => ({ ...r, calls: r.calls.filter((c) => c.id !== m.drop) }));
    else if ('leftOut' in m) change((r) => ({ ...r, leftOut: m.leftOut }));
    else if ('step' in m) change((r) => ({ ...r, steps: [...(r.steps ?? []), m.step] }));
    else if ('note' in m) change((r) => ({ ...r, notes: [...(r.notes ?? []), m.note] }));
    else if ('ended' in m && live) void finish(m.ended).then((r) => handOff(deps.route(r.tabId)));
  };

  // Its engine stopped, the bodies on their way let in, what looks sensitive unticked: it waits.
  const finish = (why?: string): Promise<Recording> => {
    const current = live!;
    current.finishing ??= (async () => {
      await (await current.engine.catch(() => undefined))?.stop().catch(() => undefined);
      if (timing.settleMs) await new Promise((r) => setTimeout(r, timing.settleMs));
      // What came in meanwhile: each message replaces `live` (change), keeping its `finishing`.
      const last = live?.finishing === current.finishing ? live! : current;
      const endedAt = Date.now();
      const recording = initialTicks({ ...last.recording, endedAt, ...(why && { stopped: why }) });
      waiting = { recording, status: { ...last.status, state: 'stopped', endedAt, calls: recording.calls.length } };
      live = undefined;
      deps.awake(false);
      await browser.storage.session.remove(RECORDING_LIVE);
      await writeStatus(true);
      return recording;
    })();
    return current.finishing;
  };

  const clear = async () => {
    clearTimeout(expiry);
    waiting = undefined;
    await browser.storage.session.remove([RECORDING_HANDOFF, RECORDING_LIVE]);
    await writeStatus(true);
  };
  // Dropped in `ms` unless a chat takes it (a worker that sleeps meanwhile drops it on resume).
  const expireIn = (ms: number) => {
    clearTimeout(expiry);
    expiry = setTimeout(() => void (waiting && !live && clear()), ms);
  };
  // A chat took the one waiting (it removes the handoff): nothing is left.
  watchKey('session', RECORDING_HANDOFF, (c) => {
    if (c.newValue === undefined && waiting && !live) void clear();
  });

  // Written once per recording; Review hands it `again`, to the chat it opened. Too big for storage, it
  // goes with its bodies cut, and says so.
  async function handOff(to: HandoffTo, opts: { again?: boolean } = {}) {
    if (!waiting || (waiting.handed && !opts.again)) return;
    waiting.handed = true;
    expireIn(RECORDING_WAIT_MS);
    const r = waiting.recording;
    try {
      await browser.storage.session.set({ [RECORDING_HANDOFF]: recordingHandoff(r, to) });
    } catch {
      const cut = (s?: string) => s?.slice(0, CUT_BODY);
      const smaller: Recording = {
        ...r,
        calls: r.calls.map((c) => ({ ...c, requestBody: cut(c.requestBody), responseBody: cut(c.responseBody), ...(c.frames && { frames: c.frames.slice(0, 5).map((f) => ({ ...f, text: cut(f.text)! })) }) })),
        notes: [...(r.notes ?? []), CUT_NOTE],
      };
      await browser.storage.session.set({ [RECORDING_HANDOFF]: recordingHandoff(smaller, to) });
    }
  }

  return {
    status,
    handOff,
    // A start that fails (no access, the debugger refused…) leaves nothing behind and says why.
    async start(o: StartOptions): Promise<'started' | 'waiting' | { error: string }> {
      if (waiting) return 'waiting';
      if (live || starting) return { error: 'A recording is already running.' };
      const site = hostOf(o.url);
      const startedAt = Date.now();
      const mode: CaptureMode = o.devtools ? o.mode : 'tab';
      const recording: Recording = { tabId: o.tabId, site, startedAt, calls: [], hidden: [], preset: o.preset.name, leftOut: 0, ...(o.devtools && { mode, notes: [], steps: [] }) };
      const status: RecordingStatus = { state: 'recording', tabId: o.tabId, windowId: o.windowId, tabs: [o.tabId], site, calls: 0, leftOut: 0, startedAt, preset: o.preset.name, mode };
      starting = true;
      deps.awake(true);
      // What the engine says while it starts waits for it: an end then is a start that failed.
      const early: CaptureMessage[] = [];
      let take: (m: CaptureMessage) => void = (m) => early.push(m);
      const engine = o.devtools
        ? startCapture({ tabId: o.tabId, mode, preset: o.preset, site }, (m) => take(m))
        : startWebRequest({ tabId: o.tabId, preset: o.preset, site }, (m) => take(m));
      const failed = await engine.then(() => early.find((m) => 'ended' in m)?.ended, errorText);
      starting = false;
      if (failed !== undefined) {
        deps.awake(false);
        return { error: sentence(failed) };
      }
      live = { recording, status, engine };
      take = apply;
      early.forEach(apply);
      await writeStatus(true);
      await writeMirror(true);
      return 'started';
    },
    // The recording, stopped now or already: the same each time; none when nothing records.
    async stop(): Promise<Recording | undefined> {
      if (live) return finish();
      return waiting?.recording;
    },
    async discard() {
      if (live) await finish();
      await clear();
    },
    // The worker started again: one waiting waits again; one that was recording stops, as caught (the
    // tabs it recorded come back, for their pills); a status left without either goes.
    async resume(): Promise<number[]> {
      const handoff = await storageGet<unknown>('session', RECORDING_HANDOFF);
      const saved = await storageGet<RecordingStatus>('session', RECORDING_STATUS);
      if (isRecordingHandoff(handoff) && Date.now() - handoff.at >= RECORDING_WAIT_MS) {
        await clear(); // it waited too long while the worker slept
        return [];
      }
      if (isRecordingHandoff(handoff)) {
        const r = handoff.payload.recording;
        expireIn(RECORDING_WAIT_MS - (Date.now() - handoff.at));
        waiting = { recording: r, handed: true, status: saved ?? { state: 'stopped', tabId: r.tabId, windowId: -1, tabs: [r.tabId], site: r.site, calls: r.calls.length, leftOut: r.leftOut ?? 0, startedAt: r.startedAt, endedAt: r.endedAt, preset: r.preset ?? '', mode: r.mode ?? 'tab' } };
        await writeStatus(true);
        return [];
      }
      const mirror = await storageGet<{ recording: Recording; status: RecordingStatus }>('session', RECORDING_LIVE);
      if (!mirror?.recording || !mirror.status) {
        if (saved) await writeStatus(true); // nothing behind it: cleared
        return [];
      }
      const endedAt = Date.now();
      const recording = initialTicks({ ...mirror.recording, endedAt, stopped: 'the extension restarted' });
      waiting = { recording, status: { ...mirror.status, state: 'stopped', endedAt, calls: recording.calls.length } };
      await browser.storage.session.remove(RECORDING_LIVE);
      await handOff(deps.route(recording.tabId));
      await writeStatus(true);
      return mirror.status.tabs;
    },
  };
}
