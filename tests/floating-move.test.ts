// The chat floating on a page, asked by the background for its conversation (FLOATING_TO_PANEL, the
// widget bar's "Open in the side panel"): it hands it to the side panel between turns only, and goes on
// with a new one when the panel did not open (the conversation waits for it).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../src/core/types';
import { fakeBrowser, fakeStorage } from './fakes/browser';

const storage = fakeStorage();
vi.stubGlobal('location', { search: '?floating' });
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage, { tabs: { getCurrent: vi.fn(async () => ({ id: 3, windowId: 9 })) } }) }));
const { CHAT_HANDOFF, FLOATING_PREFIX } = await import('../src/widget/protocol');
const { HANDOFF_MAX_BYTES, HANDOFF_TOO_LARGE, floatOnPage, moveToPage, moveToPanel, movePanel } = await import('../src/entrypoints/sidepanel/floating');
const { browser } = await import('wxt/browser');

const history: Message[] = [{ role: 'user', parts: [{ type: 'text', text: 'move me' }] }];
const chat = () => ({ history, conversationId: 'c1', reset: vi.fn<() => void>() });
const handedOff = () => storage.session.data[CHAT_HANDOFF];

beforeEach(() => storage.reset());

describe('moveToPanel', () => {
  it('hands its conversation to the side panel, which was opened (the widget then closes this chat)', async () => {
    const agent = chat();
    expect(await moveToPanel(agent, 'a1', { to: {}, opened: true }, true)).toEqual({ moved: true });
    expect(handedOff()).toMatchObject({ payload: { kind: 'conversation', messages: history, conversationId: 'c1', agentId: 'a1' } });
    expect(agent.reset).not.toHaveBeenCalled();
  });

  it("to the tab's own panel with the pin off", async () => {
    await moveToPanel(chat(), undefined, { to: { panelTab: 3 }, opened: true }, true);
    expect(handedOff()).toMatchObject({ panelTab: 3 });
  });

  it('not opened: the conversation waits for the panel, and this chat starts anew', async () => {
    const agent = chat();
    expect(await moveToPanel(agent, undefined, { to: {}, opened: false }, true)).toEqual({ moved: true });
    expect(handedOff()).toBeDefined();
    expect(agent.reset).toHaveBeenCalledOnce();
  });

  it('not while a turn runs, it is compacted, or it is temporary', async () => {
    const agent = chat();
    expect(await moveToPanel(agent, undefined, { to: {}, opened: true }, false)).toEqual({ moved: false });
    expect(handedOff()).toBeUndefined();
    expect(agent.reset).not.toHaveBeenCalled();
  });
});

describe('a conversation handed off', () => {
  const screenshot: Message[] = [
    ...history,
    { role: 'assistant', parts: [{ type: 'tool_call', id: 't', name: 'browser__screenshot', args: {} }] },
    { role: 'tool', parts: [{ type: 'tool_result', toolCallId: 't', content: 'ok', images: [{ mediaType: 'image/jpeg', data: 'x'.repeat(1000) }] }] },
  ];
  const huge: Message[] = [{ role: 'user', parts: [{ type: 'text', text: 'x'.repeat(HANDOFF_MAX_BYTES) }] }];

  it('goes as the history keeps it: without its screenshots', async () => {
    await moveToPanel({ ...chat(), history: screenshot }, undefined, { to: {}, opened: true }, true);
    const { payload } = handedOff() as { payload: { messages: Message[] } };
    expect(JSON.stringify(payload.messages)).not.toContain('x'.repeat(1000));
    expect(payload.messages).toHaveLength(3);
  });

  it('too large, stays in the floating chat as it is, and says why', async () => {
    const agent = { ...chat(), history: huge };
    expect(await moveToPanel(agent, undefined, { to: {}, opened: false }, true)).toEqual({ moved: false, error: HANDOFF_TOO_LARGE });
    expect(handedOff()).toBeUndefined();
    expect(agent.reset).not.toHaveBeenCalled();
  });

  it('refused by the browser, moves to no page and leaves nothing behind', async () => {
    const set = vi.spyOn(browser.storage.session, 'set').mockImplementation(async (items: Record<string, unknown>) => {
      if (CHAT_HANDOFF in items) throw new Error('QUOTA_BYTES quota exceeded');
      Object.assign(storage.session.data, items);
    });
    try {
      const agent = { ...chat(), reset: vi.fn() } as unknown as Parameters<typeof moveToPage>[0];
      await expect(moveToPage(agent, undefined, 5)).rejects.toThrow('quota');
      expect(storage.session.data[FLOATING_PREFIX + 5]).toBeUndefined();
      expect(handedOff()).toBeUndefined();
      // "Float on this page" says so, and the chat goes on with it.
      expect(await floatOnPage(agent, undefined, 5, 9)).toBe('Could not move it: QUOTA_BYTES quota exceeded');
      expect(agent.reset).not.toHaveBeenCalled();
      expect(storage.session.data[FLOATING_PREFIX + 5]).toBeUndefined();
    } finally {
      set.mockRestore();
    }
  });

  it('too large, does not switch the panel, and says why', async () => {
    const update = vi.fn();
    const agent = { ...chat(), history: huge } as unknown as Parameters<typeof movePanel>[0];
    expect(await movePanel(agent, undefined, { id: 3, windowId: 9 }, true, update)).toBe(HANDOFF_TOO_LARGE);
    expect(update).not.toHaveBeenCalled();
    expect(handedOff()).toBeUndefined();
  });

  it('too large, does not float on the page, and says why', async () => {
    const agent = { ...chat(), history: huge, reset: vi.fn() } as unknown as Parameters<typeof floatOnPage>[0];
    expect(await floatOnPage(agent, undefined, 5, 9)).toBe(HANDOFF_TOO_LARGE);
    expect(agent.reset).not.toHaveBeenCalled();
    expect(storage.session.data[FLOATING_PREFIX + 5]).toBeUndefined();
    expect(handedOff()).toBeUndefined();
  });
});
