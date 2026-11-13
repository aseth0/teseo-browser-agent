// The review of a tab's audio (background/audio-host opens it once stopped; the popup's Review, the
// shortcut): the recording to play and its transcript in step with it, a line per stretch of speech,
// the one playing marked. Each line can be edited (what goes to the chat; emptied, it is left out) and
// a click on its time plays from there. A chunk that failed says why, with Retry. Send to chat puts it
// in the message box of the captured tab's chat (this window's once that tab closed), not sent; Copy
// text, Save (the .webm file) and Discard, confirmed here.
import { useEffect, useMemo, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { AUDIO_CHANGED, AUDIO_DISCARD, AUDIO_EDIT, AUDIO_FILE, AUDIO_RETRY, AUDIO_STOP, AUDIO_TO_CHAT, AUDIO_TRANSCRIPT, audioName } from '../../audio/protocol';
import { attachLines, clock, lineKey, partStart, transcriptText, type Transcript } from '../../audio/transcript';
import { onRuntime, sendRuntime } from '../../core/runtime';
import { plural, secondsSince } from '../../core/util';
import { panelFollowsOn } from '../../storage/settings-select';
import { useAppearance } from '../../ui/appearance';
import { Icon } from '../../ui/chat-icons';
import { useAudioStatus } from '../../ui/useAudioStatus';
import { useSettings } from '../../ui/useSettings';

const report = (e: unknown) => console.error('[audio]', e);

export function AudioReview() {
  const [settings] = useSettings();
  useAppearance(settings?.appearance);
  const status = useAudioStatus();
  const [transcript, setTranscript] = useState<Transcript>();
  const [file, setFile] = useState<{ url: string; name: string }>();
  const [note, setNote] = useState('');
  const [edits, setEdits] = useState<Record<string, string>>({}); // typed here, ahead of the kept ones
  const [now, setNow] = useState(-1); // where the player is, in seconds (none yet: -1)
  const [confirming, setConfirming] = useState(false);
  const [chatTab, setChatTab] = useState<{ id: number; windowId: number }>();
  const player = useRef<HTMLAudioElement>(null);
  const capture = status?.startedAt; // which audio: another one starts the page over
  const stopped = status?.state === 'stopped';
  const transcribed = !!status?.progress;

  // The transcript, read again whenever it changes.
  useEffect(() => {
    setEdits({});
    setTranscript(undefined);
    if (!transcribed) return;
    const load = () => void sendRuntime({ type: AUDIO_TRANSCRIPT }).then((r) => (r && 'transcript' in r ? setTranscript(r.transcript) : setNote(r?.error ?? '')), report);
    load();
    return onRuntime(AUDIO_CHANGED, () => load());
  }, [transcribed, capture]);
  useEffect(() => {
    setFile(undefined);
    if (stopped) void sendRuntime({ type: AUDIO_FILE }).then((r) => (r && 'url' in r ? setFile(r) : setNote(r?.error ?? '')), report);
  }, [stopped, capture]);
  // Where Send to chat goes: the captured tab's chat, or, once that tab closed, this window's.
  const capturedTab = status?.tabId;
  useEffect(() => {
    if (capturedTab === undefined) return;
    const own = () => browser.tabs.getCurrent().then((t) => t?.id !== undefined && setChatTab({ id: t.id, windowId: t.windowId }));
    browser.tabs.get(capturedTab).then((t) => setChatTab({ id: capturedTab, windowId: t.windowId }), own).catch(report);
  }, [capturedTab]);

  const shown = useMemo(() => transcript && { ...transcript, edits: { ...transcript.edits, ...edits } }, [transcript, edits]);
  const seconds = status ? secondsSince(status) : 0;
  // The line playing: the last one started.
  const playing = useMemo(() => {
    let key: string | undefined;
    for (const p of shown?.parts ?? []) if (p.state === 'done') p.lines.forEach((l, i) => l.at <= now && (key = lineKey(p.n, i)));
    return key;
  }, [shown, now]);
  const rows = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    if (playing && !player.current?.paused) rows.current.get(playing)?.scrollIntoView({ block: 'nearest' });
  }, [playing]);

  if (!status) {
    return (
      <main className="audio-review">
        <h1>Audio review</h1>
        <p className="muted">No audio is kept: capture a tab's audio with the toolbar button's Audio line.</p>
      </main>
    );
  }

  const progress = status.progress;
  const out = progress ? progress.sending || (progress.done ? 0 : 1) : 0; // still coming
  const edit = (key: string, text: string) => {
    setEdits((e) => ({ ...e, [key]: text }));
    void sendRuntime({ type: AUDIO_EDIT, key, text }).catch(report);
  };
  const retry = (n: number) => {
    setEdits((e) => Object.fromEntries(Object.entries(e).filter(([key]) => !key.startsWith(`${n}:`))));
    void sendRuntime({ type: AUDIO_RETRY, n }).catch(report);
  };
  const seek = (at: number) => {
    const audio = player.current;
    if (!audio) return;
    audio.currentTime = at;
    void audio.play().catch(report);
  };
  // In the pin's mode without a panel for the window, the chat shows only on its own tab: it comes forward.
  const toChat = () => {
    if (!chatTab) return;
    sendRuntime({ type: AUDIO_TO_CHAT, tabId: chatTab.id, windowId: chatTab.windowId }).then((r) => {
      if (r && 'error' in r) return setNote(r.error);
      setNote('In the chat’s message box: write your message and send it.');
      if (settings && !panelFollowsOn(settings)) void browser.tabs.update(chatTab.id, { active: true });
    }, report);
  };
  const copy = () => shown && void navigator.clipboard.writeText(transcriptText(attachLines(shown, seconds))).then(() => setNote('Copied.'), report);
  const discard = () => void sendRuntime({ type: AUDIO_DISCARD }).then(() => window.close(), report);
  // The recording's length, which MediaRecorder's files do not give: read once to its end.
  const onLoaded = (a: HTMLAudioElement) => {
    if (a.duration !== Infinity) return;
    a.currentTime = 1e101;
    a.addEventListener('timeupdate', () => void (a.currentTime = 0), { once: true });
  };

  return (
    <main className="audio-review">
      <header className="audio-review-head">
        <h1>{audioName(status.site, seconds)}</h1>
        <span className="muted small">
          {status.state === 'capturing' ? 'Capturing…'
            : !progress ? 'Captured as audio only: not transcribed.'
            : out ? `Transcribing ${plural(out, 'chunk')}…`
            : progress.failed ? `${plural(progress.failed, 'chunk')} not transcribed: Retry below.`
            : status.sent ? 'Transcribed, and put in the chat.' : 'Transcribed.'}
        </span>
      </header>
      {status.state === 'capturing' ? (
        <div className="audio-review-actions">
          <button onClick={() => void sendRuntime({ type: AUDIO_STOP }).catch(report)}><Icon name="stop" size={14} /> Stop</button>
        </div>
      ) : (
        file && <audio ref={player} className="audio-review-player" controls src={file.url} onLoadedMetadata={(e) => onLoaded(e.currentTarget)} onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)} />
      )}
      {shown && (
        <ol className="audio-lines" aria-label="Transcript">
          {shown.parts.map((p) => {
            if (p.state === 'sending') return <li key={p.n} className="audio-line muted"><span className="audio-time">{clock(partStart(shown, p.n))}</span> Transcribing…</li>;
            if (p.state === 'failed') {
              return (
                <li key={p.n} className="audio-line audio-gap">
                  <span className="audio-time">{clock(partStart(shown, p.n))}–{clock(Math.min(partStart(shown, p.n + 1), seconds))}</span>
                  <span className="small">Not transcribed ({p.error}).</span>
                  <button onClick={() => retry(p.n)}>Retry</button>
                </li>
              );
            }
            return p.lines.map((l, i) => {
              const key = lineKey(p.n, i);
              return (
                <li key={key} ref={(el) => void (el ? rows.current.set(key, el) : rows.current.delete(key))} className={`audio-line${key === playing ? ' playing' : ''}`}>
                  <button className="audio-time" title="Play from here" disabled={!file} onClick={() => seek(l.at)}>{clock(l.at)}</button>
                  <textarea aria-label={`Line at ${clock(l.at)}`} value={shown.edits[key] ?? l.text} onChange={(e) => edit(key, e.target.value)} />
                </li>
              );
            });
          })}
          {!shown.parts.length && <li className="muted">{out ? 'Nothing transcribed yet.' : 'Nothing was said.'}</li>}
        </ol>
      )}
      {note && <p className="small" role="status">{note}</p>}
      {stopped && (
        <div className="audio-review-actions">
          {confirming ? (
            <>
              <span className="small">Discard the audio{progress ? ' and its transcript' : ''}?</span>
              <button className="danger" onClick={discard}>Discard</button>
              <button onClick={() => setConfirming(false)}>Keep it</button>
            </>
          ) : (
            <>
              {progress && (
                <button className="primary" disabled={!chatTab || !!out} title={out ? 'Once every chunk is transcribed' : 'Into the message box of the chat, not sent'} onClick={toChat}>
                  Send to chat
                </button>
              )}
              {progress && <button disabled={!shown} onClick={copy}>Copy text</button>}
              {file && <a className="button-like" href={file.url} download={file.name} title={`Save it as a .webm file, in the browser's downloads`}><Icon name="save" size={14} /> Save</a>}
              <button onClick={() => setConfirming(true)}>Discard</button>
            </>
          )}
        </div>
      )}
    </main>
  );
}
