// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { Agent } from '../src/entrypoints/sidepanel/useAgent';

// The hourglass: the conversations started while it is on are not saved; turned off in a chat still
// empty, that chat's conversation is saved again.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { useTemporary } = await import('../src/entrypoints/sidepanel/useTemporary');

type Temporary = ReturnType<typeof useTemporary>;
async function mount(agent: Pick<Agent, 'conversationId' | 'history' | 'reset'>) {
  const got: { current?: Temporary } = {};
  const Probe = () => ((got.current = useTemporary(agent as Agent)), null);
  await act(async () => createRoot(document.createElement('div')).render(createElement(Probe)));
  return got as { current: Temporary };
}

describe('Temporary', () => {
  it('on and off again in an empty chat leaves its conversation saved', async () => {
    const reset = vi.fn();
    const t = await mount({ conversationId: 'c1', history: [], reset });
    await act(async () => t.current.toggle());
    expect(t.current.isTemporary('c1')).toBe(true);
    await act(async () => t.current.toggle());
    expect(t.current.on).toBe(false);
    expect(t.current.isTemporary('c1')).toBe(false);
    expect(reset).not.toHaveBeenCalled();
  });
});
