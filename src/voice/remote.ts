// The floating chat's side of its dictation (voice/protocol): the offscreen document opened by the
// background, then a port to it that records there. Settles once the microphone is on (`stop` and
// `drop`, as a voice/session's stop and its requests' abort), or rejects with the microphone's error
// (its name kept, for voice/mic micProblem) or why the offscreen document could not. Texts and the end
// come to `insert` and `onEnd` as a local session's do, the sound level and the chunks out to `level`
// and `pending`; the port closed under it (the offscreen document gone) ends it with an error.
import { browser, type Browser } from 'wxt/browser';
import { sendRuntime } from '../core/runtime';
import { DICTATION_OFFSCREEN, DICTATION_PORT, type DictationStart, type DictationToChat, type DictationToOffscreen } from './protocol';
import type { SessionEnd } from './session';

export const OFFSCREEN_GONE = 'the offscreen document that records it closed.';

export interface RemoteDictation {
  stop(): void; // as a session's: its last chunks still come
  drop(): void; // off at once: nothing more comes, not even onEnd
}

interface Deps {
  ready: () => Promise<Record<string, never> | { error: string } | undefined>;
  connect: () => Browser.runtime.Port;
}
const live: Deps = {
  ready: () => sendRuntime({ type: DICTATION_OFFSCREEN }),
  connect: () => browser.runtime.connect({ name: DICTATION_PORT }),
};

export async function offscreenDictation(o: Omit<DictationStart, 'type'>, on: { insert: (text: string) => void; onEnd: (end: SessionEnd) => void; level?: (level: number) => void; pending?: (count: number) => void; stopping?: () => void }, deps: Deps = live): Promise<RemoteDictation> {
  const ready = await deps.ready();
  if (!ready || 'error' in ready) throw new Error(ready?.error ?? OFFSCREEN_GONE);
  const port = deps.connect();
  const send = (m: DictationToOffscreen) => port.postMessage(m);
  let started = false;
  let ended = false;
  const close = () => {
    ended = true;
    port.disconnect();
  };
  const handle: RemoteDictation = {
    stop: () => void (!ended && send({ type: 'stop' })),
    drop: () => void (!ended && close()),
  };
  return new Promise<RemoteDictation>((resolve, reject) => {
    port.onMessage.addListener((m: DictationToChat) => {
      if (ended) return;
      if (m.type === 'failed') {
        close();
        reject(Object.assign(new Error(m.error), { name: m.name ?? 'Error' }));
      } else if (m.type === 'started') {
        started = true;
        resolve(handle);
      } else if (m.type === 'text') on.insert(m.text);
      else if (m.type === 'level') on.level?.(m.level);
      else if (m.type === 'pending') on.pending?.(m.count);
      else if (m.type === 'stopping') on.stopping?.();
      else if (m.type === 'end') {
        close();
        on.onEnd(m.end);
      }
    });
    port.onDisconnect.addListener(() => {
      if (ended) return;
      ended = true;
      if (started) on.onEnd({ reason: 'error', error: OFFSCREEN_GONE });
      else reject(new Error(OFFSCREEN_GONE));
    });
    send({ type: 'start', ...o });
  });
}
