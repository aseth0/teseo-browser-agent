// Each answer read aloud on its own, where Settings → Speak → Reading says so for this chat's place
// (ui/chat/auto-read): as it streams, from the moment its first piece is final (speech/growing: Settings →
// Speak → First piece), the rest following as it is written. A message too short to start before it ends
// is read whole once the turn ends, if it is the answer; a message that ends calling tools, read only if it
// had started. A turn the user stopped: what was read goes on to its last whole sentence; one that failed
// is not read. In the Agents Panel, "the chat shown" is this one while its frame is not hidden.
import { useEffect, useRef } from 'react';
import { stripMarks } from '../../core/model-texts';
import { sendRuntime } from '../../core/runtime';
import type { Message } from '../../core/types';
import { speakable } from '../../speech/markdown';
import { finalPieces, wholeSentencesEnd } from '../../speech/growing';
import { SPEAK_GROW } from '../../speech/protocol';
import { planOptions } from '../../speech/settings';
import { answerToRead, readsAnswers, type ChatPlace } from '../../ui/chat/auto-read';
import type { SpeakButtons } from '../../ui/chat/contexts';
import { FLOATING, MANAGER, PREVIEW } from '../../ui/floating-frame';
import { keyOf } from '../../ui/keys';
import type { Settings } from '../../storage/settings';
import type { LiveSource } from './agent-store';

const PLACE: ChatPlace | undefined = PREVIEW ? undefined : FLOATING ? 'floating' : MANAGER ? 'manager' : 'panel';
// The Agents Panel hides the frames of the rows not selected (same origin: its element is reachable).
const shownHere = () => !(window.frameElement as HTMLElement | null)?.hidden;
const said = (markdown: string) => speakable(stripMarks(markdown));
const textOf = (parts: Message['parts']) => parts.map((p) => (p.type === 'text' ? p.text : '')).join('');
const grow = (key: string, text: string, done = false) => void sendRuntime({ type: SPEAK_GROW, key, text, ...(done && { done: true }) }).catch(() => undefined);

// The message being streamed: its key, whether its reading started, how many of its pieces are final, its text.
interface Streamed {
  key: string;
  started: boolean;
  final: number;
  text: string;
}

export function useAutoRead(live: LiveSource, history: Message[], busy: boolean, conversationId: string | undefined, settings: Settings, speak: SpeakButtons | undefined) {
  const agentId = history.findLast((m) => m.role === 'user')?.agent;
  const now = useRef({ settings, speak, conversationId, agentId });
  now.current = { settings, speak, conversationId, agentId };
  const streamed = useRef<Streamed | undefined>(undefined);
  const ended = useRef<Streamed | undefined>(undefined); // the one that ended, until the effect has its message
  const lastStarted = useRef(false); // the turn's last message ended with its reading started: the answer is not read again

  // As it streams: started once its first piece is final, then told each time one more is.
  useEffect(() => live.subscribe(() => {
    const snap = live.get();
    const c = now.current;
    if (c.conversationId !== undefined && snap.conversationId !== c.conversationId) return;
    const raw = snap.segments.filter((s) => s.kind === 'text').map((s) => s.text).join('');
    if (!raw) {
      // It ended: done by the effect below, with the message in the history.
      if (streamed.current) ended.current = streamed.current;
      streamed.current = undefined;
      return;
    }
    const m = (streamed.current ??= { key: `stream:${crypto.randomUUID()}`, started: false, final: 0, text: '' });
    m.text = said(raw);
    const o = planOptions(c.settings);
    const final = finalPieces(m.text, false, o.first, o.rest).length;
    if (final <= m.final) return;
    m.final = final;
    if (m.started) return grow(m.key, m.text);
    if (!c.speak?.readOnItsOwn || !readsAnswers(c.settings, PLACE, shownHere)) return;
    m.started = true;
    c.speak.readOnItsOwn(m.key, m.text, c.agentId, { growing: true });
  }), [live]);

  const was = useRef(busy);
  const pending = useRef<string | undefined>(undefined); // the conversation whose turn just ended, its answer not read yet
  const read = useRef<Message | undefined>(undefined);
  useEffect(() => {
    // A message ended (it is in the history, nothing streams), or the turn did: its reading is done.
    const m = ended.current;
    if (m) {
      ended.current = undefined;
      lastStarted.current = m.started;
      const last = history.at(-1);
      if (m.started) {
        const whole = (last?.role === 'assistant' && said(textOf(last.parts))) || m.text;
        grow(m.key, last?.stopped ? whole.slice(0, wholeSentencesEnd(whole)) : whole, true);
      }
    }
    if (busy) {
      pending.current = undefined;
      if (!was.current) lastStarted.current = false;
    } else if (was.current) pending.current = conversationId ?? '';
    was.current = busy;
    // The answer may land in the history a render after the run ends: read once it is there.
    if (pending.current === undefined || pending.current !== (conversationId ?? '')) return;
    const found = answerToRead(history);
    if (!found) return;
    pending.current = undefined;
    if (lastStarted.current || read.current === found.answer || !speak?.readOnItsOwn || !readsAnswers(settings, PLACE, shownHere)) return;
    read.current = found.answer;
    speak.readOnItsOwn(`answer:${keyOf(found.answer)}`, found.text, found.agentId);
  }, [live, busy, history, conversationId, settings, speak]);
}
