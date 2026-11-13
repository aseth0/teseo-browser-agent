import { useEffect, useState } from 'react';
import { autoInjectGlobal, type AutoInjectKind } from '../../context/auto-inject';
import { onMeaningOff, setMeaningOff } from '../../context/meaning-off';
import type { Settings } from '../../storage/settings';

const NOTHING_SKIPPED: AutoInjectKind[] = [];
const MEANING: AutoInjectKind = 'memoryMeaning';

// What is left out of this conversation from the auto-inject menu (sidepanel/Chat); a new
// conversation starts with nothing left out. Matching by meaning is kept (context/meaning-off); the rest
// lasts while the panel does.
export function useAutoInjectSkip(settings: Settings, conversationId: string) {
  const [skipFor, setSkipFor] = useState<{ id: string; kinds: AutoInjectKind[] }>();
  const [meaningOff, setMeaningOffIds] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => onMeaningOff(setMeaningOffIds), []);
  const kinds = skipFor?.id === conversationId ? skipFor.kinds : NOTHING_SKIPPED;
  const skip = meaningOff.has(conversationId) ? [...kinds, MEANING] : kinds;
  // Why a kind does not go now: off in Settings, or in this conversation.
  const offWhy = (kind: AutoInjectKind) =>
    !autoInjectGlobal(settings, kind) ? 'off in Settings → Auto-inject' : skip.includes(kind) ? 'left out of this conversation (the ✨ menu)' : undefined;
  const setSkip = (next: AutoInjectKind[]) => {
    setSkipFor({ id: conversationId, kinds: next.filter((k) => k !== MEANING) });
    if (next.includes(MEANING) !== skip.includes(MEANING)) void setMeaningOff(conversationId, next.includes(MEANING));
  };
  return { skip, setSkip, offWhy };
}
