// The saved conversations' index, kept up to date (for the panel's # suggestions and lists).
import { useEffect, useState } from 'react';
import { listConversations, onConversationsChanged, type ConversationMeta } from '../history/store';

// A number that changes whenever a conversation is saved, renamed or deleted (here or elsewhere).
export function useConversationsVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => onConversationsChanged(() => setVersion((v) => v + 1)), []);
  return version;
}

export function useConversations(): ConversationMeta[] {
  const [list, setList] = useState<ConversationMeta[]>([]);
  const version = useConversationsVersion();
  useEffect(() => {
    let current = true; // a slower, older read must not replace a newer one
    listConversations().then(
      (l) => current && setList(l),
      (e) => console.error('[history]', e),
    );
    return () => {
      current = false;
    };
  }, [version]);
  return list;
}
