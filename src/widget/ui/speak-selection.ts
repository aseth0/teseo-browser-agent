// The toolbar beside the text the user selects: a speaker that reads it aloud with the active agent's voice
// (Settings → Speak; background/speech-host), Stop while it is read; then the actions marked to show there
// (WidgetAction.besideSelection, widget/selection-bar), their card under it (widget/ui/selection-card).
// With no such action, the speaker alone, a round button. Drawn by the page widget, in a closed shadow root
// of its own, only while the bubble shows on the site (lifecycle starts and stops it with the bubble:
// hidden there, nothing of it is in the page). Placed under the end of the selection, away from what the
// page itself puts there when it can tell: a menu of the page's own (an element laid over the text, fixed
// or absolutely placed) moves it to another corner. Pressing it keeps the selection.
import { bestEffort } from '../../core/errors';
import { onRuntime, sendRuntime } from '../../core/runtime';
import { pageSelection } from '../../speech/selection';
import { SPEAK_PILL, SPEAK_STOP, SPEAK_TEXT } from '../../speech/protocol';
import { actionIcon, MAX_PAGE_VALUE, type WidgetActionInfo } from '../protocol';
import { BAR_BUTTON, BAR_PAD, barWidth, besideActions, SEPARATOR_GAP, SPEAKER as SIZE } from '../selection-bar';
import { MAX_READ_CHARS, type BoxSpeaker } from './box-speak';
import { el, keepKeys, pin, trustedButton, widgetHost } from './dom';
import type { FloatingChat } from './floating-chat';
import { createSelectionCard } from './selection-card';
import { icon, SPEAKER, STOP } from './speaker-icons';
import type { WidgetState } from './state';
import { STYLE } from './style';

const SETTLE_MS = 300; // the selection rests this long (the page's own menu comes meanwhile)

// The speaker alone, as it always was: this light rule and nothing else.
const SPEAKER_STYLE = `
  .round, .bar { box-sizing: border-box; color: #1a73e8; background: #fff; border: 1px solid #dadce0; box-shadow: 0 2px 6px rgba(0,0,0,.2); }
  .round { width: ${SIZE}px; height: ${SIZE}px; padding: 0; display: grid; place-items: center; border-radius: 50%; cursor: pointer; }
  .failed { color: #b3261e; }
  @media (prefers-color-scheme: dark) { .round, .bar { color: #8ab4f8; background: #292a2d; border-color: #5f6368; } }`;
const LONE_STYLE = `:host { all: initial; }${SPEAKER_STYLE}`;
// With actions, the pill in the speaker's colors; the "…" list and the card in the theme's (the bubble's STYLE).
const BAR_STYLE = `${STYLE}${SPEAKER_STYLE}
  .bar { height: ${SIZE}px; padding: 0 ${BAR_PAD}px; display: flex; align-items: center; border-radius: ${SIZE / 2}px; }
  .bar button { flex: none; width: ${BAR_BUTTON}px; height: ${BAR_BUTTON}px; padding: 0; display: grid; place-items: center; border: 0; border-radius: 50%;
    background: none; color: inherit; cursor: pointer; font-size: 14px; line-height: 1; box-shadow: none; }
  .bar button:hover, .bar button.on { background: rgba(26,115,232,.12); }
  .sep { flex: none; width: 1px; height: 14px; margin: 0 ${SEPARATOR_GAP}px; background: #dadce0; }
  @media (prefers-color-scheme: dark) {
    .sep { background: #5f6368; }
    .bar button:hover, .bar button.on { background: rgba(138,180,248,.16); }
  }
  .sel-more { position: absolute; min-width: 180px; max-width: 280px; padding: 4px; display: grid;
    background: var(--bg); color: var(--fg); border: 1px solid var(--border); border-radius: 8px; box-shadow: var(--shadow-pop); }
  .sel-more.down { top: ${SIZE + 4}px; } .sel-more.up { bottom: ${SIZE + 4}px; }
  .sel-more.start { left: 0; } .sel-more.end { right: 0; }
  .sel-item { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border: 0; border-radius: 6px; background: none; color: inherit; cursor: pointer; text-align: left; }
  .sel-item:hover, .sel-item.on { background: var(--surface); }
  .sel-item-icon { flex: none; width: 18px; text-align: center; }
  .sel-item-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sel-item-note { flex: none; color: var(--muted); font-size: var(--fs-xs); }
  .sel-card { min-height: 0; max-width: none; }
  .sel-card .pop-head { cursor: default; }`;

