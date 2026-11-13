// Settings → Voice → Dictation's Test: records a few seconds from the chosen microphone and sends them
// with dictation's settings or a tab's audio's (voice/try-out), then shows the text, or what the server
// said when it refused, and the loudest level heard, to set Silence level by. Leaving the tab or the page
// stops it: the microphone released, nothing sent, the request dropped.
import { useEffect, useRef, useState } from 'react';
import { unreachable } from '../providers/provider-access';
import type { Settings } from '../storage/settings';
import { tabAudioAvailable } from '../core/build';
import { openMic } from '../voice/mic';
import { chunkRecorder, levelMeter } from '../voice/recorder';
import { tabAudioTarget, voiceTarget } from '../voice/settings';
import { transcribe } from '../voice/transcribe';
import { TRY_SECONDS, tryOptions, tryTranscription, type TryAs, type TryResult } from '../voice/try-out';

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true });
  });

export function VoiceTest({ settings }: { settings: Settings }) {
  const target = voiceTarget(settings);
  const [as, setAs] = useState<TryAs>('dictation');
  const [state, setState] = useState<'idle' | 'recording' | 'sending'>('idle');
  const [result, setResult] = useState<Exclude<TryResult, { aborted: true }>>();
  const busy = useRef(false); // set before the first await: a second click starts nothing
  const abort = useRef<AbortController>(undefined);
  useEffect(() => () => abort.current?.abort(), []);
  const { provider, model } = target;
  const run = async () => {
    if (!provider || !model || busy.current) return;
    busy.current = true;
    const mine = new AbortController();
    abort.current = mine;
    setResult(undefined);
    setState('recording');
    try {
      const noAccess = await unreachable(provider);
      if (mine.signal.aborted) return;
      if (noAccess) return setResult({ error: noAccess });
      const r = await tryTranscription(tryOptions(as, { ...target, model }, tabAudioTarget(settings)), {
        open: () => openMic((c) => navigator.mediaDevices.getUserMedia(c), target.deviceId),
        record: chunkRecorder,
        meter: levelMeter,
        wait,
        send: (audio, o, signal) => {
          if (!signal.aborted) setState('sending');
          return transcribe(provider, audio, o, signal);
        },
      }, mine.signal);
      if (!('aborted' in r)) setResult(r);
    } catch (e) {
      if (!mine.signal.aborted) setResult({ error: String(e) });
    } finally {
      busy.current = false;
      if (!mine.signal.aborted) setState('idle');
    }
  };
  const peak = result?.peak;
  const tab = tabAudioAvailable();
  return (
    <li className="stack">
      <div><strong>Test</strong><span className="hint">Records {TRY_SECONDS} seconds from the microphone and transcribes them with the settings of dictation{tab && <>, or of a tab&apos;s audio (its language)</>}</span></div>
      <div className="row">
        {/* Where the browser cannot capture a tab's audio (core/build), only dictation's. */}
        {tab && <select aria-label="Test with the settings of" value={as} onChange={(e) => setAs(e.target.value as TryAs)}>
          <option value="dictation">Dictation</option>
          <option value="tab">A tab&apos;s audio</option>
        </select>}
        <button className="primary" disabled={!provider || !model || state !== 'idle'} onClick={() => void run()}>
          {state === 'recording' ? 'Recording…' : state === 'sending' ? 'Transcribing…' : 'Test'}
        </button>
        {result && <span className="hint">Loudest level: {peak === undefined ? 'not measured' : peak.toFixed(3)} (silence level {target.silenceLevel})</span>}
      </div>
      {!provider || !model ? <p className="hint">Choose an audio model first.</p> : null}
      {result && 'text' in result && <p className="msg" role="status">{result.text || '(no text)'}</p>}
      {result && 'error' in result && <p className="msg error" role="alert">{result.error}</p>}
    </li>
  );
}
