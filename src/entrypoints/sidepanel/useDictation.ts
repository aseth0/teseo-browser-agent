// Dictation into the message box (🎤): the microphone, a level meter and a recorder per chunk around
// voice/session, each chunk's text inserted at the box's caret. Nothing is sent to the chat model.
// Floating on a page, the same dictation records in the offscreen document (voice/remote), with the
// extension's own microphone: the page decides who may use it in its frames.
// Stopped by the button, by sending (Chat waits for it), by another conversation, by the agent
// manager hiding this chat, by the floating chat folded, and with the page: the microphone is
// released on every end (floating, also when its frame goes: the offscreen document drops it).
import { useEffect, useRef, useState, type RefObject } from 'react';
import { unreachable } from '../../providers/provider-access';
import { errorText } from '../../core/errors';
import { MANAGER_HIDDEN } from '../../manager/protocol';
import { FLOATING, MANAGER, knownFloatingTab } from '../../ui/floating-frame';
import { onRuntime } from '../../core/runtime';
import { senderOf } from '../../core/sender';
import { WIDGET_FOLDED } from '../../widget/protocol';
import { offscreenDictation, type RemoteDictation } from '../../voice/remote';
import { useSettingsContext } from '../../ui/settings-context';
import { useStableCallback } from '../../ui/useStableCallback';
import { insertText } from '../../voice/insert';
import { micProblem, openMic, type MicProblem } from '../../voice/mic';
import { chunkRecorder, levelMeter } from '../../voice/recorder';
import { startSession, type Session, type SessionEnd } from '../../voice/session';
import { silenceText, voiceTarget, type VoiceTarget } from '../../voice/settings';
import type { ProviderConfig } from '../../storage/settings';
import { dictationOptions, transcribe } from '../../voice/transcribe';
import type { ComposerHandle } from './MentionComposer';

export type DictationState = 'idle' | 'starting' | 'recording' | 'finishing';
export type { MicProblem };

export interface Dictation {
  state: DictationState;
  note?: string;
  problem?: MicProblem;
  // For the strip in the message box (DictationStrip), while it records: since when (ms), the chunks
  // out being transcribed, the words just put in the box and when, the sound level now (0 when off).
  startedAt?: number;
  pending: number;
  heard?: { text: string; at: number };
  level: () => number;
  toggle(): void;
  stop(): void;
}

const SILENT = () => 0;

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
  const [startedAt, setStartedAt] = useState<number>();
  const [pending, setPending] = useState(0);
  const [heard, setHeard] = useState<{ text: string; at: number }>();
  const levelOf = useRef<() => number>(SILENT);
  const level = useStableCallback(() => levelOf.current());
  // A chunk out, or back (`by` -1).
  const out = (by: number) => mounted.current && setPending((n) => Math.max(0, n + by));
  const heardNow = (text: string) => {
    if (!mounted.current) return;
    insert(text);
    setHeard({ text, at: Date.now() });
  };
  // Stopping, by itself too (silence, a failed chunk): the microphone is off, its last chunks out.
  const stopping = () => {
    levelOf.current = SILENT;
    if (mounted.current) setState((s) => (s === 'recording' ? 'finishing' : s));
  };
  const recording = (meter: () => number) => {
    levelOf.current = meter;
    setStartedAt(Date.now());
    setState('recording');
  };
  const session = useRef<Pick<Session, 'stop'>>(undefined);
  const run = useRef(0); // the current dictation: a start that a stop overtook is dropped
  const mounted = useRef(true);
  const abort = useRef<() => void>(undefined); // its requests dropped

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
    const onEnd = (end: SessionEnd) => {
      levelOf.current = SILENT;
      if (!mounted.current) return;
      session.current = undefined;
      setState('idle');
      setStartedAt(undefined);
      setPending(0);
      setHeard(undefined);
      setNote(endNote(end, target.silenceStopMs));
    };
    if (FLOATING) return startOffscreen(mine, target, provider, model, fail, onEnd);
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
    abort.current = () => requests.abort();
    session.current = startSession({
      chunkMs: target.chunkSeconds * 1000,
      record: () => chunkRecorder(stream),
      peak: meter.peak,
      send: (audio, tail) => {
        out(1);
        return transcribe(provider, audio, dictationOptions({ ...target, model }, tail), requests.signal).finally(() => out(-1));
      },
      silenceLevel: target.silenceLevel,
      silenceStopMs: target.silenceStopMs,
      insert: heardNow,
      release: () => {
        levelOf.current = SILENT;
        meter.close();
        release(stream);
      },
      onStopping: stopping,
      onEnd,
    });
    recording(meter.level);
  };

  // Floating: the same, recorded in the offscreen document.
  const startOffscreen = async (mine: number, target: VoiceTarget, provider: ProviderConfig, model: string, fail: (why: { note?: string; problem?: MicProblem }) => void, onEnd: (end: SessionEnd) => void) => {
    let remote: RemoteDictation;
    let heardLevel = 0;
    try {
      remote = await offscreenDictation({
        provider,
        model,
        ...(target.deviceId && { deviceId: target.deviceId }),
        chunkMs: target.chunkSeconds * 1000,
        ...(target.language && { language: target.language }),
        ...(target.vocabulary && { vocabulary: target.vocabulary }),
        ...(target.temperature !== undefined && { temperature: target.temperature }),
        silenceLevel: target.silenceLevel,
        ...(Number.isFinite(target.silenceStopMs) && { silenceStopMs: target.silenceStopMs }),
      }, { insert: heardNow, onEnd, level: (l) => void (heardLevel = l), pending: (n) => mounted.current && setPending(n), stopping });
    } catch (e) {
      const problem = micProblem(e);
      return fail(problem ? { problem } : { note: `Dictation stopped: ${errorText(e)}` });
    }
    // Stopped, or another conversation opened, while the browser gave it: off at once.
    if (run.current !== mine || !mounted.current) return remote.drop();
    const shown = composer.current?.selection();
    placed.current = shown ?? { value: '', at: 0 };
    abort.current = remote.drop;
    session.current = remote;
    recording(() => heardLevel);
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
      abort.current?.();
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

  // Floating, folded by the widget's bar or its shortcut (widget/ui/floating-chat): hidden, so it stops.
  // Said by this tab's widget only.
  useEffect(() => {
    if (!FLOATING) return;
    return onRuntime(WIDGET_FOLDED, (_msg, sender) => {
      if (senderOf(sender).fromPage && sender.tab?.id !== undefined && sender.tab.id === knownFloatingTab()?.id) stop();
    });
  }, [stop]);

  return { state, note, problem, startedAt, pending, heard, level, toggle, stop };
}
