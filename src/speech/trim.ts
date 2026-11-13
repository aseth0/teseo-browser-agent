// The model ends every clip with about a third of a second of silence, a full stop's pause. A piece that
// stops inside a sentence loses it, so that the next follows as after a comma: the frames kept are those
// up to the last one louder than the threshold (about -40 dB), and a short tail after it.
export const SILENCE = { threshold: 0.01, tailSeconds: 0.04 };

export function keptFrames(channels: readonly Float32Array[], sampleRate: number, o = SILENCE): number {
  const length = channels[0]?.length ?? 0;
  let last = -1;
  for (let i = length - 1; i >= 0 && last < 0; i--) {
    for (const ch of channels) {
      if (Math.abs(ch[i] ?? 0) > o.threshold) {
        last = i;
        break;
      }
    }
  }
  // All silence: kept as it came (a clip with nothing in it is the server's to answer for).
  if (last < 0) return length;
  return Math.min(length, last + 1 + Math.round(o.tailSeconds * sampleRate));
}
