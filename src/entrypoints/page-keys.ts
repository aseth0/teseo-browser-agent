// The keys set in Settings → Shortcuts, heard in the web pages the extension may read (shortcuts/listen),
// registered there by the background (shortcuts/script). A copy already here, the same extension's or one
// cut off by its reload, leaves for this one.
import { listenKeysSetHere } from '../shortcuts/listen';

declare global {
  interface Window {
    __browserAgentKeys?: () => void;
  }
}

export default defineUnlistedScript(() => {
  window.__browserAgentKeys?.();
  window.__browserAgentKeys = listenKeysSetHere();
});
