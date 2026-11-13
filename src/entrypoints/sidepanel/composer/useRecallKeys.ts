import type { KeyboardEvent, RefObject } from 'react';
import type { Recall } from '../MentionComposer';

// ↑ on the box's first line brings back your previous messages (`prompts`, oldest first); ↓ on its last
// goes forward, back to what you were writing (`recall.draft`). `caretTo`: where the box puts the caret
// once the new text is in it. What they bring back is kept by the chat (useRecallState).
export function useRecallKeys({ prompts, recall, onRecall, onChange, caretTo }: {
  prompts: string[];
  recall?: Recall;
  onRecall?: (recall: Recall | undefined) => void;
  onChange: (v: string) => void;
  caretTo: RefObject<number | undefined>;
}) {
  const recallTo = (index: number | undefined, draft: string) => {
    onRecall?.(index === undefined ? undefined : { index, draft });
    const text = index === undefined ? draft : prompts[index]!;
    onChange(text);
    const at = index === undefined ? text.length : 0; // at the start, so ↑ goes on
    caretTo.current = at;
  };
  const leaveRecall = () => {
    if (recall) onRecall?.(undefined);
  };
  const onRecallKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const plain = !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey && el.selectionStart === el.selectionEnd;
    if (plain && e.key === 'ArrowUp' && prompts.length && !el.value.slice(0, el.selectionStart).includes('\n')) {
      const index = recall ? recall.index - 1 : prompts.length - 1;
      if (index < 0) return;
      e.preventDefault();
      recallTo(index, recall?.draft ?? el.value);
    }
    if (plain && e.key === 'ArrowDown' && recall && !el.value.slice(el.selectionEnd).includes('\n')) {
      e.preventDefault();
      recallTo(recall.index + 1 < prompts.length ? recall.index + 1 : undefined, recall.draft);
    }
  };
  return { leaveRecall, onRecallKey };
}
