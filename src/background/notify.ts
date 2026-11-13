import { browser } from 'wxt/browser';

// A notification from the extension, for what a shortcut could not do (it has no popup to say it in).
export function notify(title: string, message: string) {
  void browser.notifications.create({ type: 'basic', iconUrl: browser.runtime.getURL('/icon/128.png'), title, message }).catch((e: unknown) => console.error('[notify]', e));
}
