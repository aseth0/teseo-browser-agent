// The strip inside the message box while it dictates (ComposerArea; the box framed in red): a pulsing dot,
// the time since it started, the sound's waves, the words just put in the box for a moment (or "…" while a
// chunk is out being transcribed), and Stop. Stopped, "Finishing dictation…" in amber until the last
// chunk is in. The level is polled here, so that the chat does not render five times a second.
import { useEffect, useState } from 'react';
import { clock } from '../../audio/transcript';
import type { Dictation } from './useDictation';

export const HEARD_MS = 2500; // the words just in, shown this long
const EVERY_MS = 200;
const BARS = 16;
// Speech is far under 1: the root spreads it over the height (as the tab-audio pill draws it).
const heightOf = (level: number) => Math.min(100, Math.sqrt(Math.max(0, level)) * 160);

// Shown while it records or finishes; each dictation's strip its own (its time and waves start anew).
export function DictationStrip({ dictation }: { dictation: Dictation }) {
  const live = dictation.state === 'recording' || dictation.state === 'finishing';
  return live ? <LiveStrip key={dictation.startedAt} dictation={dictation} /> : null;
}

function LiveStrip({ dictation }: { dictation: Dictation }) {
  const { state, startedAt, heard, pending, level, stop } = dictation;
  const [now, setNow] = useState(() => Date.now());
  const [levels, setLevels] = useState<number[]>(() => Array<number>(BARS).fill(0));
  useEffect(() => {
    const tick = setInterval(() => {
      setNow(Date.now());
      if (state === 'recording') setLevels((l) => [...l.slice(1), heightOf(level())]);
    }, EVERY_MS);
    return () => clearInterval(tick);
  }, [state, level]);

  const finishing = state === 'finishing';
  const words = heard && now - heard.at < HEARD_MS ? heard.text : pending ? '…' : '';
  return (
    <div className={`dictation-strip ${state}`} role="group" aria-label="Dictation">
      <span className="dictation-dot" aria-hidden="true" />
      {finishing ? <span className="dictation-heard">Finishing dictation…</span> : (
        <>
          <span className="dictation-time">{clock(((startedAt ? now - startedAt : 0)) / 1000)}</span>
          <span className="dictation-waves" aria-hidden="true">{levels.map((h, i) => <b key={i} style={{ height: `${h}%` }} />)}</span>
          <span className={words === '…' ? 'dictation-heard waiting' : 'dictation-heard'}><bdi>{words}</bdi></span>
        </>
      )}
      <button type="button" onClick={stop} disabled={finishing} aria-label="Stop dictation" title="Stop dictation">Stop</button>
    </div>
  );
}
