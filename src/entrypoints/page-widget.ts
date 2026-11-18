// The page widget: a bubble on the pages its actions match (Settings → Actions), registered as a
// content script by the background (widget/store). The pointer over it unfolds the actions, each a
// round button with its icon (its name on hover); a click on the bubble opens the side panel, or keeps
// the actions open when the browser does not allow that; "Open the chat here" floats the whole chat
// on the page instead (the side panel's page in an iframe). It runs in the isolated world, inside a
// closed shadow root: the page can neither style it nor click it for the user (clicks are checked
// with isTrusted), and what an action finds comes from the background in a message, never through
// the page. Plain DOM: it is injected into every matching page.
//
// The parts are in widget/ui: its look (style, theme), plain DOM (dom), moving and resizing
// (pointer), the bubble and its actions (bubble), an action's card (card), the actions on page load
// (loads), the floating chat (floating-chat), the toolbar beside a selection that reads it aloud and runs
// the actions marked for it (speak-selection, selection-card), and the widget over the page's life (lifecycle).
//
// Hidden on the site (its ✕, or the shortcut): nothing of it stays in the page, no action, no
// listener, no timer, no request, until it is called back. A page loaded there reads the site's
// place and leaves at once. Calling it back is the background's: the shortcut, Settings → Bubble's
// Show, or floating the chat on the page show it on the site again, and the background puts the
// widget into that site's open tabs (widget/store wakeWidget), where it starts as on a fresh page.
import { bestEffort } from '../core/errors';
import { onRuntime } from '../core/runtime';
import { WIDGET_FLOAT, WIDGET_HIDE, WIDGET_REPAINT, WIDGET_CHAT_STATE, WIDGET_TOGGLE, type WidgetPlace } from '../widget/protocol';
import { loadPlaces, onPlacesChanged, updatePlace, widgetSite } from '../widget/places';
import { createBoxSpeak } from '../widget/ui/box-speak';
import { createBubble } from '../widget/ui/bubble';
import { createCard } from '../widget/ui/card';
import { createEyes } from '../widget/ui/eyes';
import { createFloatingChat } from '../widget/ui/floating-chat';
import { createLifecycle, cutOff } from '../widget/ui/lifecycle';
import { createLoads } from '../widget/ui/loads';
import { createSpeakSelection } from '../widget/ui/speak-selection';
import { widgetState } from '../widget/ui/state';
import { createTheme } from '../widget/ui/theme';

declare global {
  interface Window {
    __browserAgentWidget?: boolean;
  }
}

// Once per page. A copy cut off by a reload of the extension may still be here for a moment, until
// it notices and leaves (retire): the new one waits for it.
const RETRY_MS = 1500;
// The page painted, until a moment after the floating chat last asked (WIDGET_REPAINT).
const REPAINT_MS = 2000;
export default defineUnlistedScript(function widget(tries = 0) {
  if (window.top !== window) return;
  if (window.__browserAgentWidget) {
    if (tries < 2) setTimeout(() => widget(tries + 1), RETRY_MS);
    return;
  }
  window.__browserAgentWidget = true;
  const site = widgetSite(location.href);
  // Hidden on this site: it leaves, nothing of it kept (the background puts it here again once called back).
  void bestEffort(loadPlaces(), 'widget-place').then((places) => {
    const place = places?.[site] ?? {};
    if (place.hidden || cutOff()) window.__browserAgentWidget = false;
    else startWidget(site, place);
  });
});

