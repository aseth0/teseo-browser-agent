// The extension given or denied a permission (a site, bookmarks), from this page or another: the
// pages that show what it may reach look again.
import { browser } from 'wxt/browser';

export function onPermissionsChanged(cb: () => void): () => void {
  browser.permissions.onAdded.addListener(cb);
  browser.permissions.onRemoved.addListener(cb);
  return () => {
    browser.permissions.onAdded.removeListener(cb);
    browser.permissions.onRemoved.removeListener(cb);
  };
}
