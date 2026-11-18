// The page widget over the page's life: its actions asked again when they change or the page moves
// to another URL (SPAs), while it is shown on the site (started); stopped, nothing of it runs or asks
// (hidden with its ✕, or the extension reloaded or updated under the page).
import { browser } from 'wxt/browser';
import { bestEffort } from '../../core/errors';
import { sendRuntime } from '../../core/runtime';
import { WIDGET_SETTINGS_KEY } from '../../storage/keys';
import { onStorageChanged } from '../../storage/watch';
import { ACTIONS_KEY, WIDGET_ACTIONS } from '../protocol';
import type { createBubble } from './bubble';
import type { createCard } from './card';
import type { FloatingChat } from './floating-chat';
import type { createLoads } from './loads';
import type { WidgetHost, WidgetState } from './state';
import type { createSpeakSelection } from './speak-selection';
import type { createTheme } from './theme';

const URL_WATCH_MS = 1000; // how often a page that changes its URL in place is checked

// After the extension is reloaded or updated, this copy of the script is cut off from it: its
// calls throw "Extension context invalidated". It then takes its widget away and stops; the copy
// the new extension puts in the page takes over.
export const cutOff = () => {
  try {
    return !browser.runtime?.id;
  } catch {
    return true;
  }
};

interface LifecycleParts {
  bubble: ReturnType<typeof createBubble>;
  card: ReturnType<typeof createCard>;
  chat: FloatingChat;
  loads: ReturnType<typeof createLoads>;
  theme: ReturnType<typeof createTheme>;
  speak: ReturnType<typeof createSpeakSelection>; // the toolbar beside a selection, with the bubble
  retire: () => void; // cut off from the extension: everything of this copy goes
}

export function createLifecycle(s: WidgetState, { render }: Pick<WidgetHost, 'render'>, { bubble, card, chat, loads, theme, speak, retire }: LifecycleParts) {
  let started = false;
  // The actions of this page, asked again when they change or the page moves to another URL (SPAs).
  // One at a time: two at once would both find no widget and build one each.
  let refreshing = Promise.resolve(false);
  // The toolbar beside a selection follows the actions marked for it.
  const refresh = () => (refreshing = refreshing.then(guarded).then((changed) => (changed && speak.follow(), changed)));
  // Whether the actions changed (then they ran their loads already).
  const guarded = async (): Promise<boolean> => {
    if (!started) return false;
    if (cutOff()) return (retire(), false);
    try {
      return await update();
    } catch (e) {
      if (cutOff()) retire();
      else console.error('[widget]', e);
      return false;
    }
  };
  const update = async () => {
    const reply = await bestEffort(sendRuntime({ type: WIDGET_ACTIONS }), 'widget');
    if (!started) return false; // stopped meanwhile: it builds nothing
    const next = reply?.actions ?? [];
    const shown = next.length > 0 || !!reply?.always; // the bubble alone opens the chat
    if (JSON.stringify(next) === JSON.stringify(s.actions) && !!s.host === shown) return false;
    s.actions = next;
    if (!shown) {
      s.host?.remove();
      s.host = undefined;
      chat.close(false);
      return true;
    }
    if (!s.host) {
      bubble.build();
      if (reply?.floating && !s.noFloating) void chat.show(); // open in this tab before the page reloaded
    }
    bubble.fillMenu();
    if (!s.pop.hidden && !s.actions.some((a) => a.id === s.menu.querySelector<HTMLElement>('.act.on')?.dataset.action)) card.close();
    render();
    loads.run();
    return true;
  };

  let url = location.href;
  let watch: ReturnType<typeof setInterval> | undefined;
  let offStorage: (() => void) | undefined;
  const onStorage = (changes: Record<string, unknown>, area: string) => {
    if (area === 'local' && (ACTIONS_KEY in changes || WIDGET_SETTINGS_KEY in changes)) void refresh();
    if (area === 'local' && WIDGET_SETTINGS_KEY in changes) void theme.load().then(() => (speak.follow(), bubble.followSettings()));
  };
  // Shown on the site: its actions asked, built, and their loads run, as on a page just loaded.
  const start = () => {
    if (started) return refreshing;
    started = true;
    url = location.href;
    watch = setInterval(() => {
      if (cutOff()) return retire();
      if (location.href === url) return;
      url = location.href;
      void refresh().then((changed) => !changed && loads.run()); // the same actions, another ticket or repository
    }, URL_WATCH_MS);
    offStorage = onStorageChanged(onStorage);
    speak.start();
    return refresh();
  };
  // Nothing of it runs any more: no watch, no listener, no request; what is loading is dropped (its run
  // in the background stopped), the card's run too; the bubble taken away. Started again, it starts afresh.
  const stop = () => {
    if (!started) return;
    started = false;
    clearInterval(watch);
    watch = undefined;
    offStorage?.();
    offStorage = undefined;
    speak.stop();
    loads.drop();
    s.running?.abort();
    bubble.dispose();
    s.host?.remove();
    s.host = undefined;
    s.actions = [];
    s.loaded.clear();
  };

  return { start, stop, refresh, started: () => started, settled: () => refreshing };
}
