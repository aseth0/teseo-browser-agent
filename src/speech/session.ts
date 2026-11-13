// The background's one reading (background/speech-host): which profile reads it, the plan sent to the
// offscreen document (speech/player), and its state, published as its status (SPEAK_STATUS) for the pill,
// the popup and the panel's buttons. A new reading replaces the one in progress, and empties the queue; one
// read on its own (`queued`: an answer as it ends, an action's boxes as they show) waits its turn in that
// queue instead, and is read once the one before it ends. Stop ends it wherever it is, the queue with it.
// The queue lives in the worker alone: one that sleeps between readings forgets it.
// Without a voice profile, the system's own voice reads it (speech/system-voice), unless it is switched off.
import { speakAvailable } from '../core/build';
import { errorText } from '../core/errors';
import type { ProviderConfig, Settings } from '../storage/settings';
import type { VoiceProfile } from '../storage/settings-types';
import { limit } from '../core/limits';
import { capped, readingPlan } from './plan';
import type { PlannedPiece, PlanOptions } from './plan';
import { finalPieces, plannedFrom, wholeSentencesEnd } from './growing';
import type { SpeakStarted, SpeakStatus } from './protocol';
import { planOptions, profileOr, speakLanguage, speakOn, speechTarget, systemVoiceOn, type SpeechTarget } from './settings';
import type { SystemVoice } from './system-voice';

export const NO_PROFILE = 'Add a voice profile in Settings → Speak to read aloud, or switch its system voice on.';
const NO_ANSWER = 'The offscreen document did not answer.';
const GROW_IDLE_MS = 60_000; // a text read as it is written, done once it has not grown this long

// What is to be read, and with which voice: a profile given (Settings' Test), one named, else the agent's
// (none named: the active agent's), else the default one.
export interface SpeakRequest {
  text: string;
  profile?: VoiceProfile;
  profileId?: string;
  agentId?: string;
  tabId?: number; // where its pill shows
  key?: string;
  queued?: boolean; // read on its own: waits for the reading in progress instead of replacing it
  growing?: boolean; // its text is still written: read as it grows (grow), until it is `done`
  done?: boolean;
}

export interface SpeechDeps {
  settings: () => Promise<Settings>;
  agentProfileId: (s: Settings, agentId: string | undefined) => Promise<string | undefined>;
  unreachable: (p: ProviderConfig) => Promise<string | undefined>; // why its site cannot be reached
  open: () => Promise<void>; // the offscreen document, created if it is not open
  play: (run: string, pieces: PlannedPiece[], target: SpeechTarget, done: boolean) => Promise<{ ok: true } | { error: string } | undefined>;
  more: (run: string, pieces: PlannedPiece[], done: boolean) => Promise<void>; // a growing reading's next pieces
  halt: () => Promise<void>;
  held: () => Promise<string | undefined>; // the run the offscreen document plays, if any
  load: () => Promise<SpeakStatus | undefined>;
  save: (s: SpeakStatus | undefined) => Promise<void>;
  onChange: (s: SpeakStatus | undefined, before: SpeakStatus | undefined) => void;
  failed: (error: string) => void; // a reading that broke off by itself
  newRun: () => string;
  now?: () => number;
  system?: SystemVoice; // the system's voice, for a reading without a profile
}

