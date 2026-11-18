// The last focused normal window: not an app's (PWA) or a popup. Chrome is asked for that type; Firefox
// ignores getLastFocused's windowTypes and logs an error for every call that has it, so there it is asked
// without, and a window of another type gives way to a normal one (the focused, else the last listed:
// getAll does take windowTypes there). None: no normal window, or the browser has no last focused one.
import { browser, type Browser } from 'wxt/browser';
import { firefoxBuild } from '../core/build';

export async function lastFocusedNormalWindow(info: { populate?: boolean } = {}): Promise<Browser.windows.Window | undefined> {
  if (!firefoxBuild()) return browser.windows.getLastFocused({ ...info, windowTypes: ['normal'] }).catch(() => undefined);
  const last = await browser.windows.getLastFocused(info).catch(() => undefined);
  if (!last || last.type === 'normal') return last;
  const normal = await browser.windows.getAll({ ...info, windowTypes: ['normal'] }).catch(() => []);
  return normal.find((w) => w.focused) ?? normal.at(-1);
}
