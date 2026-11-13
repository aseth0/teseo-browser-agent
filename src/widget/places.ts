// Where the widget sits on each site, and whether it is hidden there (widget/protocol WIDGET_PLACES):
// written by the widget itself, and by Settings → Bubble to show it again.
import { browser } from 'wxt/browser';
import { storageRecord } from '../storage/area';
import { sendRuntime } from '../core/runtime';
import { serialized } from '../storage/serial';
import { WIDGET_PLACE, WIDGET_PLACES, type WidgetPlace } from './protocol';
import { watchKey } from '../storage/watch';

export type WidgetPlaces = Record<string, WidgetPlace>;

// The site a place is kept for: the page's host (with its port, if any). The widget's own key, and the
// one the background checks a widget's change against (WIDGET_PLACE).
export function widgetSite(url: string | undefined): string {
  try {
    return url ? new URL(url).host : '';
  } catch {
    return '';
  }
}

export const loadPlaces = (): Promise<WidgetPlaces> => storageRecord<WidgetPlace>('local', WIDGET_PLACES);

// The places are one record for every site, written by the widgets of several tabs and by Settings →
// Bubble: each change reads it and writes it whole, one at a time (storage/serial). Only in the
// extension's own pages and worker, whose Web Locks are the extension's: a content script's are its
// page's, so the widget asks the background to make its change (WIDGET_PLACE).
const serial = serialized('widgetPlaces');
const inExtension = () => !!globalThis.location && browser.runtime.getURL('/').startsWith(`${location.origin}/`);

// In the background, for a widget (only for its own page's site); here, for Settings → Bubble (any site).
export const changePlace = (site: string, patch: WidgetPlace): Promise<WidgetPlace> =>
  serial(async () => {
    const places = await loadPlaces();
    const place = { ...places[site], ...patch };
    await browser.storage.local.set({ [WIDGET_PLACES]: { ...places, [site]: place } });
    return place;
  });

// Read at the time of writing, inside the lock, so a place another tab saved meanwhile is kept.
export async function updatePlace(site: string, patch: WidgetPlace): Promise<WidgetPlace> {
  if (inExtension()) return changePlace(site, patch);
  return (await sendRuntime({ type: WIDGET_PLACE, site, patch })) ?? { ...patch };
}

// Settings → Bubble: the floating chat back to its first place and size on every site.
export const forgetChatPlaces = (): Promise<void> =>
  serial(async () => {
    const places = Object.entries(await loadPlaces()).map(([site, { chat: _chat, ...rest }]) => [site, rest]);
    await browser.storage.local.set({ [WIDGET_PLACES]: Object.fromEntries(places) });
  });

export function onPlacesChanged(cb: (places: WidgetPlaces) => void): () => void {
  return watchKey('local', WIDGET_PLACES, (c) => cb((c.newValue as WidgetPlaces | undefined) ?? {}));
}