export function createSpeechSession(deps: SpeechDeps) {
  let status: SpeakStatus | undefined;
  let queue: SpeakRequest[] = []; // the readings on their own that wait their turn, in order
  let growing: { run: string; key: string; sent: number; o: PlanOptions; system: boolean; text: string } | undefined; // the reading whose text is still written
  const growingRun = () => growing?.run; // read anew: a call may have changed it
  // A text that stops growing without being said done (its chat closed, its card gone) is done once it has
  // not grown for a while: what is final of it is read, and the reading ends.
  let idle: ReturnType<typeof setTimeout> | undefined;
  const watch = () => {
    clearTimeout(idle);
    const g = growing;
    if (g) idle = setTimeout(() => void (growing === g && growNow(g.key, g.text.slice(0, wholeSentencesEnd(g.text)), true)), GROW_IDLE_MS);
  };
  const waitingKeys = () => queue.map((r) => r.key ?? '');
  const withWaiting = (s: SpeakStatus): SpeakStatus => {
    const { waiting: _, ...rest } = s;
    return queue.length ? { ...rest, waiting: waitingKeys() } : rest;
  };
  const set = async (next: SpeakStatus | undefined) => {
    const before = status;
    status = next;
    deps.onChange(next, before);
    await deps.save(next);
  };
  // A worker that woke: the reading it had, if the offscreen document still plays it.
  const ready = (async () => {
    const kept = await deps.load().catch(() => undefined);
    if (!kept) return;
    const held = kept.system ? ((await deps.system?.speaking().catch(() => false)) ? kept.run : undefined) : await deps.held().catch(() => undefined);
    if (held === kept.run) status = kept;
    else {
      deps.onChange(undefined, kept);
      await deps.save(undefined);
    }
  })();

  const whichProfile = async (s: Settings, r: SpeakRequest) => r.profile ?? profileOr(s, r.profileId ?? (await deps.agentProfileId(s, r.agentId)));

  // A reading asked for: one on its own waits while another is read; any other empties the queue.
  // One being started counts as read: a box asked for meanwhile waits for it.
  let launching = 0;
  const start = async (r: SpeakRequest): Promise<SpeakStarted> => {
    await ready;
    if (r.queued && (status || launching)) {
      queue.push(r);
      if (status) await set(withWaiting(status));
      return { started: true, queued: true };
    }
    if (!r.queued) queue = [];
    const reply = await launched(r);
    // One that could not start: those that waited for it go on.
    if (!('started' in reply) && !status && !launching) void next();
    return reply;
  };
  const launched = async (r: SpeakRequest): Promise<SpeakStarted> => {
    launching++;
    try {
      return await launch(r);
    } catch (e) {
      return { error: errorText(e) };
    } finally {
      launching--;
    }
  };

  // The next reading that waits, once the one before it ended: those that cannot start are said, and skipped.
  const next = async (): Promise<boolean> => {
    while (queue.length) {
      const reply = await launched(queue.shift()!);
      if ('started' in reply) return true;
      deps.failed(reply.error);
    }
    return false;
  };

  // What a request reads: all its pieces; a text still written (`growing`), those final so far (speech/growing).
  // At most Settings → Limits' characters at a time (the settings, just read, applied them): each piece is a
  // request; a growing text cut there is done.
  const planOf = (r: SpeakRequest, o: PlanOptions) => {
    const read = capped(r.growing ? r.text.trimStart() : r.text.trim(), limit('speakText'));
    if (!r.growing) return { pieces: readingPlan(read.text, o), cut: read.cut, done: true, sent: 0 };
    const done = r.done === true || read.cut;
    const parts = finalPieces(read.text, done, o.first, o.rest);
    return { pieces: plannedFrom(parts, 0, done, o), cut: read.cut, done, sent: parts.length };
  };
  // Once started, a reading still growing: its run, key, how many pieces were sent, and how it is cut.
  const growsWith = (r: SpeakRequest, plan: ReturnType<typeof planOf>, o: PlanOptions, system: boolean) => (run: string) => {
    if (!plan.done && r.key) growing = { run, key: r.key, sent: plan.sent, o, system, text: r.text };
    watch();
  };

  // The reading of `key`, if it is the one growing, gets its new final pieces.
  const growNow = async (key: string, text: string, done: boolean) => {
    const g = growing;
    if (!g || g.key !== key || status?.run !== g.run) return;
    g.text = text;
    const read = capped(text.trimStart(), limit('speakText'));
    const over = done || read.cut;
    const parts = finalPieces(read.text, over, g.o.first, g.o.rest);
    const fresh = plannedFrom(parts, g.sent, over, g.o);
    watch();
    if (!fresh.length && !over) return;
    g.sent = Math.max(g.sent, parts.length);
    if (over) {
      growing = undefined;
      clearTimeout(idle);
    }
    await set(withWaiting({ ...status, total: Math.max(status.total, g.sent), ...(read.cut && { cut: true as const }) }));
    await (g.system ? deps.system?.more(g.run, fresh, over) : deps.more(g.run, fresh, over));
  };

  const launch = async (r: SpeakRequest): Promise<SpeakStarted> => {
    if (!speakAvailable()) return { error: 'This browser cannot read aloud: it has no offscreen documents.' };
    const s = await deps.settings();
    if (!r.profile && !speakOn(s)) return { error: 'Speak is off in Settings → Speak.', settings: 'speak' };
    const profile = await whichProfile(s, r);
    if (!profile) return deps.system && systemVoiceOn(s) ? startSystem(s, r, deps.system) : { error: NO_PROFILE, settings: 'speak' };
    const target = speechTarget(s, profile);
    if ('error' in target) return { ...target, settings: 'speak' };
    const o = planOptions(s, profile);
    const plan = planOf(r, o);
    if (!plan.pieces.length) return { error: 'There is no text to read.' };
    const noAccess = await deps.unreachable(target.provider);
    if (noAccess) return { error: noAccess };

    await deps.system?.stop(); // the system voice's reading, if one goes on
    return begin(r, plan.pieces.length, plan.cut, async (run) => {
      await deps.open();
      return deps.play(run, plan.pieces, target, plan.done);
    }, false, growsWith(r, plan, o, false));
  };

  // Read by the system's voice: the same pieces, in the language whose reading rules apply.
  const startSystem = async (s: Settings, r: SpeakRequest, system: SystemVoice): Promise<SpeakStarted> => {
    const o = planOptions(s);
    const plan = planOf(r, o);
    if (!plan.pieces.length) return { error: 'There is no text to read.' };
    await deps.halt().catch(() => undefined); // a profile's reading, if one goes on
    const lang = speakLanguage(s);
    return begin(r, plan.pieces.length, plan.cut, (run) => system.play(run, plan.pieces, { ...(lang && { lang }) }, plan.done), true, growsWith(r, plan, o, true));
  };

  // A reading begun: its status, then what plays it; none when it could not start.
  const begin = async (r: SpeakRequest, total: number, cut: boolean, play: (run: string) => ReturnType<SpeechDeps['play']>, system = false, started?: (run: string) => void): Promise<SpeakStarted> => {
    const run = deps.newRun();
    growing = undefined;
    started?.(run); // before it plays: what grows meanwhile goes on to it
    await set(withWaiting({ run, state: 'preparing', piece: 1, total, startedAt: (deps.now ?? Date.now)(), ...(r.tabId !== undefined && { tabId: r.tabId }), ...(r.key && { key: r.key }), ...(cut && { cut: true as const }), ...(system && { system: true as const }) }));
    let reply: Awaited<ReturnType<SpeechDeps['play']>>;
    try {
      reply = await play(run);
    } catch (e) {
      reply = { error: errorText(e) };
    }
    if (reply && 'ok' in reply) return { started: true };
    if (growingRun() === run) growing = undefined;
    if (status?.run === run) await set(undefined);
    return { error: reply?.error ?? NO_ANSWER };
  };

  const stop = async () => {
    await ready;
    queue = [];
    growing = undefined;
    await deps.halt().catch(() => undefined);
    await deps.system?.stop().catch(() => undefined);
    if (status) await set(undefined);
  };

  return {
    ready,
    status: () => status,
    start,
    stop,
    // A text still written grew (the whole of it so far), or is done: what waits takes it; the reading of it
    // gets its new final pieces.
    async grow(key: string, text: string, done: boolean) {
      await ready;
      for (const r of queue) if (r.key === key && r.growing) Object.assign(r, { text, done });
      await growNow(key, text, done);
    },
    // The readings that wait whose key starts with `prefix` (on `tabId`, when given) dropped: an action's
    // boxes once its card closes or another action runs.
    async unqueue(prefix: string, tabId?: number) {
      await ready;
      const before = queue.length;
      queue = queue.filter((r) => !(r.key?.startsWith(prefix) && (tabId === undefined || r.tabId === tabId)));
      if (status && queue.length !== before) await set(withWaiting(status));
    },
    // From the offscreen document: a piece sounds, or the next is awaited.
    async progressed(m: { run: string; piece: number; total: number; playing: boolean }) {
      await ready;
      if (status?.run !== m.run) return;
      await set(withWaiting({ ...status, state: m.playing ? 'reading' : 'preparing', piece: m.piece, total: m.total }));
    },
    async ended(m: { run: string; error?: string }) {
      await ready;
      if (status?.run !== m.run) return;
      if (growing?.run === m.run) growing = undefined;
      if (m.error) {
        queue = []; // a server that broke off would fail the next ones too
        await set(undefined);
        return deps.failed(m.error);
      }
      if (!(await next()) && status?.run === m.run) await set(undefined);
    },
  };
}
