import { browser } from 'wxt/browser';

const AWAKE_MS = 20_000; // an extension API call keeps the service worker alive meanwhile

// Keeps the service worker awake while on: its own timers are not slowed down like those of a hidden
// page (background/session).
export function keepAwake() {
  let awake: ReturnType<typeof setInterval> | undefined;
  return (on: boolean) => {
    if (on && !awake) awake = setInterval(() => void browser.runtime.getPlatformInfo(), AWAKE_MS);
    if (!on && awake) {
      clearInterval(awake);
      awake = undefined;
    }
  };
}
