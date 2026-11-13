// The panel's conversation in the history (history/store): saved after every turn (also when
// stopped or regenerated), and as it goes while one runs (history/when-to-save). Opening the panel
// starts a new one, unless Settings → History says to go on with the last one touched lately. Deleted from the history, it is never saved again, and the panel
// starts a new one in its place. Returns why the last save failed (none once one works).
import { useEffect, useRef } from 'react';
import { bestEffort } from '../../core/errors';
import { heldConversations } from '../../history/held';
import { listConversations, loadConversation, onConversationsDeleted, saveConversation, type Conversation } from '../../history/store';
import { conversationToSave, type PanelConversation } from '../../history/when-to-save';
import { hostOf } from '../../core/util';
import type { Settings } from '../../storage/settings';
import { historyOn } from '../../storage/settings-select';
import { openWithAgent, type Agent } from './useAgent';
import type { PageTarget } from './usePageTarget';
import { agentLabel } from '../../agents/profiles';
import { FLOATING, FULL, MANAGER } from '../../ui/floating-frame';
import { useChatTarget } from './manager-chat';
import type { SettingsUpdate } from '../../ui/useSettings';
import { useAttempt } from '../../ui/useAttempt';
import { useStableCallback } from '../../ui/useStableCallback';

const RESUME_WITHIN_MS = 30 * 60_000;

// What a save refused carried (history/store `checked`): the turn it was to keep.
export type StaleSave = Parameters<typeof saveConversation>[0];
// `checks`, floating on a page: the conversations saved only over what this chat last loaded or saved
// (the pinned one, shown by several chats: history/store `checked`), and what to do with a save refused
// as another chat saved it since.
export function useHistory(agent: Agent, settings: Settings, page: PageTarget, onChange: SettingsUpdate, isTemporary: (id: string) => boolean,
  checks?: { checked: (id: string) => boolean; onStale: (conv: StaleSave) => void }): string {
  const enabled = historyOn(settings);
  const { profile, provider, model, talkedTo } = useChatTarget(settings);
  const { failed, attempt } = useAttempt();

  // Saved when a turn ends, as it goes while one runs, or when another conversation replaces it while
  // a turn runs.
  const shown = useRef<PanelConversation>({ id: agent.conversationId, history: agent.history, live: agent.live.get().segments, busy: agent.busy });
  // What streams in the conversation shown, as it goes (it does not render the panel): saved with it
  // when another replaces it mid-turn. Emptied (stopped just before, or in the history now) it stays
  // until the next render, which takes the history; the next conversation's never takes its place.
  const streamed = useRef(shown.current.live);
  useEffect(
    () => agent.live.subscribe(() => {
      const now = agent.live.get();
      if (now.conversationId === shown.current.id && now.segments.length) streamed.current = now.segments;
    }),
    [agent.live],
  );
  // The conversations deleted from the history while the panel is open: neither a turn that ends after
  // nor the one still shown saves them back. The one shown gives way to a new one (as "New").
  const deleted = useRef(new Set<string>());
  const onDeleted = useStableCallback((ids: string[]) => {
    for (const id of ids) deleted.current.add(id);
    if (!ids.includes(agent.conversationId)) return;
    if (agent.busy) agent.stop();
    agent.reset();
  });
  useEffect(() => onConversationsDeleted(onDeleted), [onDeleted]);
  useEffect(() => {
    const was = shown.current;
    if (was.id === agent.conversationId && was.history === agent.history && was.busy === agent.busy) return; // nothing of it changed
    const before = { ...was, live: streamed.current };
    shown.current = { id: agent.conversationId, history: agent.history, live: agent.live.get().segments, busy: agent.busy };
    streamed.current = shown.current.live;
    const conv = enabled && conversationToSave(before, shown.current);
    if (!conv || isTemporary(conv.id) || deleted.current.has(conv.id)) return;
    const now = Date.now();
    const lastAgent = profile && { agentId: profile.id, agent: agentLabel(profile) };
    const origin = MANAGER ? { origin: 'manager' as const } : {}; // kept only by its first save
    const { midTurn, ...saved } = conv;
    // The retention once per turn, when it ends: none meanwhile.
    const toSave = { ...saved, createdAt: now, updatedAt: now, site: hostOf(page.url) || undefined, model, providerId: provider?.id, ...lastAgent, ...origin, talkedTo };
    attempt(saveConversation(toSave, midTurn ? {} : settings.history, { checked: !!checks?.checked(saved.id) }).then((done) => void (done || checks?.onStale(toSave))));
  });

  // Once, on opening the panel (floating on a page, it goes on with its tab's: useFloatingConversation;
  // in the agent manager, never: each of its chats would open the same one; full-screen in a tab,
  // never: the side panel opens it). Nor one another chat has open (history/held).
  // Opened once loaded: with the conversation and settings of then, not of the first render.
  const goOn = useStableCallback((conv: Conversation) => {
    if (!agent.history.length) openWithAgent(agent, conv, settings, onChange);
  });
  useEffect(() => {
    if (FLOATING || MANAGER || FULL || !enabled || (settings.history?.resume ?? 'never') === 'never') return;
    void bestEffort(listConversations().then(async ([latest]) => {
      if (!latest || Date.now() - latest.updatedAt > RESUME_WITHIN_MS || (await heldConversations()).has(latest.id)) return;
      const conv = await loadConversation(latest.id);
      if (conv) goOn(conv);
    }), 'history-resume');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on opening the panel
  }, []);
  return failed;
}
