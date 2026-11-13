// The keys set in Settings → Shortcuts (shortcuts/keys), heard where they are pressed: in a page
// (entrypoints/page-keys) or in one of the extension's own pages. A key the user pressed runs its
// command (PAGE_KEY to the background, at once: the side panel opens only within the key press) and
// the page never gets it. Heard first, before the page's own listeners, but not while Settings records
// one (data-key-recorder).
import { browser } from 'wxt/browser';
import { PAGE_KEY } from '../core/protocol';
import { sendRuntime } from '../core/runtime';
import { commandFor, type PageKeys } from './keys';
import { loadPageKeys, onPageKeysChanged } from './store';

export function listenKeysSetHere(): () => void {
  let keys: PageKeys = {};
  void loadPageKeys().then((got) => (keys = got), () => undefined);
  const unwatch = onPageKeysChanged((got) => (keys = got));

  const onKey = (e: KeyboardEvent) => {
    // Cut off from the extension (reloaded under the page): the key is left to the new copy, and this one leaves.
    if (!browser.runtime.id) return stop();
    if (!e.isTrusted || e.repeat || e.isComposing) return;
    if (e.target instanceof Element && e.target.closest('[data-key-recorder]')) return;
    const command = commandFor(keys, e);
    if (!command) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    void sendRuntime({ type: PAGE_KEY, command }).catch(() => undefined); // not answered: nothing to wait for
  };
  addEventListener('keydown', onKey, true);
  const stop = () => {
    removeEventListener('keydown', onKey, true);
    try {
      unwatch();
    } catch {
      // cut off from the extension: nothing left to hear
    }
  };
  return stop;
}
