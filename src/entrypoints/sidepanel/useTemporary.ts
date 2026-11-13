// Temporary conversations (the hourglass in the top bar): not saved in the history. While it is on,
// every conversation the panel starts is temporary. Turning it on or off starts a new conversation,
// so that none is saved by halves; one opened from the history (or moved back from the chat floating
// on a page) is saved already, so opening one turns it off.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Agent } from './useAgent';

export interface Temporary {
  on: boolean;
  toggle: () => void;
  off: () => void;
  isTemporary: (conversationId: string) => boolean;
}

export function useTemporary(agent: Agent): Temporary {
  const [on, setOn] = useState(false);
  // The conversations started while on: kept, so that one left while its turn runs is not saved either.
  // Marked before useHistory's effect of the same render (declared after it) looks.
  const ids = useRef(new Set<string>());
  useEffect(() => {
    if (on) ids.current.add(agent.conversationId);
  }, [on, agent.conversationId]);
  const toggle = () => {
    if (agent.history.length) agent.reset();
    // Off in a chat still empty: no new conversation, so the one it shows is saved again.
    else if (on) ids.current.delete(agent.conversationId);
    setOn(!on);
  };
  const off = useCallback(() => setOn(false), []);
  const isTemporary = useCallback((id: string) => ids.current.has(id), []);
  return { on, toggle, off, isTemporary };
}
