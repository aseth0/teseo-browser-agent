import { useCallback, useEffect, useMemo, useRef } from 'react';
import { browser } from 'wxt/browser';
import { errorText } from '../../core/errors';
import { PORT_NAME, type PanelToBackground, type RunTagged } from '../../core/protocol';
import type { AgentAction } from './agent-state';
import { chatViewNow, watchChatView } from './chat-view';

// Below the service worker's 30 s idle timeout.
const KEEPALIVE_MS = 20_000;

export type AgentPort = ReturnType<typeof useAgentPort>;

// The chat's port to the background agent (sidepanel/useAgent): its events go to `dispatch`, and
// while a turn runs (`busy`) it keeps the service worker awake.
export function useAgentPort(dispatch: (action: AgentAction) => void, busy: boolean) {
  const portRef = useRef<ReturnType<typeof browser.runtime.connect> | null>(null);
  // Stopped: what the background had already sent of that turn is dropped when it arrives, until a run
  // of this chat starts, or the background brings one back (its 'resume', after opening a conversation).
  const stoppedRef = useRef(false);
  // The run of this chat events are taken from, by the number sent with it (RunTagged): those of an earlier
  // one (stopped and replaced at once, "Send now") are dropped. An event without a number (an older
  // worker) is taken, as is any while the run's number is not known (one resumed from an older worker).
  const runRef = useRef<number | undefined>(undefined);
  const lastRunRef = useRef(0);

  // The MV3 service worker can die (idle, reload): the port is opened on demand
  // and dropped when it disconnects, never reused while dead.
  const getPort = useCallback(() => {
    if (portRef.current) return portRef.current;
    const port = browser.runtime.connect({ name: PORT_NAME });
    port.onMessage.addListener(({ runId, ...event }: RunTagged) => {
      if (event.type === 'resume') {
        stoppedRef.current = false;
        runRef.current = runId;
        if (runId !== undefined) lastRunRef.current = Math.max(lastRunRef.current, runId);
      }
      const otherRun = runId !== undefined && runRef.current !== undefined && runId !== runRef.current;
      if (!stoppedRef.current && !otherRun) dispatch({ type: 'event', event });
    });
    port.onDisconnect.addListener(() => {
      if (portRef.current === port) portRef.current = null;
      dispatch({ type: 'lost' });
    });
    portRef.current = port;
    port.postMessage({ type: 'view', ...chatViewNow() } satisfies PanelToBackground); // first, before what opened it
    return port;
  }, [dispatch]);

  useEffect(
    () => () => {
      portRef.current?.disconnect();
      portRef.current = null;
    },
    [],
  );

  // Whether the message went: false with no port open, or a dead one (dropped).
  const post = useCallback((msg: PanelToBackground): boolean => {
    try {
      if (!portRef.current) return false;
      portRef.current.postMessage(msg);
      return true;
    } catch {
      portRef.current = null;
      return false;
    }
  }, []);

  // A run or an attach: the port opened when there is none (or a dead one, dropped). Why the message
  // could not go, if it could not.
  const connectAndPost = useCallback((msg: PanelToBackground): string | undefined => {
    try {
      getPort().postMessage(msg);
      return undefined;
    } catch (e) {
      portRef.current = null;
      return errorText(e);
    }
  }, [getPort]);

  // A stop of this chat (true), or a run of it starting (false): see stoppedRef.
  const setStopped = useCallback((on: boolean) => {
    stoppedRef.current = on;
  }, []);

  // A run of this chat starts: its number, to send with it.
  const newRun = useCallback(() => {
    runRef.current = ++lastRunRef.current;
    return runRef.current;
  }, []);

  // Whether it shows, as that changes, while its port is open (background/session-alerts).
  useEffect(() => watchChatView((v) => void post({ type: 'view', ...v })), [post]);

  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => post({ type: 'keepalive' }), KEEPALIVE_MS);
    return () => clearInterval(timer);
  }, [busy, post]);

  return useMemo(() => ({ post, connectAndPost, setStopped, newRun }), [post, connectAndPost, setStopped, newRun]);
}
