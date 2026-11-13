import { useEffect, useRef } from 'react';
import { browser } from 'wxt/browser';
import { bestEffort } from '../../core/errors';
import { handoffStep, type Handoff } from '../../core/handoff';
import { storageGet } from '../../storage/area';
import { watchKey } from '../../storage/watch';
import { FLOATING, FULL, MANAGER, PREVIEW, floatingTab } from '../../ui/floating-frame';
import { useStableCallback } from '../../ui/useStableCallback';
import { PANEL_TAB } from './usePageTarget';

// What is handed to this chat under `key` (core/handoff), taken once: when the chat opens, or while it
// is open. Only the side panel and the floating chat take them: never the agent manager, whose chats,
// each opened on a tab as a tab's side panel is, would take that panel's; nor the chat full-screen in a
// tab, nor Settings → Appearance's preview of the panel, which would take the window's panel's.
// `idle`: given, one waits in storage while it is false (a turn runs, the earlier turns are compacted);
// `hold`: this chat cannot take one now (it reviews a recording it must not lose): the next waits in
// storage until that ends.
export function useHandoff<P>(key: string, isPayload: (p: unknown) => p is P, how: { waitMs: number; idle?: boolean; hold?: boolean; tag: string }, take: (h: Handoff<P>) => void) {
  const latest = useStableCallback(take);
  const taken = useRef(0); // the last one's time: the mount's read and a change may both see it
  const idleNow = useRef(how.idle); // read after the awaits below: whether it is idle by then
  useEffect(() => {
    idleNow.current = how.idle;
  });
  const { waitMs, idle, hold, tag } = how;
  useEffect(() => {
    if (MANAGER || FULL || PREVIEW || hold) return;
    const check = async () => {
      const h = await storageGet<unknown>('session', key);
      const tab = FLOATING ? (await floatingTab())?.id : undefined;
      const next = handoffStep(h, isPayload, { tab, panelTab: PANEL_TAB, taken: taken.current, now: Date.now(), waitMs, idle: idleNow.current });
      if (next.step === 'none' || next.step === 'wait') return;
      if (next.step === 'take') taken.current = next.handoff.at;
      await browser.storage.session.remove(key);
      if (next.step === 'take') latest(next.handoff);
    };
    void bestEffort(check(), tag);
    return watchKey('session', key, () => void bestEffort(check(), tag));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `isPayload` is a module's function; `idle` changing is what re-checks one left waiting
  }, [latest, key, waitMs, idle, hold, tag]);
}
