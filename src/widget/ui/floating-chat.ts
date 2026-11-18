// The chat floating on this page ("Open the chat here"): the side panel's page in an iframe, its
// page this tab. Moved by its bar, resized from any edge, its place kept per site. Its conversation
// goes to the side panel (◨, between turns), which the background opens inside the click, and the
// chat closes. Folded (–) it stays as it is (but for a dictation, which stops), the bubble's item brings it back; closed (✕) it goes,
// its conversation kept in the history. Maximized (⤢, or a double click on its bar) it fills the
// page, neither moved nor resized, until restored; its place on the site stays as it was. The background remembers it is
// open in this tab, to open it again after a reload. Its pin (📌) keeps its conversation in the
// floating chat of every tab, until unpinned (background/sticky-chat, sidepanel/floating). Hiding the bubble on the site leaves it on the
// page, unfolded, until it is closed or moved to the side panel: only then does the rest of the widget go.
import { browser } from 'wxt/browser';
import { bestEffort } from '../../core/errors';
import { sendRuntime } from '../../core/runtime';
import { Pin } from 'lucide';
import { iconSvg } from '../bubble-icons';
import { FRAME_TICKET, FRAME_TICKET_PARAM, WIDGET_FLOATING, WIDGET_FOLDED, WIDGET_OPEN_CHAT, WIDGET_STICKY, WIDGET_TO_PANEL, type ChatState, type OpenChatAction } from '../protocol';
import { el, keepKeys, pin, trustedButton, widgetHost } from './dom';
import { clamp, resizeHandle, RESIZE_EDGES, type Box, type Edge } from './pointer';
import { floats, type WidgetHost, type WidgetState } from './state';
import { BAR, BUBBLE_TITLE, STYLE } from './style';

const CHAT_W = 380; // its size the first time, unless Settings → Bubble says
const CHAT_H = 560;
const MARGIN = 24; // its first place, from the window's edges
const MIN_CHAT_W = 300; // and its smallest
const MIN_CHAT_H = 320;

export type FloatingChat = ReturnType<typeof createFloatingChat>;

