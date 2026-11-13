// One dictation, from start to its end: a new recorder every chunk (each chunk a whole file the
// server can decode alone), each chunk sent as soon as it is complete and its text inserted in
// recording order. A silent chunk is not sent (Whisper-style models invent text for silence); a
// minute without sound stops it, as does a failed chunk, unless the caller says otherwise (a tab's
// audio: audio/tab-capture). The recorder, the sound level and the clock come from outside
// (sidepanel/useDictation; fakes in the tests).
import { errorText } from '../core/errors';
import { ChunkOrder } from './order';
import { SILENCE_LEVEL } from './settings';
import { promptTail } from './transcribe';

export { SILENCE_LEVEL };
const SILENCE_STOP_MS = 60_000;

// A recorder of one chunk: `onchunk` gets its audio once it is stopped.
export interface ChunkRecorder {
  start(): void;
  stop(): void;
  onchunk: (audio: Blob) => void;
}

export type SessionEnd = { reason: 'stopped' | 'silence' } | { reason: 'error'; error: string };

export interface SessionDeps {
  chunkMs: number;
  record: () => ChunkRecorder; // a new recorder on the stream
  peak: () => number; // the loudest level since it was last asked
  send: (audio: Blob, prompt: string, n: number) => Promise<string>; // the chunk's text; `n`: its number, from 0
  insert: (text: string) => void;
  release: () => void; // the microphone off: the stream's tracks stopped
  onEnd: (end: SessionEnd) => void; // once stopped and every chunk's text is in
  now?: () => number;
  silenceStopMs?: number; // how long without sound stops it (none: a minute; Infinity: never)
  // The level a chunk must reach to be sent (none: SILENCE_LEVEL; 0: every chunk, while silence for
  // silenceStopMs is still measured against SILENCE_LEVEL).
  silenceLevel?: number;
  // Given: a failed chunk is handed here, its text left out, and the session goes on.
  onFailed?: (n: number, audio: Blob, error: string) => void;
}

export interface Session {
  stop(): void;
  readonly stopping: boolean;
}

export function startSession(d: SessionDeps): Session {
  const now = d.now ?? Date.now;
  const order = new ChunkOrder();
  let said = ''; // the text inserted so far, for the next chunks' prompt
  let lastSound = now();
  let open = 0; // recorders whose chunk has not come yet
  let stopping = false;
  let failed = false; // after a failed chunk, the one recording is not sent
  let end: SessionEnd = { reason: 'stopped' };
  let ended = false;

  const finishIfDone = () => {
    if (!stopping || ended || open || order.pending) return;
    ended = true;
    d.onEnd(end);
  };
  const settle = (n: number, text: string) => {
    // The ready ones in one insertion: the box takes it before it has shown the one before.
    const ready = order.settle(n, text).join(' ');
    if (ready) {
      d.insert(ready);
      said = said ? `${said} ${ready}` : ready;
    }
    finishIfDone();
  };
  const chunkDone = (audio: Blob) => {
    open--;
    const level = d.peak();
    if (failed) return finishIfDone();
    const n = order.add();
    const sendLevel = d.silenceLevel ?? SILENCE_LEVEL;
    if (level >= (sendLevel || SILENCE_LEVEL) && audio.size) lastSound = now();
    else if (now() - lastSound >= (d.silenceStopMs ?? SILENCE_STOP_MS)) stop({ reason: 'silence' });
    if (level < sendLevel || !audio.size) return settle(n, '');
    d.send(audio, promptTail(said), n).then(
      (text) => settle(n, text),
      (e: unknown) => {
        if (d.onFailed) {
          d.onFailed(n, audio, errorText(e));
          return settle(n, '');
        }
        failed = true;
        stop({ reason: 'error', error: errorText(e) });
        settle(n, '');
      },
    );
  };
  const begin = () => {
    const r = d.record();
    r.onchunk = chunkDone;
    open++;
    r.start();
    return r;
  };

  let current = begin();
  // The next recorder starts before this one stops: a few ms of overlap instead of a gap.
  const timer = setInterval(() => {
    const done = current;
    current = begin();
    done.stop();
  }, d.chunkMs);

  function stop(why: SessionEnd) {
    if (stopping) return;
    stopping = true;
    end = why;
    clearInterval(timer);
    current.stop();
    d.release();
    finishIfDone();
  }

  return {
    stop: () => stop({ reason: 'stopped' }),
    get stopping() {
      return stopping;
    },
  };
}
