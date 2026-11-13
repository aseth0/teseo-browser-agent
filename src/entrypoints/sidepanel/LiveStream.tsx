// What the model is streaming, read from the live source (agent-store) here only: the rest of the
// chat does not re-render on every token.
import { useEffect, type ReactNode } from 'react';
import { AssistantText, Reasoning } from '../../ui/ChatMessages';
import type { TextFormat } from '../../storage/settings-types';
import { useLive, type LiveSource } from './agent-store';

// `onShown`: after new text is shown (to follow it down).
export function LiveStream({ live, format, onShown }: { live: LiveSource; format: TextFormat; onShown: () => void }) {
  const segments = useLive(live);
  useEffect(() => {
    if (segments.length) onShown();
  }, [segments, onShown]);
  return segments.map((s, i) =>
    s.kind === 'reasoning' ? <Reasoning key={i} text={s.text} active={i === segments.length - 1} /> : <AssistantText key={i} text={s.text} format={format} />,
  );
}

// `children` while nothing streams (what the agent is doing meanwhile).
export function UntilStreaming({ live, children }: { live: LiveSource; children: ReactNode }) {
  return useLive(live).length ? null : children;
}
