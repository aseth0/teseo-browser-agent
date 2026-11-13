// The one-off messages (core/runtime): a handler gets only its type, answers at once or once its
// promise settles, and can be removed.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (msg: unknown, sender: unknown, sendResponse: (r: unknown) => void) => unknown;
const listeners = new Set<Listener>();
vi.mock('wxt/browser', () => ({
  browser: { runtime: { onMessage: { addListener: (l: Listener) => listeners.add(l), removeListener: (l: Listener) => listeners.delete(l) } } },
}));

const { onRuntime } = await import('../src/core/runtime');
const { WIDGET_CHAT_STATE, WIDGET_FLOAT } = await import('../src/widget/protocol');
const { LIST_TOOLS } = await import('../src/core/protocol');

// What the listeners return (true: an answer comes later), and what they answered.
const deliver = async (msg: unknown) => {
  const replies: unknown[] = [];
  const returned = [...listeners].map((l) => l(msg, {}, (r) => replies.push(r)));
  await new Promise((r) => setTimeout(r));
  return { returned, replies };
};

beforeEach(() => listeners.clear());

describe('onRuntime', () => {
  it('handles its own type only, with the message typed', async () => {
    const states: string[] = [];
    onRuntime(WIDGET_CHAT_STATE, (msg) => void states.push(msg.state));
    await deliver({ type: WIDGET_FLOAT });
    await deliver('not a message');
    await deliver(null);
    const { returned, replies } = await deliver({ type: WIDGET_CHAT_STATE, state: 'working' });
    expect(states).toEqual(['working']);
    expect(returned).toEqual([undefined]); // nothing to answer: left to the other listeners
    expect(replies).toEqual([]);
  });

  it('answers at once, or once its promise settles (keeping the channel open)', async () => {
    onRuntime(WIDGET_FLOAT, (msg) => ({ floated: !!msg.toggle }));
    expect(await deliver({ type: WIDGET_FLOAT, toggle: true })).toEqual({ returned: [undefined], replies: [{ floated: true }] });
    listeners.clear();
    onRuntime(LIST_TOOLS, async () => ({ tools: [] }));
    expect(await deliver({ type: LIST_TOOLS })).toEqual({ returned: [true], replies: [{ tools: [] }] });
  });

  it('answers undefined when the handler fails, and is removed by what it returns', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const off = onRuntime(LIST_TOOLS, () => Promise.reject(new Error('down')));
    expect((await deliver({ type: LIST_TOOLS })).replies).toEqual([undefined]);
    off();
    expect(listeners.size).toBe(0);
  });
});