// Whether an element at that point is laid over the page (a menu, a toolbar), not its text.
function laidOver(x: number, y: number, under: Node | null): boolean {
  const found = document.elementFromPoint(x, y);
  if (!found || (under && found.contains(under))) return false;
  for (let e: Element | null = found, n = 0; e && n < 6; e = e.parentElement, n++) {
    const position = getComputedStyle(e).position;
    if (position === 'fixed' || position === 'absolute' || position === 'sticky') return !(under && e.contains(under));
  }
  return false;
}

// Where it goes (`width` wide, `height` high): under the selection's end, else under its start, else above
// its start, else (a toolbar too wide to fit after the selection's end) under its end moved left into the
// window; none when every one is off the window or under something of the page's (at either end of a toolbar).
export function placeFor(rects: DOMRect[], free: (x: number, y: number) => boolean, width = SIZE, height = SIZE): { x: number; y: number } | undefined {
  const first = rects[0], last = rects.at(-1);
  if (!first || !last) return undefined;
  const spots = [
    { x: last.right + 2, y: last.bottom + 4 },
    { x: first.left - width - 2, y: first.bottom + 4 },
    { x: first.left, y: first.top - height - 4 },
    ...(last.right + 2 + width > innerWidth ? [{ x: innerWidth - width, y: last.bottom + 4 }] : []),
  ];
  return spots.find(({ x, y }) => x >= 0 && y >= 0 && x + width <= innerWidth && y + height <= innerHeight
    && free(x + SIZE / 2, y + height / 2) && (width === SIZE || free(x + width - SIZE / 2, y + height / 2)));
}

interface SpeakSelectionParts {
  toChat: FloatingChat['toChat']; // an action that opens the chat, or goes on in it
  theme: () => void; // the theme put on the hosts again (its card's colors)
  speaker: BoxSpeaker; // the page's box speakers, shared with the bubble's card
}