// `onClose`: it went from the page (closed, or moved to the side panel).
export function createFloatingChat(s: WidgetState, { render, savePlace }: WidgetHost, applyTheme: () => void, onClose: () => void) {
  let chatHost: HTMLElement | undefined;
  let chatFrame: HTMLIFrameElement;
  let folded = false;
  let maximized = false;
  let chatState: ChatState = 'idle';
  let movable = true; // its conversation can go to the side panel now (the chat says, WIDGET_CHAT_STATE)
  let toPanel: HTMLButtonElement | undefined;
  // The pin (WIDGET_STICKY): on while it shows the pinned conversation, which every tab's floating chat
  // shows then; it can be pinned once saved, between turns (the chat says, WIDGET_CHAT_STATE).
  let sticky = false;
  let stickable = false;
  let pinButton: HTMLButtonElement | undefined;
  const showPin = () => {
    if (!pinButton) return;
    pinButton.disabled = !sticky && !stickable;
    pinButton.setAttribute('aria-pressed', String(sticky));
    pinButton.classList.toggle('on', sticky);
    pinButton.title = sticky ? 'Pinned: this conversation shows in the floating chat of every tab. Click to unpin it'
      : stickable ? 'Pin it: show this conversation in the floating chat of every tab' : 'Pin it (once it is saved in the history, between turns)';
  };
  const togglePin = async () => {
    const reply = await bestEffort(sendRuntime({ type: WIDGET_STICKY, on: !sticky }), 'widget');
    if (reply) sticky = reply.sticky;
    showPin();
  };
  let unseen = false; // it answered while folded
  // As the user left it on this site; else as Settings → Bubble says.
  const chatBox = (): Box => {
    if (maximized) return { left: MARGIN, top: MARGIN, width: innerWidth - 2 * MARGIN, height: innerHeight - 2 * MARGIN };
    const c = s.place.chat;
    const first = s.chatWindow ?? {};
    const width = clamp(c?.width ?? first.width ?? CHAT_W, MIN_CHAT_W, innerWidth);
    const height = clamp(c?.height ?? (first.height === 'full' ? innerHeight - 2 * MARGIN : first.height ?? CHAT_H), MIN_CHAT_H, innerHeight);
    const left = c?.x ?? (first.side === 'left' ? MARGIN : innerWidth - width - MARGIN);
    return { width, height, left: clamp(left, 0, innerWidth - width), top: clamp(c?.y ?? MARGIN, 0, innerHeight - BAR) };
  };
  const placeChat = (b = chatBox()) => chatHost && pin(chatHost, { left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px` });
  const keepChat = (b: Box) => void savePlace({ chat: { x: Math.round(b.left), y: Math.round(b.top), width: Math.round(b.width), height: Math.round(b.height) } });
  // While it is moved or resized, the frame does not take the pointer (the handle or the bar keeps it).
  const chatHandle = (edge: Edge) => resizeHandle(edge, () => {
    if (maximized) return undefined;
    chatFrame.style.pointerEvents = 'none';
    return { box: chatBox(), min: [MIN_CHAT_W, MIN_CHAT_H], max: [innerWidth, innerHeight] };
  }, placeChat, (b) => {
    chatFrame.style.pointerEvents = '';
    keepChat(b);
  });
  // The bubble says what the floating chat does while folded (it shows itself otherwise).
  const showChatState = () => {
    const shown = chatHost && folded ? chatState : 'idle';
    const answered = !!chatHost && folded && unseen && shown === 'idle';
    showOnBubble(s, shown, answered);
  };
  // Shown or folded, off the page while it is captured, and placed, as render() has the widget. The
  // bubble hidden on the site leaves it shown (unfolded: the bubble that would bring it back is gone).
  const layout = () => {
    if (!chatHost) return;
    pin(chatHost, { display: s.capturing || folded ? 'none' : 'block' });
    placeChat();
  };
  const setChatState = (state: ChatState, canMove: boolean, pinned = false, canPin = false) => {
    if (folded && state === 'idle' && chatState !== 'idle') unseen = true;
    chatState = state;
    movable = canMove;
    sticky = pinned;
    stickable = canPin;
    if (toPanel) toPanel.disabled = !movable;
    showPin();
    render();
  };
  // Opened there and handed over: this chat goes (where the panel did not open, the chat starts anew).
  const moveToPanel = async () => {
    const reply = await bestEffort(sendRuntime({ type: WIDGET_TO_PANEL }), 'widget');
    if (reply?.opened && reply.moved) closeChat();
  };
  // Where the chat cannot float (s.noFloating: Firefox frames it without the APIs it needs), never framed:
  // the background opens it full screen in a tab instead (background/widget-host).
  const showChat = async () => {
    if (s.noFloating) return void toChat({});
    folded = false;
    unseen = false;
    if (s.place.hidden) await savePlace({ hidden: false }); // asked for: the widget shows again here
    if (!chatHost) await (opening ??= openFrame().finally(() => (opening = undefined)));
    if (!chatHost) return; // no ticket: no frame
    render();
    await bestEffort(sendRuntime({ type: WIDGET_FLOATING, open: true }), 'widget');
  };
  // Folded: hidden on the page, so its dictation stops (WIDGET_FOLDED).
  const fold = () => {
    folded = true;
    render();
    void sendRuntime({ type: WIDGET_FOLDED }).catch(() => undefined);
  };
  // Folded when shown; else shown (⌥⇧F, and the bubble when the chat floats).
  const toggleChat = () => {
    if (!chatHost || folded) return void showChat();
    fold();
  };
  // The chat's frame, built once the background gave a ticket for this tab (background/frame-tickets):
  // without one, the chat's page shows nothing. One asked at a time: two shows at once build one frame;
  // closed meanwhile (`closes` counts), none.
  let opening: Promise<void> | undefined;
  let closes = 0;
  const openFrame = async () => {
    const before = closes;
    const reply = await bestEffort(sendRuntime({ type: FRAME_TICKET }), 'widget');
    if (reply?.ticket && !chatHost && closes === before) buildChat(reply.ticket);
  };
  const closeChat = (tell = true) => {
    closes++;
    if (!chatHost) return;
    chatHost.remove();
    chatHost = undefined;
    toPanel = undefined;
    pinButton = undefined;
    maximized = false;
    if (tell) void bestEffort(sendRuntime({ type: WIDGET_FLOATING, open: false }), 'widget');
    onClose();
  };
  const buildChat = (ticket: string) => {
    chatHost = widgetHost();
    pin(chatHost, { position: 'fixed', 'z-index': '2147483647' });
    const root = chatHost.attachShadow({ mode: 'closed' });
    keepKeys(chatHost);
    const button = (text: string, title: string, onClick: () => void) => trustedButton({ className: 'icon', textContent: text, title, ariaLabel: title }, onClick);
    const size = button('⤢', 'Maximize it', () => toggleMaximized());
    const toggleMaximized = () => {
      maximized = !maximized;
      size.textContent = maximized ? '⤡' : '⤢';
      size.title = size.ariaLabel = maximized ? 'Restore its size' : 'Maximize it';
      panel.classList.toggle('maximized', maximized);
      render();
    };
    toPanel = button('◨', 'Open in the side panel', () => void moveToPanel());
    toPanel.disabled = !movable;
    pinButton = trustedButton({ className: 'icon pin', ariaLabel: 'Pin this conversation' }, () => void togglePin());
    pinButton.append(iconSvg(Pin, 14));
    showPin();
    const bar = el('div', { className: 'floating-bar' }, el('span', { textContent: '✦ Teseo' }),
      pinButton,
      toPanel,
      button('–', 'Fold it (the bubble brings it back)', fold),
      size,
      button('✕', 'Close it (the conversation stays in the history)', () => closeChat()));
    // The ticket in the fragment: never in a request, nor in a referrer.
    chatFrame = el('iframe', { src: `${browser.runtime.getURL('/floating.html')}#${FRAME_TICKET_PARAM}=${ticket}`, title: 'Teseo chat' });
    chatFrame.allow = 'clipboard-write'; // its Copy buttons
    const panel = el('div', { className: 'floating' }, bar, chatFrame, ...RESIZE_EDGES.map(chatHandle));
    root.append(el('style', { textContent: STYLE }), panel);
    bar.addEventListener('dblclick', (e) => e.isTrusted && !(e.target as Element).closest('button') && toggleMaximized());
    dragByBar(bar, chatFrame, { start: () => (maximized ? undefined : chatBox()), place: placeChat, keep: keepChat });
    document.documentElement.append(chatHost);
    applyTheme();
  };
  // To the chat floating here (shown again if folded, opened if the settings say the chat floats);
  // else to the side panel, opened.
  // `where`: here (floating) or in the side panel; none: where the chat is, else as the settings say.
  // Where it cannot float, never here: the background opens the chat full screen in a tab.
  const toChat = async (what: { chat?: string; action?: OpenChatAction }, where?: 'here' | 'panel') => {
    const floating = !s.noFloating && (where ? where === 'here' : !!chatHost || floats(s));
    if (floating) void showChat();
    return bestEffort(sendRuntime({ type: WIDGET_OPEN_CHAT, ...what, ...(floating && { floating }) }), 'widget');
  };
  return {
    host: () => chatHost,
    folded: () => !!chatHost && folded, // shown on the page, folded
    unfold: () => void (folded = false),
    showState: showChatState,
    layout,
    setState: setChatState,
    show: showChat,
    toggle: toggleChat,
    close: closeChat,
    toChat,
  };
}

// Moved by its bar, kept inside the window (`start`: where it is, none while it cannot move). While it
// moves, the frame does not take the pointer (the bar keeps it); where it ends is kept.
function dragByBar(bar: HTMLElement, frame: HTMLIFrameElement, { start, place, keep }: { start: () => Box | undefined; place: (b: Box) => void; keep: (b: Box) => void }) {
  bar.addEventListener('pointerdown', (e) => {
    if (!e.isTrusted || e.button !== 0 || (e.target as Element).closest('button')) return;
    const from = start();
    if (!from) return;
    bar.setPointerCapture(e.pointerId);
    bar.classList.add('dragging');
    frame.style.pointerEvents = 'none';
    let box = from;
    const move = (m: PointerEvent) => {
      box = { ...from, left: clamp(from.left + m.clientX - e.clientX, 0, innerWidth - from.width), top: clamp(from.top + m.clientY - e.clientY, 0, innerHeight - BAR) };
      place(box);
    };
    bar.addEventListener('pointermove', move);
    // However the drag ends (let go, or cancelled by the browser): else the frame would stay without
    // the pointer, and its chat could no longer be scrolled or clicked.
    bar.addEventListener('lostpointercapture', () => {
      bar.removeEventListener('pointermove', move);
      bar.classList.remove('dragging');
      frame.style.pointerEvents = '';
      keep(box);
    }, { once: true });
  });
}

// What the bubble says of the chat while it is folded: working, waiting for an approval, answered.
function showOnBubble(s: WidgetState, shown: ChatState, answered: boolean) {
  s.bubble.classList.toggle('working', shown === 'working');
  s.bubble.classList.toggle('waiting', shown === 'waiting');
  s.bubble.classList.toggle('unseen', answered);
  s.waitMark.hidden = shown !== 'waiting';
  s.bubble.title = shown === 'working' ? 'Agent: working… click to show the chat'
    : shown === 'waiting' ? 'Agent: waiting for your approval. Click to show the chat'
    : answered ? 'Agent: it answered. Click to show the chat'
    : BUBBLE_TITLE;
}