function startWidget(site: string, place: WidgetPlace) {
  const s = widgetState(site);
  s.place = place;
  // Every listener of this copy, removed at once when it goes (retire).
  const gone = new AbortController();
  const { signal } = gone;
  const onGone = (remove: () => void) => signal.addEventListener('abort', remove, { once: true });

  // Kept for the site when it can be (not once the extension is reloaded under the page): it shows
  // as it says here either way. Hidden or shown, it goes or comes at once.
  const savePlace = async (patch: WidgetPlace) => {
    s.place = { ...s.place, ...patch };
    follow();
    await bestEffort(updatePlace(s.site, patch), 'widget-place');
  };

  const render = () => {
    if (s.host) {
      s.host.style.display = s.capturing ? 'none' : '';
      s.menu.hidden = s.moving || !(s.hovering || s.place.pinned || !s.pop.hidden);
      s.bubble.classList.toggle('pinned', !!s.place.pinned);
      chat.showState();
      bubble.position();
    }
    chat.layout();
    eyes.sync();
  };

  const parts = { render, savePlace };
  const eyes = createEyes(s, signal);
  const theme = createTheme(s, () => [chat.host(), speak.host()], () => {
    bubble.position(); // room for its hat
    eyes.sync();
  }, signal);
  // The chat that stayed while the bubble was hidden, closed: the rest goes too.
  const chat = createFloatingChat(s, parts, theme.apply, () => s.place.hidden && retire());
  // The speakers of the actions' boxes: one for the bubble's card and the selection's (their keys are the background's).
  const boxes = createBoxSpeak(s);
  const card = createCard(s, parts, chat.toChat, boxes);
  const loads = createLoads(s, cutOff);
  const bubble = createBubble(s, parts, { card, chat, loads, theme });
  const speak = createSpeakSelection(s, { toChat: chat.toChat, theme: () => theme.apply(), speaker: boxes });
  const lifecycle = createLifecycle(s, parts, { bubble, card, chat, loads, theme, speak, retire: () => retire() });

  // Everything of this copy goes: hidden on the site (with no chat floating here), or cut off from the
  // extension (its chat's frame is the old extension's: the new copy opens it again).
  let retired = false;
  function retire() {
    if (retired) return;
    retired = true;
    // Cut off, a call into the extension may throw: whatever does, this copy still leaves the page and lets
    // the new one start (left there, its bubble is dead and its chat's frame is the old extension's).
    try {
      lifecycle.stop();
      chat.close(false);
    } finally {
      repaintUntil = 0;
      gone.abort();
      s.host?.remove();
      s.host = undefined;
      window.__browserAgentWidget = false; // a new copy may start
    }
  }
  // Shown or hidden on the site, as its place now says. Hidden: nothing of the bubble runs any more;
  // the chat floating here, if any, stays shown until it is closed. Shown again: it starts afresh.
  function follow() {
    if (retired) return;
    if (!s.place.hidden) void lifecycle.start();
    else if (chat.host()) {
      lifecycle.stop();
      chat.unfold();
    } else return retire();
    render();
  }

  // ✕, or Escape inside the widget, closes the card; a click elsewhere on the page leaves it (and
  // what it runs) as it is.
  document.addEventListener('keydown', (e) => e.isTrusted && e.key === 'Escape' && s.host && !s.pop.hidden && e.composedPath().includes(s.host) && card.close(), { capture: true, signal });
  addEventListener('resize', render, { signal });

  // Hidden or shown from another tab of the site, or Settings → Bubble.
  onGone(onPlacesChanged((places) => {
    s.place = places[s.site] ?? {};
    follow();
  }));
  // Frames, until a moment after the floating chat last asked.
  let repaintUntil = 0;
  const repaint = () => {
    const looping = performance.now() < repaintUntil;
    repaintUntil = performance.now() + REPAINT_MS;
    if (looping) return;
    const frame = () => performance.now() < repaintUntil && requestAnimationFrame(frame);
    requestAnimationFrame(frame);
  };
  // From the extension (pages cannot message a content script): the shortcuts, the floating chat's
  // state, and the chat moved here from the side panel.
  onGone(onRuntime(WIDGET_REPAINT, () => void repaint()));
  onGone(onRuntime(WIDGET_CHAT_STATE, (msg) => void chat.setState(msg.state, msg.movable, msg.sticky, msg.stickable)));
  onGone(onRuntime(WIDGET_TOGGLE, () => {
    if (s.host || chat.host()) void savePlace({ hidden: !s.place.hidden });
  }));
  // Off the page while it is captured (capture/run), answered once painted so.
  onGone(onRuntime(WIDGET_HIDE, (msg) => {
    s.capturing = msg.hidden;
    render();
    speak.follow();
    return new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }));
  // Once its actions are known (a widget just put into the page asks for them first).
  onGone(onRuntime(WIDGET_FLOAT, async (msg) => {
    await lifecycle.settled();
    if (!s.host && !chat.host()) return { floated: false }; // no widget on this page
    if (s.noFloating) return { floated: false }; // the chat cannot float here (Firefox): never framed
    if (msg.toggle) chat.toggle();
    else void chat.show(); // a conversation moved here comes to it as a handoff
    return { floated: true };
  }));
  void lifecycle.start();
}
