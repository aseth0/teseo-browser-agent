// The conversations open in a chat now (history/held), as a list that opens them shows them: read
// again every moment while shown, since no event says a chat took or let go of one.
import { useEffect, useState } from 'react';
import { heldConversations, holdConversation, type Holder } from '../history/held';

const AGAIN_MS = 1000;

export function useHeldConversations(): ReadonlyMap<string, Holder> {
  const [held, setHeld] = useState<ReadonlyMap<string, Holder>>(new Map());
  useEffect(() => {
    let current = true;
    const read = () =>
      void heldConversations().then(
        (h) => current && setHeld((was) => (sameHeld(was, h) ? was : h)),
        () => undefined,
      );
    read();
    const t = setInterval(read, AGAIN_MS);
    return () => {
      current = false;
      clearInterval(t);
    };
  }, []);
  return held;
}

const sameHeld = (a: ReadonlyMap<string, Holder>, b: ReadonlyMap<string, Holder>) => a.size === b.size && [...a].every(([id, h]) => b.get(id) === h);

// The chat holds the conversation it shows, while it shows it.
export function useHoldConversation(holder: Holder, conversationId: string): void {
  useEffect(() => holdConversation(holder, conversationId), [holder, conversationId]);
}
