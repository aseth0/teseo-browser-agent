// Who sent a runtime message or opened a port.
import { browser } from 'wxt/browser';

// One of the extension's own pages (the side panel, Options, the chat floating in a page's frame),
// never a page's content script.
export const isExtensionPage = (sender: Browser.runtime.MessageSender | undefined) => sender?.url?.startsWith(browser.runtime.getURL('/')) ?? false;
// Who a message from a page comes from: the extension's own pages, or a page's top frame (a content
// script, the page widget's or one injected).
export const senderOf = (sender: Browser.runtime.MessageSender) => {
  const fromExtension = isExtensionPage(sender);
  return { fromExtension, fromPage: !fromExtension && sender.tab?.id !== undefined && sender.frameId === 0 };
};
