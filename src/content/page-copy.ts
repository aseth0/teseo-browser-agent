// The copy of the page script running in a tab, marked on the page's window. The isolated world is
// the same for every copy of one extension, even across its reloads: a copy left behind by a reload
// keeps the mark but no longer hears the extension, so the new copy takes over from it.
import { browser } from 'wxt/browser';

export interface PageCopy {
  alive: () => boolean; // false once its extension was reloaded or removed
  retire: () => void; // stops what it still runs in the page
}

// Whether this copy's extension can still be reached (its calls throw "Extension context invalidated"
// once it was reloaded or removed).
export const contextAlive = (): boolean => {
  try {
    return !!browser.runtime?.id;
  } catch {
    return false;
  }
};

// Whether a new copy should start: none is here, or the one here was cut off (it retires first).
// `true` is an older build's mark: a copy of a build no longer running, which cannot be reached.
export function takeOver(prior: PageCopy | boolean | undefined): boolean {
  if (typeof prior !== 'object') return true;
  if (prior.alive()) return false; // the same extension's, injected again: it already listens
  prior.retire();
  return true;
}
