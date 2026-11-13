// What both recording engines (recording/devtools, recording/webrequest) keep of a recording as its
// calls come: the count against MAX_CALLS, how many the preset left out, the dedupe of calls kept
// (recording/filter), a call dropped once its answer is not one the preset keeps, and the preset's
// maxMinutes timer. The engine tells what it sees; the ledger says what to keep and emits.
import { dedupeKey, keepAnswer, keepRequest } from './filter';
import type { CallType, RecordingPreset } from './presets';
import { MAX_CALLS, type RecordedCall, type Recording } from './recording';
import type { RecordedStep } from './step-types';

export type CaptureMode = NonNullable<Recording['mode']>;
export type CaptureMessage =
  | { call: RecordedCall }
  | { update: Partial<RecordedCall> & { id: string } }
  | { note: string }
  | { step: RecordedStep }
  | { leftOut: number } // how many calls the preset left out so far
  | { drop: string } // a call kept, left out once its answer came
  | { ended: string };

export interface Ledger {
  // The preset keeps this request: else it is counted as left out.
  keeps(call: { method: string; url: string; type: CallType | 'static'; requestBody?: string }): boolean;
  // A call kept, emitted; `sameAs`: its body as the dedupe saw it (recording/bodies sentBodyOf), so that
  // the call's dedupe key can be released if its answer drops it. False once MAX_CALLS is reached: the
  // recording stops.
  add(call: RecordedCall, sameAs?: string): boolean;
  // Its answer is one the preset keeps; else the call goes, counted as left out.
  answered(id: string, answer: { status?: number; error?: string; responseType?: string }): boolean;
  has(id: string): boolean; // a call kept, not dropped
  end(): void; // the timer stopped, with the recording
}

// `stop(why)`: the engine's, called at MAX_CALLS and after the preset's maxMinutes.
export function ledger(preset: RecordingPreset, site: string, emit: (m: CaptureMessage) => void, stop: (why: string) => void): Ledger {
  let count = 0;
  let leftOut = 0;
  const seen = new Set<string>(); // the calls kept, for the preset's dedupe
  const keys = new Map<string, string>(); // each kept call's dedupe key, taken out of `seen` if its answer drops it
  const kept = new Set<string>();
  const leftOutOne = () => emit({ leftOut: ++leftOut });
  const timer = setTimeout(() => stop(`it reached ${preset.maxMinutes} minutes`), preset.maxMinutes * 60_000);
  return {
    keeps: (call) => keepRequest(preset, call, site, seen) || (leftOutOne(), false),
    add: (call, sameAs) => {
      if (++count > MAX_CALLS) {
        stop(`it reached ${MAX_CALLS} calls`);
        return false;
      }
      keys.set(call.id, dedupeKey(call.method, call.url, sameAs));
      kept.add(call.id);
      emit({ call });
      return true;
    },
    answered: (id, answer) => {
      if (keepAnswer(preset, answer)) return true;
      seen.delete(keys.get(id) ?? ''); // not remembered: only counted
      kept.delete(id);
      count--;
      emit({ drop: id });
      leftOutOne();
      return false;
    },
    has: (id) => kept.has(id),
    end: () => clearTimeout(timer),
  };
}
