// The page bar's tab picker: the open tabs, grouped by window as browser.list_tabs with window "all"
// lists them, marked with the tab the chat works on and the one you are on, each with its icon.
import { browser, type Browser } from 'wxt/browser';
import { isRestrictedUrl } from '../../page/permissions';

export interface PickerTab {
  tabId: number;
  title: string;
  url?: string;
  restricted: boolean; // the browser's own pages and the extension's: chosen, the chat says "not accessible"
  workingOn: boolean;
  userOn: boolean;
}

export interface PickerWindow {
  windowId: number;
  label: string; // "Window 2", "Window 3 (app)" for an installed app (PWA)
  tabs: PickerTab[];
}

// `chat`: the tab the chat works on; `user`: the one you are on. `skip`: windows left out (the agent's
// own, minimized ones for a background tab).
export interface PickerMarks {
  chat?: number;
  user?: number;
  skip?: (windowId: number) => boolean;
}

const TYPE_NOTE: Partial<Record<string, string>> = { app: ' (app)', popup: ' (popup)' };

export function pickerWindows(windows: Browser.windows.Window[], { chat, user, skip }: PickerMarks): PickerWindow[] {
  return windows
    .filter((w) => w.id !== undefined && !skip?.(w.id) && w.tabs?.length)
    .map((w, i) => ({
      windowId: w.id!,
      label: `Window ${i + 1}${TYPE_NOTE[w.type ?? ''] ?? ''}`,
      tabs: w.tabs!.filter((t) => t.id !== undefined).map((t) => ({
        tabId: t.id!,
        title: t.title || t.url || 'Untitled',
        url: t.url,
        restricted: isRestrictedUrl(t.url),
        workingOn: t.id === chat,
        userOn: t.id === user,
      })),
    }));
}

// The icon the browser has for a tab's page (the "favicon" permission): its own cache, no request
// to the site, and the browser's default icon when it has none. Not one of the extension's files:
// WXT's typed getURL does not list it.
const urlOf = browser.runtime.getURL as (path: string) => string;
export const faviconOf = (pageUrl: string) => urlOf(`/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=16`);

export const openWindows = () => browser.windows.getAll({ populate: true, windowTypes: ['normal', 'app', 'popup'] });

// "Go to it": the tab in front of its window, like browser.switch_tab; the window itself is not focused.
export const showTab = (tabId: number) => browser.tabs.update(tabId, { active: true }).then(() => undefined);
