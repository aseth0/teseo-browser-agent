// When the panel saves its conversation (sidepanel/useHistory): when a turn ends, once it is
// compacted or a plan is taken away, and when another conversation replaces it while a turn runs (opened from 🕘, or a new one): then the one left is saved
// as stopped, under its own id, and the one opened is not touched. While a turn runs, also when it
// starts and each time a message is added (not as the answer streams): saved as stopped (`midTurn`),
// so that closing the panel mid-turn loses nothing done so far; the save when it ends replaces it.
import { markStopped } from '../core/messages';
import type { Message } from '../core/types';

export interface PanelConversation {
  id: string;
  history: Message[];
  live: { kind: 'reasoning' | 'text'; text: string }[]; // streaming when it was left
  busy: boolean;
}

export function conversationToSave(before: PanelConversation, now: PanelConversation): { id: string; history: Message[]; midTurn?: true } | undefined {
  if (before.id !== now.id) return before.busy && before.history.length ? { id: before.id, history: markStopped(before.history, before.live) } : undefined;
  if (before.busy && !now.busy && now.history.length) return { id: now.id, history: now.history };
  if (now.busy) return now.history.length && (!before.busy || now.history.length !== before.history.length) ? { id: now.id, history: markStopped(now.history, []), midTurn: true } : undefined;
  // Compacted between turns, or a plan taken away: kept at once.
  return compactions(now.history) > compactions(before.history) || plansDismissed(now.history) > plansDismissed(before.history) ? { id: now.id, history: now.history } : undefined;
}

const compactions = (history: Message[]) => history.filter((m) => m.compaction).length;
const plansDismissed = (history: Message[]) => history.flatMap((m) => m.parts).filter((p) => p.type === 'tool_call' && p.dismissed).length;