export function createSpeakSelection(s: WidgetState, { toChat, theme, speaker: boxes }: SpeakSelectionParts) {
  // Built once, then kept out of the page while there is nothing to show (put back as it is).
  let host: HTMLElement | undefined;
  let root: ShadowRoot | undefined;
  let style: HTMLStyleElement | undefined;
  let speaker: HTMLButtonElement | undefined;
  let bar: HTMLElement | undefined; // the toolbar: the speaker and the actions' buttons
  let more: HTMLElement | undefined; // the "…" list
  let moreButton: HTMLButtonElement | undefined;
  let layout = ''; // what the toolbar has: the speaker or not, and its actions
  let at: { x: number; y: number } | undefined; // its place in the window, while shown
  let gone: AbortController | undefined; // its listeners, while started
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reading = false; // what this tab's button started is being read
  let ownPointer = false; // the last press was on the toolbar or its card (the selection changes there are its own)
  let text = '';

  // The card, made the first time an action shows here (the theme then put on the host for it).
  let card: ReturnType<typeof createSelectionCard> | undefined;
  const cardFor = () => {
    if (card) return card;
    theme();
    return (card = createSelectionCard(s, {
      toChat,
      speaker: boxes,
      selection: () => text.slice(0, MAX_PAGE_VALUE),
      bar: () => at && { ...at, height: SIZE },
      shown: (id) => {
        for (const b of [...(bar?.querySelectorAll<HTMLElement>('[data-action]') ?? []), ...(more?.querySelectorAll<HTMLElement>('[data-action]') ?? [])]) b.classList.toggle('on', b.dataset.action === id);
        moreButton?.classList.toggle('on', !!id && !!more?.querySelector(`[data-action="${CSS.escape(id)}"]`));
        // Closed: the toolbar follows the selection as it is now (gone meanwhile: it goes too).
        if (!id && gone) later();
      },
    }));
  };

  const draw = () => {
    if (!speaker) return;
    speaker.replaceChildren(icon(reading ? STOP : SPEAKER));
    speaker.title = speaker.ariaLabel = reading ? 'Stop reading aloud' : 'Read the selection aloud';
  };
  const closeMore = () => {
    if (!more) return;
    more.hidden = true;
    moreButton?.setAttribute('aria-expanded', 'false');
  };
  // As the page's actions say now (one gone or no longer marked: nothing).
  const pressAction = (id: string) => {
    closeMore();
    const action = s.actions.find((a) => a.id === id && a.besideSelection);
    if (action) cardFor().press(action);
  };
  const actionButton = (action: WidgetActionInfo) => {
    const name = action.openChat ? `${action.name} (opens chat)` : action.name;
    const b = trustedButton({ type: 'button', textContent: actionIcon(action), title: name, ariaLabel: name }, () => pressAction(action.id));
    b.dataset.action = action.id;
    return b;
  };
  const moreItem = (action: WidgetActionInfo) => {
    const b = trustedButton({ type: 'button', className: 'sel-item', title: action.name }, () => pressAction(action.id));
    b.append(el('span', { className: 'sel-item-icon', textContent: actionIcon(action) }), el('span', { className: 'sel-item-name', textContent: action.name }),
      ...(action.openChat ? [el('span', { className: 'sel-item-note', textContent: 'opens chat' })] : []));
    b.dataset.action = action.id;
    return b;
  };

  // The toolbar as it is now: the speaker alone, round, as it always was; or the pill with the actions.
  const fill = (speakerOn: boolean, shown: WidgetActionInfo[], hidden: WidgetActionInfo[]) => {
    card?.close();
    speaker = moreButton = more = undefined;
    const parts: HTMLElement[] = [];
    if (speakerOn) {
      speaker = trustedButton({ type: 'button', className: shown.length ? '' : 'round' }, () => void press());
      parts.push(speaker);
    }
    if (!shown.length) {
      bar = speaker!;
    } else {
      if (speakerOn) parts.push(el('span', { className: 'sep' }));
      parts.push(...shown.map(actionButton));
      if (hidden.length) {
        moreButton = trustedButton({ type: 'button', textContent: '…', title: 'More actions', ariaLabel: 'More actions' }, () => {
          if (!more) return;
          more.hidden = !more.hidden;
          moreButton!.setAttribute('aria-expanded', String(!more.hidden));
          placeMore();
        });
        moreButton.setAttribute('aria-haspopup', 'true');
        moreButton.setAttribute('aria-expanded', 'false');
        parts.push(moreButton);
        more = el('div', { className: 'sel-more' }, ...hidden.map(moreItem));
        more.hidden = true;
      }
      bar = el('div', { className: 'bar' }, ...parts);
      bar.style.width = `${barWidth(speakerOn, shown.length + (hidden.length ? 1 : 0))}px`;
    }
    // Pressing it must not clear the selection it reads, nor the one its actions take.
    for (const e of [bar, more]) e?.addEventListener('mousedown', (m) => m.preventDefault());
    const look = shown.length ? BAR_STYLE : LONE_STYLE;
    if (style!.textContent !== look) style!.textContent = look;
    root!.replaceChildren(style!, bar, ...(more ? [more] : []), ...(shown.length ? [cardFor().element] : []));
    draw();
  };
  const build = () => {
    host = widgetHost();
    pin(host, { position: 'fixed', 'z-index': '2147483646', left: '0', top: '0', width: `${SIZE}px`, height: `${SIZE}px` });
    root = host.attachShadow({ mode: 'closed' });
    style = el('style');
    keepKeys(host); // typed in the card's field: not the page's shortcuts
    host.addEventListener('pointerdown', () => (ownPointer = true));
  };
  // Out of the page; kept to come back as it was.
  const hide = () => {
    closeMore();
    card?.close();
    host?.remove();
    at = undefined;
  };
  const placeMore = () => {
    if (!more || !at) return;
    const up = at.y > innerHeight / 2;
    const start = at.x < innerWidth / 2; // opens to the right of the toolbar's left, or to the left of its right
    more.classList.toggle('up', up);
    more.classList.toggle('down', !up);
    more.classList.toggle('start', start);
    more.classList.toggle('end', !start);
  };
  const show = (to: { x: number; y: number }, width: number) => {
    at = to;
    if (!host!.isConnected) document.documentElement.append(host!);
    pin(host!, { width: `${width}px`, transform: `translate(${Math.round(to.x)}px, ${Math.round(to.y)}px)` });
    card?.place();
    placeMore();
  };

  const press = async () => {
    if (reading) {
      reading = false;
      draw();
      return void bestEffort(sendRuntime({ type: SPEAK_STOP }), 'widget-speak');
    }
    if (!text) return;
    reading = true;
    draw();
    const r = await bestEffort(sendRuntime({ type: SPEAK_TEXT, text }), 'widget-speak');
    if (r && 'started' in r) return;
    reading = false;
    draw();
    if (speaker) {
      speaker.classList.add('failed');
      speaker.title = speaker.ariaLabel = `Not read aloud: ${r && 'error' in r ? r.error : 'the extension did not answer.'}`;
    }
  };

  // The selection now: the toolbar follows it, or goes (but while it reads, it stays to stop it). A card
  // open stays while the selection changes only in it (its field, its text), and goes with the selection.
  const follow = () => {
    const speakerOn = !!s.speakButton;
    const { shown, more: hidden } = besideActions(s.actions);
    if (!s.host || s.capturing || (!speakerOn && !shown.length)) return hide();
    const open = !!card?.open();
    const own = open && (ownPointer || (!!host && document.activeElement === host));
    const selection = getSelection();
    const now = pageSelection().trim().slice(0, MAX_READ_CHARS);
    // Changed in the card (its field, its text): the card's own; the same selection, it follows it (a scroll).
    if (own && (now !== text || !selection?.rangeCount)) return;
    if (!now || !selection?.rangeCount) {
      text = '';
      card?.close();
      closeMore();
      return reading ? undefined : hide();
    }
    if (now !== text) {
      card?.close();
      closeMore();
    }
    text = now;
    const range = selection.getRangeAt(selection.rangeCount - 1);
    // A selection in a text field: the field's box.
    const field = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement ? document.activeElement : undefined;
    const rects = field ? [field.getBoundingClientRect()] : [...range.getClientRects()].filter((r) => r.width || r.height);
    const under = field ?? range.commonAncestorContainer;
    const width = barWidth(speakerOn, shown.length + (hidden.length ? 1 : 0));
    const to = placeFor(rects, (x, y) => !laidOver(x, y, under), width, SIZE);
    if (!to) return reading || card?.open() ? undefined : hide();
    if (!host) build();
    // Its buttons are made again when what they show changes; a press looks the action up by its id.
    const next = JSON.stringify([speakerOn, shown, hidden]);
    if (next !== layout) {
      layout = next;
      fill(speakerOn, shown, hidden);
    }
    speaker?.classList.remove('failed');
    if (!reading) draw();
    show(to, width);
  };
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(follow, SETTLE_MS);
  };
  return {
    // With the bubble: listening to the selection, and to the end of what it started.
    start() {
      if (gone) return;
      gone = new AbortController();
      const { signal } = gone;
      document.addEventListener('selectionchange', later, { signal });
      addEventListener('scroll', later, { signal, capture: true, passive: true });
      addEventListener('resize', later, { signal });
      // A press elsewhere on the page: the selection's changes from now on are the page's.
      document.addEventListener('pointerdown', (e) => {
        if (!host || !e.composedPath().includes(host)) ownPointer = false;
      }, { capture: true, signal });
      // Escape closes the card (what it runs stops) and the "…" list.
      document.addEventListener('keydown', (e) => {
        if (!e.isTrusted || e.key !== 'Escape') return;
        closeMore();
        card?.close();
      }, { capture: true, signal });
      const stopListening = onRuntime(SPEAK_PILL, (msg) => {
        if (msg.off && reading) {
          reading = false;
          draw();
          later();
        }
      });
      signal.addEventListener('abort', stopListening, { once: true });
      later();
    },
    stop() {
      clearTimeout(timer);
      gone?.abort();
      gone = undefined;
      reading = false;
      ownPointer = false;
      text = '';
      hide();
    },
    follow,
    host: () => host,
  };
}
