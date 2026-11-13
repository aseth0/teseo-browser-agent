// A reading in the offscreen document: the pieces asked for one after another (a producer) while those
// already back play (a consumer), scheduled back to back on one AudioContext so that they join without a
// gap, a piece that stops inside a sentence without its closing silence (speech/trim). Each reading has its
// run; Stop or a new reading leaves the old loops nothing to do: what they bring back is dropped.
import { errorText } from '../core/errors';
import type { PlannedPiece } from './plan';
import type { SpeechTarget } from './settings';
import { keptFrames } from './trim';

// A clip decoded, and one scheduled.
export interface Clip {
  duration: number; // seconds
}
export interface Playing {
  startsAt: number;
  endsAt: number;
  ended: Promise<void>; // played to its end, or stopped
  stop: () => void;
}
// Where clips sound (webAudioOut; a fake in the tests).
export interface AudioOut {
  decode: (data: ArrayBuffer, trim: boolean) => Promise<Clip>;
  play: (clip: Clip, at: number) => Playing; // at `at`, or now if that is past
}

export type PlayerEvent = { kind: 'progress'; run: string; piece: number; total: number; playing: boolean } | { kind: 'ended'; run: string; error?: string };

interface Deps {
  fetchClip: (target: SpeechTarget, input: string, signal: AbortSignal) => Promise<ArrayBuffer>;
  out: AudioOut;
  tell: (e: PlayerEvent) => void;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((ok, no) => ((resolve = ok), (reject = no)));
  promise.catch(() => undefined); // read later, or never once stopped
  return { promise, resolve, reject };
}

// A reading's state: its pieces so far, a clip for each, and whether more may come (a text still written).
interface Reading {
  run: string;
  pieces: PlannedPiece[];
  clips: Deferred<Clip>[];
  done: boolean;
  played: number; // clips played to their end
}

export function createPlayer({ fetchClip, out, tell }: Deps) {
  let run: string | undefined;
  let abort: AbortController | undefined;
  let sounding: Playing[] = [];
  let reading: Reading | undefined;

  // Until more pieces come (or the text is done): a waiter woken by `more`, each loop its own.
  const waiters = new Set<() => void>();
  const more = () => new Promise<void>((resolve) => waiters.add(resolve));
  const wakeAll = () => {
    for (const w of [...waiters]) w();
    waiters.clear();
  };

  const halt = () => {
    run = undefined;
    reading = undefined;
    wakeAll(); // the loops waiting for more see it is over
    abort?.abort();
    abort = undefined;
    for (const p of sounding) p.stop();
    sounding = [];
  };
  const finish = (r: string) => {
    run = undefined;
    reading = undefined;
    abort = undefined;
    tell({ kind: 'ended', run: r });
  };
  // Asks for each piece in turn; a failure fails the rest.
  const produce = async (st: Reading, target: SpeechTarget, signal: AbortSignal) => {
    for (let i = 0; ; i++) {
      while (run === st.run && i >= st.pieces.length && !st.done) await more();
      if (run !== st.run || i >= st.pieces.length) return;
      try {
        const data = await fetchClip(target, st.pieces[i]!.input, signal);
        st.clips[i]!.resolve(await out.decode(data, st.pieces[i]!.trim));
      } catch (e) {
        for (const c of st.clips.slice(i)) c.reject(e);
        return;
      }
    }
  };

  // Plays each clip once it is back, right after the one before it.
  const consume = async (st: Reading) => {
    const r = st.run;
    let at = 0;
    let scheduled = -1;
    for (let i = 0; ; i++) {
      while (run === r && i >= st.clips.length && !st.done) await more();
      if (run !== r || i >= st.clips.length) return;
      let clip: Clip;
      try {
        clip = await st.clips[i]!.promise;
      } catch (e) {
        if (run !== r) return;
        halt();
        return tell({ kind: 'ended', run: r, error: errorText(e) });
      }
      if (run !== r) return;
      const before = sounding.at(-1);
      const p = out.play(clip, at);
      sounding.push(p);
      at = p.endsAt;
      scheduled = i;
      // It sounds once the one before it ends (or now).
      void (before?.ended ?? Promise.resolve()).then(() => run === r && tell({ kind: 'progress', run: r, piece: i + 1, total: st.pieces.length, playing: true }));
      void p.ended.then(() => {
        if (run !== r) return;
        sounding = sounding.filter((x) => x !== p);
        st.played = i + 1;
        if (st.done && i === st.pieces.length - 1) finish(r);
        else if (scheduled === i) tell({ kind: 'progress', run: r, piece: i + 2, total: Math.max(st.pieces.length, i + 2), playing: false }); // the next is not back yet
      });
    }
  };

  return {
    held: () => run,
    halt,
    // A new reading, in place of any other: answered once the first clip is back, or why not. Not `done`:
    // its text is still written, and more pieces come (`more`).
    async play(r: string, pieces: PlannedPiece[], target: SpeechTarget, done = true): Promise<{ ok: true } | { error: string }> {
      halt();
      if (!pieces.length) return { error: 'Nothing to read.' };
      run = r;
      const control = (abort = new AbortController());
      const st: Reading = (reading = { run: r, pieces: [...pieces], clips: pieces.map(() => deferred<Clip>()), done, played: 0 });
      void produce(st, target, control.signal);
      try {
        await st.clips[0]!.promise;
      } catch (e) {
        if (run === r) halt();
        return { error: errorText(e) };
      }
      if (run !== r) return { error: 'Stopped.' };
      void consume(st);
      return { ok: true };
    },
    // More pieces of the reading `r`, and whether its text is done; one done after its last clip played ends it.
    more(r: string, pieces: PlannedPiece[], done: boolean) {
      const st = reading;
      if (!st || st.run !== r || st.done) return;
      st.pieces.push(...pieces);
      st.clips.push(...pieces.map(() => deferred<Clip>()));
      st.done = done;
      if (done && st.played === st.pieces.length && !sounding.length) return finish(r);
      wakeAll();
    },
  };
}

// The AudioContext's clips: decoded, trimmed where asked, scheduled back to back.
export function webAudioOut(): AudioOut {
  let ctx: AudioContext | undefined;
  const context = () => {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    return ctx;
  };
  return {
    async decode(data, trim) {
      const c = context();
      const b = await c.decodeAudioData(data);
      if (!trim) return b;
      const channels = Array.from({ length: b.numberOfChannels }, (_, n) => b.getChannelData(n));
      const kept = keptFrames(channels, b.sampleRate);
      if (kept >= b.length || kept <= 0) return b;
      const cut = c.createBuffer(b.numberOfChannels, kept, b.sampleRate);
      channels.forEach((ch, n) => cut.copyToChannel(ch.subarray(0, kept), n));
      return cut;
    },
    play(clip, at) {
      const c = context();
      const source = c.createBufferSource();
      source.buffer = clip as AudioBuffer;
      source.connect(c.destination);
      const startsAt = Math.max(c.currentTime + 0.02, at);
      const ended = new Promise<void>((resolve) => (source.onended = () => resolve()));
      source.start(startsAt);
      return {
        startsAt,
        endsAt: startsAt + clip.duration,
        ended,
        stop: () => {
          try {
            source.stop();
          } catch {
            // not started, or ended already
          }
        },
      };
    },
  };
}
