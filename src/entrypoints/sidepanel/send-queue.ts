// Your messages written while the agent works: up to MAX_QUEUED wait, text only, and go in order,
// one each time a turn ends as it should. Stopped, failed or at its step limit, they go back to the
// message box instead: nothing goes unseen. Kept in the panel only: another conversation drops them.
export const MAX_QUEUED = 3;

export interface QueuedText {
  id: number; // which one, while it waits
  text: string;
}

export const queueFull = (queue: readonly QueuedText[]) => queue.length >= MAX_QUEUED;

// The queue with `text` at its end, or as it was when full or with nothing to send.
export function enqueue(queue: QueuedText[], text: string, id: number): QueuedText[] {
  const t = text.trim();
  return !t || queueFull(queue) ? queue : [...queue, { id, text: t }];
}

// The message box with the queued ones back in it, after what it has: a blank line between each.
export const backToBox = (input: string, queue: readonly QueuedText[]) =>
  [input.trim(), ...queue.map((q) => q.text)].filter(Boolean).join('\n\n');

// What a turn's end does with the queue: the next one goes after a turn that ended as it should.
export const afterTurn = (end: { error: string; stepLimit: number | null }): 'next' | 'back' =>
  end.error || end.stepLimit !== null ? 'back' : 'next';
