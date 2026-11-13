// The conversation's state (agent-state) kept outside React, so that what streams in does not
// re-render the whole chat: the chat renders everything but `live`, which changes on every token,
// and only the streaming text reads it (useLive).
import { useSyncExternalStore } from 'react';
import type { LiveSegment } from '../../core/live';
import { agentReducer, type AgentAction, type AgentState } from './agent-state';

// What streams right now, and in which conversation (useHistory keeps it when another replaces it).
interface LiveSnapshot {
  conversationId: string;
  segments: LiveSegment[];
}

export interface LiveSource {
  subscribe(onChange: () => void): () => void;
  get(): LiveSnapshot;
}

export function createAgentStore(initial: AgentState) {
  let state = initial;
  let shown = initial; // the state as of its last change other than to `live` (its `live` is stale)
  let live: LiveSnapshot = { conversationId: initial.conversationId, segments: initial.live };
  const listeners = new Set<() => void>();
  return {
    dispatch(action: AgentAction) {
      const next = agentReducer(state, action);
      if (next === state) return;
      state = next;
      if (!sameButLive(shown, next)) shown = next;
      if (next.live !== live.segments || next.conversationId !== live.conversationId) live = { conversationId: next.conversationId, segments: next.live };
      for (const notify of [...listeners]) notify();
    },
    subscribe(onChange: () => void) {
      listeners.add(onChange);
      return () => void listeners.delete(onChange);
    },
    // For useSyncExternalStore: the same object while nothing but `live` changed.
    shown: () => shown,
    live: () => live,
  };
}

const sameButLive = (a: AgentState, b: AgentState) => (Object.keys(b) as (keyof AgentState)[]).every((k) => k === 'live' || a[k] === b[k]);

// Nothing streams, ever (a conversation that is only shown).
export function noLive(conversationId: string): LiveSource {
  const snapshot: LiveSnapshot = { conversationId, segments: [] };
  return { subscribe: () => () => undefined, get: () => snapshot };
}

export const useLive = (source: LiveSource): LiveSegment[] => useSyncExternalStore(source.subscribe, source.get).segments;
