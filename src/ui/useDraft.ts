// A field's text while it is typed, before it is kept: it starts from the saved value, and follows
// the saved value when that changes from elsewhere (a theme imported, another tab), unless edited.
import { useState } from 'react';

export function useDraft(saved: string): [string, (text: string) => void] {
  const [draft, setDraft] = useState(saved);
  const [from, setFrom] = useState(saved); // the saved value the draft was last brought up to
  if (from !== saved) {
    setFrom(saved);
    if (draft === from) setDraft(saved);
  }
  return [draft, setDraft];
}
