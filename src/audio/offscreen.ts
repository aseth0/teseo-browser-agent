// The offscreen document's side of a tab's audio (audio/protocol): the one capture, transcribed as it
// goes when the background gives it a model (voice/session, a chunk of the length chosen, through any
// silence, each one alone: with the text before it as its prompt, a model can give no text at all, so
// its prompt is the user's vocabulary only. A failed chunk, or one with sound the model gives no text
// for, stays out, kept to be sent again: the
// audio of the last FAILED_KEPT of them only, so that a provider down for hours does not leave every
// chunk's audio twice in memory), and once stopped its recording and transcript, kept until they are
// discarded or another starts. With waves on, it says the sound level as it goes. The extension's own
// pages only, never a content script.
import { isExtensionPage } from '../core/sender';
import { onRuntime, sendRuntime } from '../core/runtime';
import { errorText } from '../core/errors';
import { chunkRecorder, levelMeter } from '../voice/recorder';
import { startSession, type Session } from '../voice/session';
import { tabAudioOptions, transcribeTimed } from '../voice/transcribe';
import { AUDIO_CAPTURE, AUDIO_CHANGED, AUDIO_DROP, AUDIO_EDIT, AUDIO_END, AUDIO_ENDED, AUDIO_FILE, AUDIO_HELD, AUDIO_LEVEL, AUDIO_RETRY, AUDIO_TRANSCRIPT, type AudioTranscriber } from './protocol';
import { captureTabAudio, type TabAudio } from './tab-capture';
import { emptyTranscript, linesOf, progressOf, withPart, type Transcript } from './transcript';

const LEVEL_EVERY_MS = 200;
export const FAILED_KEPT = 20; // failed chunks whose audio is kept for Retry
const NOT_KEPT = `Its audio is not kept any more: only the last ${FAILED_KEPT} failed chunks are.`;

