// One conversation, one run at a time: the pinned conversation floats on several tabs, and a turn sent
// from one while another runs it is refused. The conversations running are told to the chats
// (RUNNING_CHATS), with the tab of the chat running each.
import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeEvent, fakePort, fakeStorage } from './fakes/browser';

const onConnect = fakeEvent<(port: ReturnType<typeof fakePort>) => void>();
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(fakeStorage(), { runtime: { id: 'ext-id', getURL: (path: string) => 'chrome-extension://ext-id/' + path.replace(/^\//, ''), onConnect, getPlatformInfo: async () => ({}) } }) }));
const finishers: (() => void)[] = [];
const runAgent = vi.fn(() => new Promise<undefined>((resolve) => finishers.push(() => resolve(undefined))));
vi.mock('../src/background/agent-run', () => ({ runAgent }));
const holdForRun = vi.fn(async (_ids: unknown) => async () => undefined);
vi.mock('../src/watches/tab-holds', () => ({ tabHolds: { holdForRun: (ids: unknown) => holdForRun(ids) } }));

const { browser } = await import('wxt/browser');
const { PORT_NAME } = await import('../src/core/protocol');
const { RUNNING_CHATS, RUNS_ELSEWHERE } = await import('../src/widget/protocol');
const { createSessions } = await import('../src/background/session');
createSessions(vi.fn());

const floating = (tabId: number) => {
  const port = fakePort(PORT_NAME, { url: 'chrome-extension://ext-id/sidepanel.html?floating', tab: { id: tabId } });
  onConnect.emit(port);
  return port;
};
const running = async () => (await browser.storage.session.get(RUNNING_CHATS))[RUNNING_CHATS];
const run = (conversationId: string, runId?: number) => ({ type: 'run', history: [], conversationId, ...(runId !== undefined && { runId }) });

describe('a run of a conversation another chat runs', () => {
  it('is refused, the turn ended with why; once that run ends, it goes', async () => {
    const a = floating(4);
    const b = floating(7);
    a.onMessage.emit(run('pinned'));
    await vi.waitFor(() => expect(runAgent).toHaveBeenCalledTimes(1));
    await vi.waitFor(async () => expect(await running()).toEqual({ pinned: 4 }));
    b.onMessage.emit(run('pinned', 3));
    await new Promise((r) => setTimeout(r));
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(b.postMessage).toHaveBeenCalledWith({ type: 'error', error: RUNS_ELSEWHERE, runId: 3 });
    finishers.shift()!();
    await vi.waitFor(async () => expect(await running()).toBeUndefined());
    b.onMessage.emit(run('pinned'));
    await vi.waitFor(() => expect(runAgent).toHaveBeenCalledTimes(2));
    await vi.waitFor(async () => expect(await running()).toEqual({ pinned: 7 }));
    finishers.shift()!();
    await vi.waitFor(async () => expect(await running()).toBeUndefined());
  });

  it("never stops the chat's own newer run, nor another conversation's", async () => {
    runAgent.mockClear();
    const a = floating(4);
    const b = floating(7);
    a.onMessage.emit(run('c1'));
    b.onMessage.emit(run('c2'));
    await vi.waitFor(() => expect(runAgent).toHaveBeenCalledTimes(2));
    await vi.waitFor(async () => expect(await running()).toEqual({ c1: 4, c2: 7 }));
    a.onMessage.emit(run('c1')); // its own, again (sent at once): replaces it
    await vi.waitFor(() => expect(runAgent).toHaveBeenCalledTimes(3));
    for (const finish of finishers.splice(0)) finish();
    await vi.waitFor(async () => expect(await running()).toBeUndefined());
  });

  it('let go once stopped, while what is left of it unwinds', async () => {
    runAgent.mockClear();
    const a = floating(4);
    a.onMessage.emit(run('s1'));
    await vi.waitFor(async () => expect(await running()).toEqual({ s1: 4 }));
    a.onMessage.emit({ type: 'stop' });
    await vi.waitFor(async () => expect(await running()).toBeUndefined());
    const b = floating(7);
    b.onMessage.emit(run('s1'));
    await vi.waitFor(() => expect(runAgent).toHaveBeenCalledTimes(2));
    for (const finish of finishers.splice(0)) finish();
    await vi.waitFor(async () => expect(await running()).toBeUndefined());
  });

  it('let go when it fails, also while its tabs are being held', async () => {
    runAgent.mockClear();
    holdForRun.mockImplementationOnce(async () => {
      throw new Error('no tabs');
    });
    const a = floating(4);
    a.onMessage.emit(run('f1'));
    await vi.waitFor(() => expect(a.postMessage).toHaveBeenCalledWith({ type: 'error', error: 'no tabs' }));
    expect(await running()).toBeUndefined();
    runAgent.mockImplementationOnce(async () => {
      throw new Error('Boom');
    });
    a.onMessage.emit(run('f1'));
    await vi.waitFor(() => expect(a.postMessage).toHaveBeenCalledWith({ type: 'error', error: 'Boom' }));
    expect(await running()).toBeUndefined();
  });

  it("a side panel's run: let go when its chat closes", async () => {
    const port = fakePort(PORT_NAME, { url: 'chrome-extension://ext-id/sidepanel.html' });
    onConnect.emit(port);
    port.onMessage.emit(run('p1'));
    await vi.waitFor(async () => expect(await running()).toEqual({ p1: -1 }));
    port.onDisconnect.emit(port);
    await vi.waitFor(async () => expect(await running()).toBeUndefined());
    for (const finish of finishers.splice(0)) finish();
  });

  it("a floating chat's run away (its page reloaded): still running, and another tab waits", async () => {
    runAgent.mockClear();
    const a = floating(4);
    a.onMessage.emit(run('d1'));
    await vi.waitFor(() => expect(runAgent).toHaveBeenCalledTimes(1));
    a.onDisconnect.emit(a);
    await new Promise((r) => setTimeout(r));
    expect(await running()).toEqual({ d1: 4 });
    const b = floating(7);
    b.onMessage.emit(run('d1', 9));
    await vi.waitFor(() => expect(b.postMessage).toHaveBeenCalledWith({ type: 'error', error: RUNS_ELSEWHERE, runId: 9 }));
    for (const finish of finishers.splice(0)) finish();
    await vi.waitFor(async () => expect(await running()).toBeUndefined());
  });
});
