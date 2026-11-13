// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Message } from '../src/core/types';
import { afterTurn, backToBox, enqueue, MAX_QUEUED, queueFull, type QueuedText } from '../src/entrypoints/sidepanel/send-queue';

// Messages written while the agent works wait (up to MAX_QUEUED) and go in order, one per turn that
// ends as it should; stopped, failed or at the step limit, they go back to the message box.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../src/ui/settings-context', () => ({ useSettingsContext: () => ({ settings: {} }) }));
vi.mock('../src/entrypoints/sidepanel/WatchesMenu', () => ({ useWatchContinuation: () => undefined }));
vi.mock('../src/entrypoints/sidepanel/MentionComposer', () => ({ MentionComposer: () => null })); // its own tests
const { useSendPipeline } = await import('../src/entrypoints/sidepanel/useSendPipeline');
const { previewAgent } = await import('../src/entrypoints/sidepanel/useAgent');
const { ComposerArea } = await import('../src/entrypoints/sidepanel/ComposerArea');
const { QueuedStrip } = await import('../src/entrypoints/sidepanel/QueuedStrip');

const texts = (q: QueuedText[]) => q.map((x) => x.text);

describe('the queue', () => {
  it('takes text, trimmed, up to its cap', () => {
    let q: QueuedText[] = [];
    for (let i = 1; i <= MAX_QUEUED + 1; i++) q = enqueue(q, ` m${i} `, i);
    expect(MAX_QUEUED).toBe(3);
    expect(texts(q)).toEqual(['m1', 'm2', 'm3']);
    expect(queueFull(q)).toBe(true);
    expect(enqueue([], '   ', 1)).toEqual([]);
  });

  it('goes back to the box after what it has, a blank line between each', () => {
    const q = [{ id: 1, text: 'a' }, { id: 2, text: 'b' }];
    expect(backToBox('', q)).toBe('a\n\nb');
    expect(backToBox(' draft ', q)).toBe('draft\n\na\n\nb');
  });

  it('goes on only after a turn that ended as it should', () => {
    expect(afterTurn({ error: '', stepLimit: null })).toBe('next');
    expect(afterTurn({ error: 'Lost the connection', stepLimit: null })).toBe('back');
    expect(afterTurn({ error: '', stepLimit: 30 })).toBe('back');
  });
});

describe('the message box while the agent works', () => {
  const area = () =>
    renderToStaticMarkup(createElement(ComposerArea, {
      composer: null, box: {} as never, attachments: { dropProps: {} } as never, busy: true, compacting: false, canSend: true, onSend: () => undefined, onStop: () => undefined,
    }));

  it('has only Stop: the queue shows what waits, Enter queues, ⌘/Ctrl+Enter sends now', () => {
    const html = area();
    expect(html).toContain('>Stop</button>');
    expect(html).not.toContain('>Queue</button>');
    expect(html).not.toContain('>Send now</button>');
  });

  it('lists what waits; each is edited back only into an empty box', () => {
    const items = [{ id: 1, text: 'first' }];
    const none = () => undefined;
    const strip = (canEdit: boolean) => renderToStaticMarkup(createElement(QueuedStrip, { items, canEdit, onEdit: none, onSendNow: none, onRemove: none }));
    expect(strip(true)).toContain('aria-label="Remove from the queue"');
    expect(strip(true)).toContain('aria-label="Stop the agent and send this now"');
    expect(strip(true)).not.toContain('disabled');
    expect(strip(false)).toContain('disabled=""');
    expect(renderToStaticMarkup(createElement(QueuedStrip, { items: [], canEdit: true, onEdit: none, onSendNow: none, onRemove: none }))).toBe('');
  });
});

