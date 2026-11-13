// The recorder of each chunk and the sound level a session (voice/session) works with, on a stream: the
// microphone's for dictation (sidepanel/useDictation), a tab's for its audio (audio/tab-capture).
import type { ChunkRecorder } from './session';

const MIME = 'audio/webm;codecs=opus';
const LEVEL_EVERY_MS = 100;
const LEVEL_WINDOW = 8192; // samples

// A recorder of one chunk on the stream, its audio whole once stopped.
export function chunkRecorder(stream: MediaStream): ChunkRecorder {
  const rec = new MediaRecorder(stream, MediaRecorder.isTypeSupported(MIME) ? { mimeType: MIME } : undefined);
  const parts: Blob[] = [];
  const r: ChunkRecorder = {
    start: () => rec.start(),
    stop: () => rec.state !== 'inactive' && rec.stop(),
    onchunk: () => {},
  };
  rec.ondataavailable = (e) => void (e.data.size && parts.push(e.data));
  rec.onstop = () => r.onchunk(new Blob(parts, { type: rec.mimeType }));
  rec.onerror = () => r.onchunk(new Blob());
  return r;
}

// The loudest level (RMS) of the stream since it was last asked. Where the audio context does not
// run (no user gesture left), every chunk counts as sound: nothing is skipped rather than everything.
// `level`: the level now, for a meter to draw (0 where the context does not run).
// `measured`: whether the levels are heard (the context runs), not the 1 that stands for unknown.
export function levelMeter(stream: MediaStream): { peak: () => number; level: () => number; measured: () => boolean; close: () => void } {
  const ctx = new AudioContext();
  void ctx.resume().catch(() => undefined);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = LEVEL_WINDOW; // longer than LEVEL_EVERY_MS at 48 kHz: no sound falls between two looks
  ctx.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  const level = () => {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const v of samples) sum += v * v;
    return Math.sqrt(sum / samples.length);
  };
  let loudest = 0;
  const timer = setInterval(() => (loudest = Math.max(loudest, level())), LEVEL_EVERY_MS);
  return {
    peak: () => {
      if (ctx.state !== 'running') return 1;
      const p = Math.max(loudest, level());
      loudest = 0;
      return p;
    },
    level: () => (ctx.state === 'running' ? level() : 0),
    measured: () => ctx.state === 'running',
    close: () => {
      clearInterval(timer);
      void ctx.close().catch(() => undefined);
    },
  };
}
