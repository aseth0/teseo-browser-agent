// The speaker on each text box of an action's card (Settings → Speak → Button on action boxes): it reads
// the box aloud with the action's voice (its own profile, else its agent's: background/speech-host; without
// a voice profile, the system's), and turns into Stop while that box is read. One reading at a time, as
// everywhere: another box's speaker takes its place, and the pill on the page stops it too. With nothing to
// read with ('setup'), the speaker is crossed out and says what to add.
// An action whose boxes are read on their own (WidgetAction.speak) asks for them all once its card shows
// them, in order, each waiting its turn in the background's queue; a box that waits shows a dashed speaker
// (a click reads it at once). Its boxes that still wait are dropped when its card goes, or another shows.
// An answer that streams into the card (not a JSON one) is read as it is written, from its first final piece.
import { bestEffort } from '../../core/errors';
import { onRuntime, sendRuntime } from '../../core/runtime';
import { finalPieces, wholeSentencesEnd } from '../../speech/growing';
import { speakable } from '../../speech/markdown';
import { SPEAK_GROW, SPEAK_PILL, SPEAK_STOP, SPEAK_TEXT, SPEAK_UNQUEUE } from '../../speech/protocol';
import { el, trustedButton } from './dom';
import { icon, SPEAKER, SPEAKER_OFF, STOP } from './speaker-icons';
import type { WidgetState } from './state';

export const NOTHING_TO_READ_WITH = 'Add a voice profile in Settings → Speak to read aloud, or switch its system voice on.';
export const MAX_READ_CHARS = 20_000; // of a box, or a selection, read at once (Speak cuts it further to Settings → Limits)
const KEY_PREFIX = 'action:'; // the background's key of a box: "action:<action>:<box>"

export type BoxSpeaker = ((actionId: string, box: number, label: string, text: string, note: HTMLElement) => HTMLButtonElement | undefined) & {
  newCard?: () => void; // a card is drawn: the boxes of text it has are those given from now on
  readOnItsOwn?: (actionId: string) => void; // the boxes of text of the card just drawn, read in order
  drop?: () => void; // its card went: the boxes that wait are not read
  // An answer read as it streams into the card (its box 0), if the action reads its boxes on its own.
  stream?: (actionId: string) => { grew: (markdown: string) => void; end: () => boolean } | undefined;
};

