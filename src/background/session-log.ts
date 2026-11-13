import type { BackgroundToPanel } from '../core/protocol';

// Appends to a run's log what it sent: a delta right after another of the same kind (also a
// sub-agent's, of the same call) joins it, so the log of a long run keeps one entry per streak, not
// one per token. The chat that takes it over appends the same text either way.
export function appendToLog(log: BackgroundToPanel[], m: BackgroundToPanel): void {
  const last = log.at(-1);
  const joined = last && joinedDelta(last, m);
  if (joined) log[log.length - 1] = joined;
  else log.push(m);
}

function joinedDelta(a: BackgroundToPanel, b: BackgroundToPanel): BackgroundToPanel | undefined {
  if ((a.type === 'text-delta' || a.type === 'reasoning-delta') && a.type === b.type) return { ...a, text: a.text + b.text };
  if (a.type === 'sub' && b.type === 'sub' && a.callId === b.callId && a.agent === b.agent) {
    const event = joinedDelta(a.event, b.event);
    return event && { ...a, event: event as typeof a.event };
  }
  return undefined;
}
