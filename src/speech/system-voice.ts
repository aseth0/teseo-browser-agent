// The system's own voice (chrome.tts), for a reading without a voice profile (Settings → Speak → System
// voice): its pieces queued in the browser's speech engine, in the language whose reading rules apply,
// the same progress and end as a profile's reading in the offscreen document (speech/session). It needs
// no provider and sends nothing anywhere: the operating system's voices read it.
import { browser } from 'wxt/browser';
import { errorText } from '../core/errors';
import type { PlannedPiece } from './plan';

export const NO_SYSTEM_VOICE = 'This browser has no system voice to read with.';

export interface SystemVoiceEvents {
  progressed(m: { run: string; piece: number; total: number; playing: boolean }): void;
  ended(m: { run: string; error?: string }): void;
}

export interface SystemVoice {
  // Not `done`: its text is still written, and more pieces come (`more`).
  play(run: string, pieces: PlannedPiece[], o: { lang?: string }, done?: boolean): Promise<{ ok: true } | { error: string }>;
  more(run: string, pieces: PlannedPiece[], done: boolean): Promise<void>;
  stop(): Promise<void>;
  speaking(): Promise<boolean>;
}

// The API, where the browser has it (not Firefox's build: no permission there).
type Tts = typeof browser.tts;
const ttsOf = (): Tts | undefined => (browser as { tts?: Tts }).tts;

// `busy`: told when it starts and stops reading (the background keeps its worker awake meanwhile: a worker
// that slept would miss the end).
export function createSystemVoice(on: SystemVoiceEvents, tts: () => Tts | undefined = ttsOf, busy: (reading: boolean) => void = () => undefined): SystemVoice {
  // The run it reads, its pieces so far, whether its text is done, how many have been said, its language.
  let current: { run: string; total: number; done: boolean; said: number; lang?: string } | undefined;
  const done = () => {
    current = undefined;
    busy(false);
  };
  const event = (run: string, i: number, e: { type: string; errorMessage?: string }) => {
    const c = current;
    if (c?.run !== run) return;
    if (e.type === 'start') on.progressed({ run, piece: i + 1, total: c.total, playing: true });
    else if (e.type === 'end') {
      c.said = i + 1;
      if (c.done && i === c.total - 1) {
        done();
        on.ended({ run });
      } else if (c.said === c.total) on.progressed({ run, piece: c.said + 1, total: c.said + 1, playing: false }); // more to come
    } else if (e.type === 'error') {
      done();
      tts()?.stop();
      on.ended({ run, error: e.errorMessage || 'The system voice could not read it.' });
    }
    // 'interrupted' and 'cancelled': stopped, or replaced by another reading, which says so itself.
  };
  // Queued after what it says already, one call after another (more pieces may come while the first go).
  let chain: Promise<void> = Promise.resolve();
  const enqueue = (api: Tts, c: NonNullable<typeof current>, pieces: PlannedPiece[]) => {
    const from = c.total;
    c.total += pieces.length;
    const queued = chain.then(async () => {
      for (const [k, p] of pieces.entries()) {
        if (current !== c) return;
        await api.speak(p.input, { enqueue: true, ...(c.lang && { lang: c.lang }), onEvent: (e) => event(c.run, from + k, e) });
      }
    });
    chain = queued.catch(() => undefined);
    return queued;
  };
  return {
    async play(run, pieces, o, isDone = true) {
      const api = tts();
      if (!api) return { error: NO_SYSTEM_VOICE };
      api.stop();
      const c = (current = { run, total: 0, done: isDone, said: 0, ...(o.lang && { lang: o.lang }) });
      busy(true);
      try {
        await enqueue(api, c, pieces);
      } catch (e) {
        done();
        api.stop();
        return { error: errorText(e) };
      }
      return { ok: true };
    },
    async more(run, pieces, isDone) {
      const api = tts();
      const c = current;
      if (!api || c?.run !== run || c.done) return;
      c.done = isDone;
      if (isDone && !pieces.length && c.said === c.total) {
        done();
        return on.ended({ run });
      }
      await enqueue(api, c, pieces).catch((e: unknown) => {
        done();
        api.stop();
        on.ended({ run, error: errorText(e) });
      });
    },
    async stop() {
      done();
      tts()?.stop();
    },
    async speaking() {
      const api = tts();
      return !!api && (await api.isSpeaking());
    },
  };
}