describe('the send pipeline', () => {
  type Pipe = ReturnType<typeof useSendPipeline>;
  interface Turn { busy: boolean; error?: string; stepLimit?: number | null; conversationId?: string; history?: Message[] }
  // What Stop leaves (agent-state): the turn's answer so far, marked stopped.
  const STOPPED: Message[] = [{ role: 'user', parts: [{ type: 'text', text: 'go' }] }, { role: 'assistant', parts: [{ type: 'text', text: 'partial' }], stopped: true }];

  // As the store does: Stop ends the turn at once. Compaction gives the history as it is (none due).
  function setup({ beforeSend, afterTurn }: { beforeSend?: () => Promise<Message[]>; afterTurn?: () => Promise<Message[] | undefined> | undefined } = {}) {
    const sendToAgent = vi.fn((..._args: unknown[]) => true);
    const stop = vi.fn();
    let history: Message[] = [];
    let pipe!: Pipe;
    let input = '';
    let type!: (text: string) => void;
    let turn!: (t: Turn) => void;
    function Harness() {
      const [text, setText] = useState('');
      const [t, setT] = useState<Turn>({ busy: true });
      type = setText;
      turn = setT;
      input = text;
      history = t.history ?? [];
      const stopNow = (how?: { interrupted?: boolean }) => {
        stop(how);
        setT((was) => ({ ...was, busy: false, history: STOPPED }));
      };
      const agent = { ...previewAgent(history, { calls: 0, input: 0, output: 0 }), conversationId: t.conversationId ?? 'c1', busy: t.busy, error: t.error ?? '', stepLimit: t.stepLimit ?? null, send: sendToAgent, stop: stopNow };
      pipe = useSendPipeline({
        agent, page: { tabId: 1, access: 'ok' } as never, queued: undefined, provider: { id: 'p' } as never, model: 'm', profile: undefined, includePage: false, noSelection: false, skip: [],
        input: text, setInput: (u) => setText(u), attachments: { images: [], files: [], clear: vi.fn() } as never, recording: undefined,
        compaction: { compacting: false, beforeSend: beforeSend ?? (async () => history), afterTurn: afterTurn ?? (() => undefined) } as never, onSent: () => undefined,
      });
      return null;
    }
    const root = createRoot(document.createElement('div'));
    act(() => root.render(createElement(Harness)));
    const queue = async (...msgs: string[]) => {
      for (const m of msgs) {
        act(() => type(m));
        await act(() => pipe.send());
      }
    };
    return { sendToAgent, stop, queue, type: (text: string) => type(text), pipe: () => pipe, input: () => input, turn: (t: Turn) => act(() => turn(t)) };
  }
  const sentText = (call: unknown[]) => call[0];

  it('queues while busy, at most three, and empties the box', async () => {
    const s = setup();
    await s.queue('one', 'two', 'three', 'four');
    expect(texts(s.pipe().waiting.items)).toEqual(['one', 'two', 'three']);
    expect(s.input()).toBe('four'); // the fourth stays in the box
    expect(s.sendToAgent).not.toHaveBeenCalled();
  });

  it('sends them in order, one per turn that ends', async () => {
    const s = setup();
    await s.queue('one', 'two');
    await act(async () => s.turn({ busy: false }));
    expect(s.sendToAgent.mock.calls.map(sentText)).toEqual(['one']);
    expect(texts(s.pipe().waiting.items)).toEqual(['two']);
    s.turn({ busy: true });
    await act(async () => s.turn({ busy: false }));
    expect(s.sendToAgent.mock.calls.map(sentText)).toEqual(['one', 'two']);
    expect(s.pipe().waiting.items).toEqual([]);
  });

  it('puts them back in the box on Stop, on an error and at the step limit', async () => {
    for (const end of [{ error: 'Failed' }, { stepLimit: 30 }]) {
      const s = setup();
      await s.queue('one', 'two');
      await act(async () => s.turn({ busy: false, ...end }));
      expect(s.sendToAgent).not.toHaveBeenCalled();
      expect(s.input()).toBe('one\n\ntwo');
    }
    const s = setup();
    await s.queue('one', 'two');
    act(() => s.type('draft'));
    act(() => s.pipe().stopRun());
    expect(s.stop).toHaveBeenCalled();
    expect(s.input()).toBe('draft\n\none\n\ntwo');
    expect(s.pipe().waiting.items).toEqual([]);
  });

  it('sends the next one with the history compacted after the turn, when the model asked for it (chat.compact)', async () => {
    const compacted: Message[] = [{ role: 'user', parts: [{ type: 'text', text: 'compacted' }] }];
    const beforeSend = vi.fn(async () => [] as Message[]);
    const s = setup({ beforeSend, afterTurn: async () => compacted });
    await s.queue('one');
    await act(async () => s.turn({ busy: false }));
    expect(s.sendToAgent.mock.calls.map(sentText)).toEqual(['one']);
    expect(s.sendToAgent.mock.calls[0]![3]).toBe(compacted);
    expect(beforeSend).not.toHaveBeenCalled();
  });

  it('puts one that could not be compacted back in the box, with the rest', async () => {
    const s = setup({ beforeSend: () => Promise.reject(new Error('no model')) });
    await s.queue('one', 'two');
    await act(async () => s.turn({ busy: false }));
    expect(s.sendToAgent).not.toHaveBeenCalled();
    expect(s.input()).toBe('one\n\ntwo');
    expect(s.pipe().sendError).toContain('could not be compacted');
  });

  it('sends what is in the box now, after the stopped turn; the queue waits for its end', async () => {
    const s = setup();
    await s.queue('one');
    act(() => s.type('urgent'));
    await act(async () => s.pipe().sendInsteadNow());
    expect(s.stop).toHaveBeenCalledWith({ interrupted: true });
    expect(s.sendToAgent).toHaveBeenCalledTimes(1);
    expect(s.sendToAgent.mock.calls[0]![0]).toBe('urgent');
    expect(s.sendToAgent.mock.calls[0]![3]).toEqual(STOPPED); // the model is told it was stopped
    expect(s.input()).toBe('');
    expect(texts(s.pipe().waiting.items)).toEqual(['one']);
    s.turn({ busy: true });
    await act(async () => s.turn({ busy: false }));
    expect(s.sendToAgent.mock.calls.map(sentText)).toEqual(['urgent', 'one']);
  });

  it('sends a queued one now, the others staying queued', async () => {
    const s = setup();
    await s.queue('one', 'two');
    const two = s.pipe().waiting.items[1]!;
    await act(async () => s.pipe().sendInsteadNow(two.id));
    expect(s.sendToAgent.mock.calls.map(sentText)).toEqual(['two']);
    expect(s.sendToAgent.mock.calls[0]![3]).toEqual(STOPPED);
    expect(texts(s.pipe().waiting.items)).toEqual(['one']);
  });

  it('does not stop the agent with nothing to send', async () => {
    const s = setup();
    await act(async () => s.pipe().sendInsteadNow());
    await act(async () => s.pipe().sendInsteadNow(99));
    expect(s.stop).not.toHaveBeenCalled();
  });

  it('drops them when another conversation opens', async () => {
    const s = setup();
    await s.queue('one');
    await act(async () => s.turn({ busy: false, conversationId: 'c2' }));
    expect(s.sendToAgent).not.toHaveBeenCalled();
    expect(s.pipe().waiting.items).toEqual([]);
    expect(s.input()).toBe('');
  });

  it('edits one back into an empty box, and removes one', async () => {
    const s = setup();
    await s.queue('one', 'two');
    const [one, two] = s.pipe().waiting.items;
    act(() => s.pipe().waiting.remove(two!.id));
    act(() => s.pipe().waiting.edit(one!.id));
    expect(s.input()).toBe('one');
    expect(s.pipe().waiting.items).toEqual([]);
  });
});