export function createBoxSpeak(s: WidgetState): BoxSpeaker {
  let reading: string | undefined; // the box read: "<action>:<box>"
  let waiting = new Set<string>(); // and those that wait their turn
  const shown = new Map<string, Set<HTMLButtonElement>>(); // its speakers, in the cards drawn
  let drawn: { actionId: string; box: number; text: string; note: HTMLElement }[] = []; // the boxes of text of the card drawn last
  let stopListening: (() => void) | undefined; // the background's news, while a box is read or waits
  let round = 0; // the boxes asked for on their own, until the user reads one or a card goes

  const draw = (key: string, b: HTMLButtonElement) => {
    const on = reading === key;
    const waits = !on && waiting.has(key);
    b.replaceChildren(icon(on ? STOP : SPEAKER));
    b.classList.toggle('waiting', waits);
    b.title = b.ariaLabel = on ? `Stop reading ${b.dataset.label}` : waits ? `${b.dataset.label} waits its turn: read it now` : `Read ${b.dataset.label} aloud`;
  };
  // Those of cards no longer shown are forgotten.
  const redraw = () => {
    for (const [key, buttons] of shown) {
      for (const b of buttons) if (b.isConnected) draw(key, b); else buttons.delete(b);
      if (!buttons.size) shown.delete(key);
    }
  };
  // What is read and what waits; listening to the background's news (the pill's) while there is any:
  // its keys with "action:" taken off, and its end, nothing.
  const update = (key: string | undefined, next: Iterable<string>) => {
    reading = key;
    waiting = new Set(next);
    const any = !!reading || waiting.size > 0;
    if (any && !stopListening) {
      stopListening = onRuntime(SPEAK_PILL, (msg) => {
        if (msg.off) return update(undefined, []);
        if (typeof msg.key !== 'string') return;
        const own = (k: string) => (k.startsWith(KEY_PREFIX) ? k.slice(KEY_PREFIX.length) : undefined);
        update(own(msg.key), (msg.waiting ?? []).map(own).filter((k): k is string => !!k));
      });
    } else if (!any) {
      stopListening?.();
      stopListening = undefined;
    }
    redraw();
  };

  const failed = (note: HTMLElement, r: unknown) => {
    const error = r && typeof r === 'object' && 'error' in r ? String(r.error) : 'the extension did not answer.';
    note.replaceChildren(el('div', { className: 'error speak-note', textContent: `Not read aloud: ${error}` }));
  };

  const speaker: BoxSpeaker = (actionId, box, label, text, note) => {
    if (!text.trim()) return undefined;
    drawn.push({ actionId, box, text, note });
    if (!s.speakBoxes) return undefined;
    const key = `${actionId}:${box}`;
    if (s.speakBoxes === 'setup') {
      const b: HTMLButtonElement = trustedButton({ className: 'icon speak off', title: NOTHING_TO_READ_WITH, ariaLabel: `Read ${label} aloud` }, () => {
        note.replaceChildren(el('div', { className: 'error speak-note', textContent: NOTHING_TO_READ_WITH }));
      });
      b.append(icon(SPEAKER_OFF));
      return b;
    }
    const b: HTMLButtonElement = trustedButton({ className: 'icon speak' }, () => void press());
    b.dataset.label = label;
    const press = async () => {
      note.replaceChildren();
      if (reading === key) {
        update(undefined, []);
        return void bestEffort(sendRuntime({ type: SPEAK_STOP }), 'widget-speak');
      }
      round++;
      update(key, []); // the user's own: it takes the place of the reading and of those that wait
      const r = await bestEffort(sendRuntime({ type: SPEAK_TEXT, text: text.slice(0, MAX_READ_CHARS), action: actionId, box }), 'widget-speak');
      if (r && 'started' in r) return;
      if (reading === key) update(undefined, waiting);
      failed(note, r);
    };
    if (!shown.has(key)) shown.set(key, new Set());
    shown.get(key)!.add(b);
    draw(key, b);
    return b;
  };

  // The boxes that wait, dropped (none waits: nothing said).
  const unqueue = () => {
    if (!waiting.size) return;
    update(reading, []);
    void bestEffort(sendRuntime({ type: SPEAK_UNQUEUE, prefix: KEY_PREFIX }), 'widget-speak');
  };

  speaker.newCard = () => {
    drawn = [];
  };
  speaker.readOnItsOwn = (actionId) => {
    const boxes = drawn.filter((d) => d.actionId === actionId);
    drawn = [];
    if (!s.canSpeak || !boxes.length) return;
    unqueue(); // another card's
    const own = ++round;
    void (async () => {
      for (const { box, text, note } of boxes) {
        if (own !== round) return;
        const key = `${actionId}:${box}`;
        // Shown at once (the background's news corrects it): read, or waiting its turn.
        if (!reading) update(key, waiting);
        else update(reading, [...waiting, key]);
        const r = await bestEffort(sendRuntime({ type: SPEAK_TEXT, text: text.slice(0, MAX_READ_CHARS), action: actionId, box, queued: true }), 'widget-speak');
        if (r && 'started' in r) continue;
        update(reading === key ? undefined : reading, [...waiting].filter((k) => k !== key));
        failed(note, r);
        if (r && 'settings' in r) return; // nothing to read with: the others would say the same
      }
    })();
  };
  // As it streams: started once its first piece is final (speech/growing), then told each time one more
  // is; once the answer is complete, done (and its box not read again). Its card gone first: what is read
  // goes on to its last whole sentence.
  let streaming: { key: string; text: string; started: boolean; final: number } | undefined;
  const grow = (key: string, text: string, done: boolean) =>
    void bestEffort(sendRuntime({ type: SPEAK_GROW, key: `${KEY_PREFIX}${key}`, text: text.slice(0, MAX_READ_CHARS), ...(done && { done: true }) }), 'widget-speak');
  const cutStream = () => {
    const st = streaming;
    streaming = undefined;
    if (st?.started) grow(st.key, st.text.slice(0, wholeSentencesEnd(st.text)), true);
  };
  speaker.stream = (actionId) => {
    cutStream();
    const sizes = s.pieceSizes;
    if (!s.canSpeak || !sizes) return undefined;
    unqueue();
    const own = ++round;
    const st: NonNullable<typeof streaming> = { key: `${actionId}:0`, text: '', started: false, final: 0 };
    streaming = st;
    return {
      grew: (markdown) => {
        if (own !== round || streaming !== st) return;
        st.text = speakable(markdown);
        const final = finalPieces(st.text, false, sizes.first, sizes.rest).length;
        if (final <= st.final) return;
        st.final = final;
        if (st.started) return grow(st.key, st.text, false);
        st.started = true;
        if (!reading) update(st.key, waiting);
        else update(reading, [...waiting, st.key]);
        void bestEffort(sendRuntime({ type: SPEAK_TEXT, text: st.text.slice(0, MAX_READ_CHARS), action: actionId, box: 0, queued: true, growing: true }), 'widget-speak');
      },
      end: () => {
        if (streaming !== st) return false;
        streaming = undefined;
        if (st.started) grow(st.key, st.text, true);
        return st.started;
      },
    };
  };
  speaker.drop = () => {
    cutStream();
    round++;
    drawn = [];
    unqueue();
  };
  return speaker;
}
