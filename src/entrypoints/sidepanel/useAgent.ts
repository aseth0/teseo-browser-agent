// Conversation state and transport to the background agent (chrome.runtime Port). The state and how
// each event changes it: agent-state; kept in agent-store, so the streamed text (`live`) is read only
// where it is shown.
import { useMemo, useState, useSyncExternalStore } from 'react';
import type { Message } from '../../core/types';
import type { Settings } from '../../storage/settings';
import type { SettingsUpdate } from '../../ui/useSettings';
import { agentActions } from './agent-actions';
import { initialAgentState, type SessionUsage } from './agent-state';
import { createAgentStore, noLive, type LiveSource } from './agent-store';
import { useAgentPort } from './useAgentPort';

export type { Confirmation, SessionUsage } from './agent-state';

export function useAgent() {
  const [store] = useState(() => createAgentStore(initialAgentState(crypto.randomUUID())));
  const state = useSyncExternalStore(store.subscribe, store.shown);
  const dispatch = store.dispatch;
  const live = useMemo<LiveSource>(() => ({ subscribe: store.subscribe, get: store.live }), [store]);
  const { busy } = state;
  const port = useAgentPort(dispatch, busy);

  // The same functions for the hook's life: they read the store's state when called, so one called
  // right after a dispatch sees it.
  const actions = useMemo(() => agentActions(store, port), [store, port]);

  // A new object only when the state changes.
  return useMemo(() => {
    const { conversationId, history, subs, busy, compacting, status, error, notices, stepLimit, confirmations, usage, phases } = state;
    return { conversationId, history, live, subs, busy, compacting, status, error, notices, stepLimit, confirmations, usage, phases, ...actions };
  }, [state, live, actions]);
}

export type Agent = ReturnType<typeof useAgent>;

// A conversation to go on with (saved, or handed over), with the agent it was with (none: Browser).
export function openWithAgent(agent: Agent, conv: { id: string; history: Message[]; agentId?: string }, settings: Pick<Settings, 'activeAgentId'>, update: SettingsUpdate) {
  agent.open(conv.id, conv.history);
  if (conv.agentId !== settings.activeAgentId) update({ activeAgentId: conv.agentId });
}

// The conversation of the preview (previewAgent): nothing it shows is sent.
export const PREVIEW_ID = 'preview';

// A finished conversation that is only shown (Settings → Appearance's preview): nothing runs.
export function previewAgent(history: Message[], usage: SessionUsage): Agent {
  const nothing = () => {};
  const unsent = () => false;
  return {
    conversationId: PREVIEW_ID, history, live: noLive(PREVIEW_ID), subs: {}, busy: false, compacting: false, status: '', error: '', notices: [], stepLimit: null, confirmations: [], usage, phases: [],
    send: unsent, resume: unsent, regenerate: unsent, stop: nothing, respond: nothing, respondAccess: nothing, respondUser: nothing, respondMore: nothing, reset: nothing, open: nothing, compact: () => history, setCompacting: nothing, dismissPlan: nothing,
  };
}
