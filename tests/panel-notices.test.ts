// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeStorage } from './fakes/browser';
import type { ManagerStatus } from '../src/manager/protocol';
import type { Row } from '../src/manager/rows';
import type { Message, SentText } from '../src/core/types';
import type { Conversation } from '../src/history/store';

// The notices of the Agents Panel (manager/notices): an agent a row's agent started answered while that
// one did not wait for it; and how many of them wake its chat before the user writes (manager-chat).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../src/ui/floating-frame', () => ({ FLOATING: false, MANAGER: true, MANAGER_AGENT: undefined, MANAGER_CONVERSATION: undefined, FULL: false, PREVIEW: false, floatingTab: async () => undefined, knownFloatingTab: () => undefined }));
const storage = fakeStorage();
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));

const { GRACE_MS, dueNotices, markTold, noticeOf, seenBy, settlingOf } = await import('../src/manager/notices');
const { useManagerSays, userSpoke } = await import('../src/entrypoints/sidepanel/manager-chat');
const { setLimitOverrides } = await import('../src/core/limits');
const { MANAGER_SAY } = await import('../src/manager/protocol');
const { isPanelNotice } = await import('../src/core/messages');
const { conversationMarkdown } = await import('../src/history/markdown');

const status: ManagerStatus = { state: 'idle', said: true, conversationId: 'c', title: 't', step: 0, maxSteps: 15, agentName: 'Builder', model: 'm', given: 1 };
const boss: Row = { key: 'p', tabId: 1 };
const worker = (over: Partial<Row> = {}): Row => ({ key: 'w1', tabId: 2, parent: 'p', agentName: 'Builder', title: 'compare prices', handed: 1, status: { ...status, state: 'working' }, ...over });
const done = worker({ status: { ...status, answer: '384,400 km' } });

describe('when a notice is due', () => {
  it('once a row has settled a while, and nothing told its parent since', () => {
    let s = settlingOf(new Map(), [boss, worker()], 0);
    s = settlingOf(s, [boss, done], 1000);
    expect(dueNotices(s, [boss, done], 1000 + GRACE_MS - 1)).toEqual([]);
    expect(dueNotices(s, [boss, done], 1000 + GRACE_MS)).toEqual([done]);
    markTold(s, 'w1');
    expect(dueNotices(s, [boss, done], 1000 + GRACE_MS)).toEqual([]);
  });
  it('not when a panel.wait told it, nor once told; again when it settles again', () => {
    let s = settlingOf(settlingOf(new Map(), [boss, worker()], 0), [boss, done], 0);
    seenBy(s, [{ row: 'w1', agent: 'Builder', state: 'done', answer: '384,400 km' }]);
    expect(dueNotices(s, [boss, done], GRACE_MS)).toEqual([]);
    s = settlingOf(s, [boss, worker()], GRACE_MS);
    s = settlingOf(s, [boss, done], GRACE_MS);
    expect(dueNotices(s, [boss, done], 2 * GRACE_MS)).toEqual([done]);
  });
  it('not without its parent in the list, nor for a stopped row', () => {
    const s = settlingOf(settlingOf(new Map(), [boss, worker()], 0), [boss, done], 0);
    expect(dueNotices(s, [done], GRACE_MS)).toEqual([]);
    expect(settlingOf(new Map(), [boss, worker({ stopped: true })], 0).size).toBe(0);
  });
  it('waiting for the user settles it too', () => {
    const waiting = worker({ status: { ...status, state: 'waiting' } });
    const s = settlingOf(settlingOf(new Map(), [boss, worker()], 0), [boss, waiting], 0);
    expect(dueNotices(s, [boss, waiting], GRACE_MS)).toEqual([waiting]);
  });
});

describe('what a notice says', () => {
  it('who answered, and its answer as untrusted; the chat shows a line', () => {
    const n = noticeOf(done);
    expect(n.notice).toBe(true);
    expect(n.text).toContain('The agent "Builder" (row w1) has finished:\n<untrusted_agent_answer agent="Builder">');
    expect(n.text).toContain('384,400 km');
    expect(n.shown).toBe('Builder · t answered'); // its chat's title, as its row shows it; never the row id
  });
  it('by what its row shows before its chat has a title', () => {
    expect(noticeOf(worker({ status: undefined })).shown).toBe('Builder · compare prices answered');
  });
  it('one that waits for the user', () => {
    expect(noticeOf(worker({ status: { ...status, state: 'waiting' } }))).toMatchObject({ text: 'The agent "Builder" (row w1) is waiting for the user to answer a card in its row.', shown: 'Builder · t is waiting for you' });
  });
});

describe('how many wake the chat', () => {
  it('as many as Settings → Limits says until the user writes again; the rest wait for that', async () => {
    setLimitOverrides({ panelNotices: 1 });
    const send = vi.fn((_message: SentText) => true);
    const Probe = () => {
      useManagerSays(true, send);
      return null;
    };
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(createElement(Probe)));
    const say = (text: string, notice: boolean) =>
      act(async () => void window.dispatchEvent(new MessageEvent('message', { data: { type: MANAGER_SAY, text, shown: text, ...(notice && { notice }) }, origin: location.origin, source: window })));
    await say('first', true);
    await say('second', true);
    expect(send.mock.calls.map(([m]) => m)).toEqual([{ text: 'first', shown: 'first', from: 'panel' }]);
    await act(async () => userSpoke());
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith({ text: 'second', shown: 'second', from: 'panel' });
    act(() => root.unmount());
    setLimitOverrides({});
  });
});

describe('how a notice shows', () => {
  const notice: Message = { role: 'user', parts: [{ type: 'text', text: 'The agent "Builder" (row w1) has finished: …', shown: 'Builder · t answered', from: 'panel' }] };
  const yours: Message = { role: 'user', parts: [{ type: 'text', text: 'go on' }] };
  it('apart from what the user wrote, in the chat and in the Markdown export', () => {
    expect([isPanelNotice(notice), isPanelNotice(yours)]).toEqual([true, false]);
    const md = conversationMarkdown({ title: 'T', createdAt: 0, history: [yours, notice] } as Conversation);
    expect(md).toContain('## You\n\ngo on');
    expect(md).toContain('_↳ Builder · t answered_');
    expect(md.match(/## You/g)).toHaveLength(1);
  });
});
