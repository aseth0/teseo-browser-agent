// What the popup's Audio and Record lines share: the clock shown while one runs, and how a start ends:
// the popup closes, or its note says why not (and where to set what is missing).
import { useEffect, useState } from 'react';

export const report = (e: unknown) => console.error('[popup]', e);

export type Failed = { error: string; settings?: 'voice' };
export interface LineEnds {
  onDone: (p: Promise<unknown>) => void; // closes the popup once it settles
  onError: (message: string, settings?: 'voice') => void;
}

// Rendered again every second while `on`: the time elapsed follows.
export function useTicking(on: boolean) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [on]);
}

// A start asked of the background: started, the popup closes; refused, the note says why.
export function started(start: Promise<Failed | undefined>, { onDone, onError }: LineEnds) {
  start.then(
    (r) => (r ? onError(r.error, ...(r.settings ? [r.settings] : [])) : onDone(Promise.resolve())),
    report,
  );
}
