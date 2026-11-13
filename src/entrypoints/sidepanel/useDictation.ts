// Dictation into the message box (🎤): the microphone, a level meter and a recorder per chunk around
// voice/session, each chunk's text inserted at the box's caret. Nothing is sent to the chat model.
// Stopped by the button, by sending (Chat waits for it), by another conversation, by the agent
// manager hiding this chat, and with the page: the microphone is released on every end.
import { useEffect, useRef, useState, type RefObject } from 'react';
import { unreachable } from '../../providers/provider-access';
import { errorText } from '../../core/errors';
import { MANAGER_HIDDEN } from '../../manager/protocol';
import { MANAGER } from '../../ui/floating-frame';
import { useSettingsContext } from '../../ui/settings-context';
import { useStableCallback } from '../../ui/useStableCallback';
import { insertText } from '../../voice/insert';
import { micProblem, openMic, type MicProblem } from '../../voice/mic';
import { chunkRecorder, levelMeter } from '../../voice/recorder';
import { startSession, type Session, type SessionEnd } from '../../voice/session';
import { silenceText, voiceTarget } from '../../voice/settings';
import { dictationOptions, transcribe } from '../../voice/transcribe';
import type { ComposerHandle } from './MentionComposer';

export type DictationState = 'idle' | 'starting' | 'recording' | 'finishing';
export type { MicProblem };

export interface Dictation {
  state: DictationState;
  note?: string;
  problem?: MicProblem;
  toggle(): void;
  stop(): void;
}

const NO_MODEL_NOTE = 'Choose an audio model in Settings → Voice.';
function endNote(end: SessionEnd, silenceMs: number): string | undefined {
  if (end.reason === 'error') return `Dictation stopped: ${end.error}`;
  if (end.reason === 'silence') return `Dictation stopped after ${silenceText(silenceMs)} of silence.`;
  return undefined;
}

// The microphone released.
const release = (stream: MediaStream) => stream.getTracks().forEach((t) => t.stop());

export function useDictation({ composer, setInput, conversationId }: { composer: RefObject<ComposerHandle | null>; setInput: (update: (now: string) => string) => void; conversationId: string }): Dictation {
  const { settings } = useSettingsContext();
  const [state, setState] = useState<DictationState>('idle');
  const [note, setNote] = useState<string>();
  const [problem, setProblem] = useState<MicProblem>();
  const session = useRef<Session>(undefined);
  const run = useRef(0); // the current dictation: a start that a stop overtook is dropped
  const mounted = useRef(true);
  const abort = useRef<AbortController>(undefined);

  // The text at the caret: where the last chunk ended, unless the box changed since (typed in), then
  // where its caret is now. Never over what is there.
  const placed = useRef({ value: '', at: 0 });
  const insert = (text: string) => {
    const shown = composer.current?.selection();
    setInput((now) => {
      const at = now === placed.current.value ? placed.current.at : (shown?.value === now ? shown.at : now.length);
      const next = insertText(now, at, text);
      placed.current = { value: next.value, at: next.caret };
      return next.value;
    });
    composer.current?.caretAfterRender(() => placed.current.at);
  };

  const start = async () => {
    const mine = ++run.current;
    setNote(undefined);
    setProblem(undefined);
    const target = voiceTarget(settings);
    const { provider, model } = target;
    if (!provider || !model) return setNote(NO_MODEL_NOTE);
    setState('starting');
    const fail = (why: { note?: string; problem?: MicProblem }) => {
      if (run.current !== mine) return;
      setState('idle');
      setNote(why.note);
      setProblem(why.problem);
    };
    const noAccess = await unreachable(provider);
    if (noAccess) return fail({ note: noAccess });
    let stream: MediaStream;
    try {
      stream = await openMic((c) => navigator.mediaDevices.getUserMedia(c), target.deviceId);
    } catch (e) {
      const problem = micProblem(e);
      return fail(problem ? { problem } : { note: `Dictation stopped: ${errorText(e)}` });
    }
    // Stopped, or another conversation opened, while the browser gave it: off at once.
    if (run.current !== mine || !mounted.current) return release(stream);
    const shown = composer.current?.selection();
    placed.current = shown ?? { value: '', at: 0 };
    const meter = levelMeter(stream);
    const requests = new AbortController();
    abort.current = requests;
    session.current = startSession({
      chunkMs: target.chunkSeconds * 1000,
      record: () => chunkRecorder(stream),
      peak: meter.peak,
      send: (audio, tail) => transcribe(provider, audio, dictationOptions({ ...target, model }, tail), requests.signal),
      silenceLevel: target.silenceLevel,
      silenceStopMs: target.silenceStopMs,
      insert: (text) => mounted.current && insert(text),
      release: () => {
        meter.close();
        release(stream);
      },
      onEnd: (end) => {
        if (!mounted.current) return;
        session.current = undefined;
        setState('idle');
        setNote(endNote(end, target.silenceStopMs));
      },
    });
    setState('recording');
  };

  const stop = useStableCallback(() => {
    run.current++;
    if (session.current) {
      setState('finishing');
      session.current.stop();
    } else setState('idle');
  });
  const toggle = () => (state === 'idle' ? void start() : state !== 'finishing' ? stop() : undefined);

  // Another conversation: this dictation stops (its last chunks still land in the box).
  useEffect(() => stop, [conversationId, stop]);
  // The page closed: the microphone off, the requests dropped.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      session.current?.stop();
      abort.current?.abort();
    };
  }, []);
  // In the agent manager, hidden by another row.
  useEffect(() => {
    if (!MANAGER) return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin === location.origin && e.source === window.parent && (e.data as { type?: unknown })?.type === MANAGER_HIDDEN) stop();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [stop]);

  return { state, note, problem, toggle, stop };
}
