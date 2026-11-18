// The bubble: kept inside the window, dragged by itself (a click without moving opens the chat),
// the actions unfolding beside it while the pointer or the keyboard's focus is on it, and the card.
import { bestEffort } from '../../core/errors';
import { actionsLook, actionsReach, placeActions, setActionsLook } from '../actions-look';
import { sendRuntime } from '../../core/runtime';
import { MAX_PAGE_VALUE, WIDGET_OPEN_CHAT } from '../protocol';
import type { createCard } from './card';
import { actLabel, el, keepKeys, pin, trustedButton, widgetHost } from './dom';
import type { FloatingChat } from './floating-chat';
import type { createLoads } from './loads';
import { clamp, RESIZE_EDGES } from './pointer';
import { floats, type WidgetHost, type WidgetState } from './state';
import { BUBBLE, BUBBLE_TITLE, STYLE } from './style';
import type { createTheme } from './theme';

const OPEN_MS = 150; // the pointer rests on it this long before the actions unfold
const CLOSE_MS = 400; // and leaves it this long before they fold

interface BubbleParts {
  card: ReturnType<typeof createCard>;
  chat: FloatingChat;
  loads: ReturnType<typeof createLoads>;
  theme: ReturnType<typeof createTheme>;
}

export function createBubble(s: WidgetState, { render, savePlace }: WidgetHost, { card, chat, loads, theme }: BubbleParts) {
  let timer: ReturnType<typeof setTimeout> | undefined;

  // The bubble kept inside the window, its hat too; the actions unfold away from the nearest edges.
  const position = () => {
    const x = clamp(s.place.x ?? innerWidth - BUBBLE - 24, 0, innerWidth - BUBBLE);
    const y = clamp(s.place.y ?? innerHeight - BUBBLE - 24, s.drawn?.overhang ?? 0, innerHeight - BUBBLE);
    s.at = { x, y };
    if (s.host) pin(s.host, { transform: `translate(${x}px, ${y}px)` });
    if (s.menu) placeActions(s.menu, actionsLook(s.appearance), { x, y }, { width: innerWidth, height: innerHeight }, BUBBLE);
    const up = y > innerHeight / 2;
    s.pop?.classList.toggle('up', up);
    s.pop?.classList.toggle('down', !up);
    s.pop?.classList.toggle('left', x > innerWidth / 2);
    s.pop?.classList.toggle('right', x <= innerWidth / 2);
    // Past the actions unfolded beside the bubble (a row, an arc, names), on its side.
    if (s.pop && s.host && s.menu && !s.pop.hidden && !s.menu.hidden) {
      s.pop.style.setProperty('--clear', `${actionsReach(s.menu, s.host.getBoundingClientRect(), x > innerWidth / 2)}px`);
    }
    return { x, y };
  };

  // Dragged by the bubble, its actions folded meanwhile; a click without moving opens the side panel
  // (or pins the actions). The drag ends when the bubble loses the pointer: released, or cancelled.
  const dragOrClick = (onClick: () => void) => {
    s.bubble.addEventListener('pointerdown', (e) => {
      if (!e.isTrusted || e.button !== 0) return;
      const start = { px: e.clientX, py: e.clientY, ...position() };
      let released: PointerEvent | undefined;
      s.bubble.setPointerCapture(e.pointerId);
      s.bubble.classList.add('dragging');
      const move = (m: PointerEvent) => {
        if (!s.moving && Math.abs(m.clientX - start.px) + Math.abs(m.clientY - start.py) > 3) {
          s.moving = true;
          clearTimeout(timer);
          s.hovering = false;
          render();
        }
        s.place = { ...s.place, x: start.x + m.clientX - start.px, y: start.y + m.clientY - start.py };
        position();
      };
      const release = (u: PointerEvent) => (released = u);
      s.bubble.addEventListener('pointermove', move);
      s.bubble.addEventListener('pointerup', release);
      s.bubble.addEventListener('lostpointercapture', () => {
        s.bubble.removeEventListener('pointermove', move);
        s.bubble.removeEventListener('pointerup', release);
        s.bubble.classList.remove('dragging');
        if (s.moving) {
          s.moving = false;
          void savePlace(position());
          render();
        } else if (released?.isTrusted) onClick();
      }, { once: true });
    });
  };

  const build = () => {
    const host = (s.host = widgetHost());
    pin(host, { display: 'block', position: 'fixed', 'z-index': '2147483647', top: '0', left: '0', width: `${BUBBLE}px`, height: `${BUBBLE}px` });
    const root = host.attachShadow({ mode: 'closed' });
    keepKeys(host);
    s.count = el('span', { className: 'count' });
    s.count.hidden = true;
    s.waitMark = el('span', { className: 'wait-mark', textContent: '!' });
    s.waitMark.hidden = true;
    s.face = el('span', { className: 'face' });
    s.bubble = el('div', { className: 'bubble', title: BUBBLE_TITLE, ariaLabel: 'Agent', tabIndex: 0 }, s.face, s.count, s.waitMark);
    theme.showFace();
    s.bubble.setAttribute('role', 'button');
    s.menu = el('div', { className: 'menu' });
    setActionsLook(s.menu, actionsLook(s.appearance));
    s.popBody = el('div', { className: 'pop-body' });
    // Focusable: a click on it takes the focus there, so that Escape closes it.
    s.pop = el('div', { className: 'pop', tabIndex: -1 }, s.popBody, ...RESIZE_EDGES.map(card.handle));
    s.pop.hidden = true;
    // Its size as the user left it, per site.
    if (s.place.width) s.pop.style.width = `${s.place.width}px`;
    if (s.place.height) s.pop.style.height = `${s.place.height}px`;
    // The bubble first: from it, Tab goes on to the actions, then to the card.
    root.append(el('style', { textContent: STYLE }), s.bubble, s.menu, s.pop);
    // The side panel; or, as the settings say, the chat floating here (folded when shown). The chat
    // floating here folded comes back, whatever the settings say.
    const openChat = async () => {
      if (floats(s) || chat.folded()) return chat.toggle();
      const reply = await bestEffort(sendRuntime({ type: WIDGET_OPEN_CHAT }), 'widget');
      if (!reply?.opened) await savePlace({ pinned: !s.place.pinned });
      render();
    };
    dragOrClick(() => void openChat());
    s.bubble.addEventListener('keydown', (e) => {
      if (!e.isTrusted || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      void openChat();
    });
    const unfold = () => {
      s.selection = String(getSelection() ?? '').trim().slice(0, MAX_PAGE_VALUE);
      clearTimeout(timer);
      if (s.moving) return; // not while it is dragged
      timer = setTimeout(() => ((s.hovering = true), render()), OPEN_MS);
    };
    const fold = () => {
      clearTimeout(timer);
      timer = setTimeout(() => ((s.hovering = false), render()), CLOSE_MS);
    };
    // By the pointer, or by the keyboard: the actions stay unfolded while the keyboard's focus is
    // inside (not after a click, which focuses too).
    const keyboardFocus = () => !!root.activeElement?.matches(':focus-visible');
    host.addEventListener('pointerenter', unfold);
    host.addEventListener('pointerleave', () => !keyboardFocus() && fold());
    root.addEventListener('focusin', () => keyboardFocus() && unfold());
    root.addEventListener('focusout', (e) => !root.contains((e as FocusEvent).relatedTarget as Node | null) && fold());
    document.documentElement.append(host);
    void theme.load().then(followSettings);
  };

  let filledFor: boolean | undefined; // s.noFloating, as the menu's chat button says it
  const fillMenu = () => {
    filledFor = s.noFloating;
    const hide = trustedButton({ className: 'act small', textContent: '✕', title: 'Hide on this site: nothing of the bubble runs here, not even its actions on page load, until the keyboard shortcut or Settings → Bubble brings it back', ariaLabel: 'Hide on this site' },
      () => void savePlace({ hidden: true }));
    // Where the chat cannot float (s.noFloating), it opens full screen in a tab (floating-chat show).
    const here = s.noFloating
      ? trustedButton({ className: 'act', title: 'Open the chat full screen in a tab', ariaLabel: 'Open the chat' }, () => void chat.show())
      : trustedButton({ className: 'act', title: 'Open the chat here, on this page', ariaLabel: 'Open the chat here' }, () => void chat.show());
    here.append(...actLabel('💬', s.noFloating ? 'Chat' : 'Chat here'));
    s.menu.replaceChildren(...s.actions.map(card.actionButton), here, hide);
    loads.showFound();
  };

  // Taken away: its actions' unfolding or folding, still to come, does not.
  const dispose = () => {
    clearTimeout(timer);
    s.hovering = false;
  };

  // The settings read (the menu is filled before): its chat button again, only if where it opens changed.
  const followSettings = () => {
    if (s.host && s.noFloating !== filledFor) fillMenu();
  };

  return { position, build, fillMenu, followSettings, dispose };
}
