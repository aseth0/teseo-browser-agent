import { useCallback, useMemo, useState } from 'react';
import { isPanelNotice } from '../../../core/messages';
import type { Message } from '../../../core/types';
import { typedText } from '../../../ui/ChatMessages';
import type { Recall } from '../MentionComposer';

// What ↑ ↓ bring back in the message box, kept by the chat (sidepanel/Chat) for its conversation: your
// messages, and the one shown (`recalled`, marked in the conversation). The keys: useRecallKeys.
export function useRecallState(history: Message[], conversationId: string) {
  const prompts = useMemo(() => history.filter((m) => m.role === 'user' && !isPanelNotice(m) && typedText(m).trim()), [history]);
  const promptTexts = useMemo(() => prompts.map(typedText), [prompts]);
  // Kept with its conversation: another one opened starts with none (its prompts are others).
  const [recallFor, setRecallFor] = useState<{ id: string; recall: Recall }>();
  const recall = recallFor?.id === conversationId ? recallFor.recall : undefined;
  const setRecall = useCallback((r: Recall | undefined) => setRecallFor(r && { id: conversationId, recall: r }), [conversationId]);
  const recalled = recall && prompts[recall.index];
  return { promptTexts, recall, setRecall, recalled };
}
