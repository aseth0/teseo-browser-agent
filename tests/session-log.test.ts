import { describe, expect, it, vi } from 'vitest';
import type { BackgroundToPanel } from '../src/core/protocol';

// A run's log keeps one entry per streak of deltas, not one per token.
vi.mock('wxt/browser', () => ({ browser: {} }));
vi.mock('../src/background/agent-run', () => ({ runAgent: async () => undefined }));
vi.mock('../src/watches/tab-holds', () => ({ tabHolds: { holdForRun: async () => async () => undefined } }));
const { appendToLog } = await import('../src/background/session-log');

describe('the session log', () => {
  it('joins consecutive deltas of the same kind, also a sub-agent call’s', () => {
    const log: BackgroundToPanel[] = [];
    const sent: BackgroundToPanel[] = [
      { type: 'reasoning-delta', text: 'Th' },
      { type: 'reasoning-delta', text: 'ink' },
      { type: 'text-delta', text: 'He' },
      { type: 'text-delta', text: 'llo' },
      { type: 'status', text: 'Reading' },
      { type: 'text-delta', text: '!' },
      { type: 'sub', callId: 'c1', agent: 'Helper', event: { type: 'text-delta', text: 'a' } },
      { type: 'sub', callId: 'c1', agent: 'Helper', event: { type: 'text-delta', text: 'b' } },
      { type: 'sub', callId: 'c2', agent: 'Helper', event: { type: 'text-delta', text: 'c' } },
    ];
    for (const m of sent) appendToLog(log, m);
    expect(log).toEqual([
      { type: 'reasoning-delta', text: 'Think' },
      { type: 'text-delta', text: 'Hello' },
      { type: 'status', text: 'Reading' },
      { type: 'text-delta', text: '!' },
      { type: 'sub', callId: 'c1', agent: 'Helper', event: { type: 'text-delta', text: 'ab' } },
      { type: 'sub', callId: 'c2', agent: 'Helper', event: { type: 'text-delta', text: 'c' } },
    ]);
    expect(sent[0]).toEqual({ type: 'reasoning-delta', text: 'Th' }); // what was sent stays as it was
  });
});
