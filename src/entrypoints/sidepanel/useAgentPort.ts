import { useCallback, useEffect, useMemo, useRef } from 'react';
import { browser } from 'wxt/browser';
import { errorText } from '../../core/errors';
import { PORT_NAME, type PanelToBackground, type RunTagged } from '../../core/protocol';
import type { AgentAction } from './agent-state';
import { chatViewNow, watchChatView } from './chat-view';

// Below the service worker's 30 s idle timeout.
const KEEPALIVE_MS = 20_000;
// A port the worker said nothing on for this long may be dead without saying so: where the browser
// hosts the side panel in a tab (Vivaldi), the worker stopped while the chat was idle and the port's
// onDisconnect never came, so a message posted on it went nowhere and the turn showed "…" for good.
// A run opens a new port then.
const STALE_MS = 25_000;
// A run the worker sent nothing of in this long (its first phase comes at once) is sent again, once,
// on a new port; then the turn ends, said.
const ACK_MS = 8_000;
export const NO_ANSWER = 'The agent did not answer. Send the message again.';

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
  // When the worker last sent anything on the port (or the port opened): see STALE_MS.
  const heardRef = useRef(0);
  // The run sent and not answered yet: see ACK_MS.
  const ackRef = useRef<{ runId: number; timer: ReturnType<typeof setTimeout> } | undefined>(undefined);
  const unwatch = useCallback(() => {
    clearTimeout(ackRef.current?.timer);
    ackRef.current = undefined;
  }, []);

  // The MV3 service worker can die (idle, reload): the port is opened on demand
  // and dropped when it disconnects, never reused while dead.
  const getPort = useCallback(() => {
    if (portRef.current) return portRef.current;
    const port = browser.runtime.connect({ name: PORT_NAME });
    port.onMessage.addListener(({ runId, ...event }: RunTagged) => {
      heardRef.current = Date.now();
      if (ackRef.current && (runId === undefined || runId === ackRef.current.runId)) unwatch();
      if (event.type === 'resume') {
        stoppedRef.current = false;
        runRef.current = runId;
        if (runId !== undefined) lastRunRef.current = Math.max(lastRunRef.current, runId);
      }
      const otherRun = runId !== undefined && runRef.current !== undefined && runId !== runRef.current;
      if (!stoppedRef.current && !otherRun) dispatch({ type: 'event', event });
    });
    port.onDisconnect.addListener(() => {
      // One this chat replaced (stale, or not answered) says nothing of the port in use.
      if (portRef.current && portRef.current !== port) return;
      portRef.current = null;
      dispatch({ type: 'lost' });
    });
    portRef.current = port;
    heardRef.current = Date.now();
    port.postMessage({ type: 'view', ...chatViewNow() } satisfies PanelToBackground); // first, before what opened it
    return port;
  }, [dispatch, unwatch]);

  // The port dropped from this side: the next message opens a new one.
  const dropPort = useCallback(() => {
    const old = portRef.current;
    portRef.current = null;
    try {
      old?.disconnect();
    } catch {
      // already gone
    }
  }, []);

  useEffect(
    () => () => {
      unwatch();
      portRef.current?.disconnect();
      portRef.current = null;
    },
    [unwatch],
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
    const send = () => {
      try {
        getPort().postMessage(msg);
        return undefined;
      } catch (e) {
        portRef.current = null;
        return errorText(e);
      }
    };
    if (msg.type !== 'run') return send();
    // A run: on a port the worker is known to be on, and watched until it answers.
    if (portRef.current && Date.now() - heardRef.current > STALE_MS) dropPort();
    const failed = send();
    if (failed || msg.runId === undefined) return failed;
    const runId = msg.runId;
    // `again`: not answered, it is sent once more on a new port; else the turn ends.
    const watch = (again: boolean) => {
      unwatch();
      const timer = setTimeout(() => {
        ackRef.current = undefined;
        if (runRef.current !== runId || stoppedRef.current) return;
        dropPort();
        if (!again) return dispatch({ type: 'finish', error: NO_ANSWER });
        const why = send();
        if (why) return dispatch({ type: 'finish', error: `Could not reach the agent: ${why}` });
        watch(false);
      }, ACK_MS);
      ackRef.current = { runId, timer };
    };
    watch(true);
    return undefined;
  }, [getPort, dropPort, unwatch, dispatch]);

  // A stop of this chat (true), or a run of it starting (false): see stoppedRef.
  const setStopped = useCallback((on: boolean) => {
    stoppedRef.current = on;
    if (on) unwatch();
  }, [unwatch]);

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