export function listenTabAudio() {
  let capture: TabAudio | undefined;
  let session: Session | undefined;
  let meter: ReturnType<typeof levelMeter> | undefined;
  let levels: ReturnType<typeof setInterval> | undefined;
  let timeUp: ReturnType<typeof setTimeout> | undefined;
  let run = 0; // the capture now: what an earlier one's chunks bring back is dropped
  let file: { url: string; name: string } | undefined;
  let name = '';
  let size = 0;
  let transcriber: AudioTranscriber | undefined;
  let transcript = emptyTranscript();
  const failed = new Map<number, Blob>(); // the audio of the chunks that failed, by number

  const changed = (next: Transcript) => {
    transcript = next;
    void sendRuntime({ type: AUDIO_CHANGED, progress: { ...progressOf(next), done: next.done } }).catch(() => undefined);
  };
  const send = async (mine: number, n: number, audio: Blob) => {
    const t = transcriber!;
    changed(withPart(transcript, { n, state: 'sending' }));
    const reply = await transcribeTimed(t.provider, audio, tabAudioOptions(t));
    if (mine !== run) return '';
    const lines = linesOf(n, t.chunkSeconds, reply);
    // The session sends only chunks with sound.
    if (!lines.length) throw new Error('the model gave no text, though there is sound');
    failed.delete(n);
    changed(withPart(transcript, { n, state: 'done', lines }));
    return reply.text;
  };
  const fail = (mine: number, n: number, audio: Blob, error: string) => {
    if (mine !== run) return;
    failed.delete(n); // set again: the newest
    failed.set(n, audio);
    for (const old of failed.keys()) {
      if (failed.size <= FAILED_KEPT) break;
      failed.delete(old);
    }
    changed(withPart(transcript, { n, state: 'failed', error }));
  };
  const transcribe = (mine: number, stream: MediaStream, sound: NonNullable<typeof meter>, chunkSeconds: number) => {
    session = startSession({
      chunkMs: chunkSeconds * 1000,
      record: () => chunkRecorder(stream),
      peak: sound.peak,
      send: (audio, _prompt, n) => send(mine, n, audio),
      insert: () => {},
      release: () => {}, // the stream is the capture's: stopCapture
      onEnd: () => mine === run && changed({ ...transcript, done: true }),
      silenceStopMs: Infinity,
      silenceLevel: transcriber?.silenceLevel,
      onFailed: (n, audio, error) => fail(mine, n, audio, error),
    });
  };

  const stopCapture = () => {
    clearTimeout(timeUp);
    clearInterval(levels);
    session?.stop();
    session = undefined;
    meter?.close();
    meter = undefined;
    const audio = capture;
    capture = undefined;
    return audio;
  };
  const drop = () => {
    run++;
    void stopCapture()?.stop();
    if (file) URL.revokeObjectURL(file.url);
    file = undefined;
    transcriber = undefined;
    transcript = emptyTranscript();
    failed.clear();
  };
  const end = async () => {
    // Stopped already (the tab closed, then Stop): the same answer again.
    const audio = stopCapture();
    if (!audio) return file ? { size } : { error: 'Nothing is being captured.' };
    const blob = await audio.stop();
    file = { url: URL.createObjectURL(blob), name };
    size = blob.size;
    return { size };
  };
  const retry = (n: number) => {
    if (!transcriber) return;
    const audio = failed.get(n);
    if (!audio) {
      if (transcript.parts.some((p) => p.n === n && p.state === 'failed')) changed(withPart(transcript, { n, state: 'failed', error: NOT_KEPT }));
      return;
    }
    const mine = run;
    send(mine, n, audio).catch((e: unknown) => fail(mine, n, audio, errorText(e)));
  };

  onRuntime(AUDIO_CAPTURE, (msg, sender) => {
    if (!isExtensionPage(sender)) return;
    if (capture) return { error: 'A tab is being captured already.' };
    drop();
    const mine = run;
    name = msg.name;
    return captureTabAudio(msg.streamId, () => void sendRuntime({ type: AUDIO_ENDED }).catch(() => undefined)).then(
      (audio) => {
        if (mine !== run) {
          void audio.stop(); // discarded while the stream was asked for: the tab is not left captured
          return { error: 'The capture was discarded.' };
        }
        capture = audio;
        transcriber = msg.transcribe;
        if (transcriber || msg.waves) meter = levelMeter(audio.stream);
        if (transcriber) {
          transcript = emptyTranscript(transcriber.chunkSeconds);
          transcribe(mine, audio.stream, meter!, transcriber.chunkSeconds);
        }
        if (msg.waves) levels = setInterval(() => void sendRuntime({ type: AUDIO_LEVEL, level: meter?.level() ?? 0 }).catch(() => undefined), LEVEL_EVERY_MS);
        // The time is up: as if the tab closed.
        timeUp = setTimeout(() => void sendRuntime({ type: AUDIO_ENDED }).catch(() => undefined), msg.maxMs);
        return { startedAt: audio.startedAt };
      },
      (e: unknown) => ({ error: `Could not capture the tab's audio (${errorText(e)}).` }),
    );
  });
  onRuntime(AUDIO_END, (_msg, sender) => (isExtensionPage(sender) ? end().catch((e: unknown) => ({ error: errorText(e) })) : undefined));
  onRuntime(AUDIO_DROP, (_msg, sender) => {
    if (isExtensionPage(sender)) drop();
  });
  onRuntime(AUDIO_HELD, (_msg, sender) => (isExtensionPage(sender) ? { held: capture ? 'capturing' : file ? 'stopped' : 'none' } : undefined));
  onRuntime(AUDIO_FILE, (_msg, sender) => (isExtensionPage(sender) ? (file ?? { error: 'The audio is not kept any more.' }) : undefined));
  onRuntime(AUDIO_TRANSCRIPT, (_msg, sender) => {
    if (!isExtensionPage(sender)) return;
    return transcriber ? { transcript } : { error: capture || file ? 'This audio is not transcribed.' : 'The audio is not kept any more.' };
  });
  onRuntime(AUDIO_EDIT, (msg, sender) => {
    if (isExtensionPage(sender) && transcriber) transcript = { ...transcript, edits: { ...transcript.edits, [msg.key]: msg.text } };
  });
  onRuntime(AUDIO_RETRY, (msg, sender) => {
    if (isExtensionPage(sender)) retry(msg.n);
  });
}
