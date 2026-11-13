// A run is stopped from the moment it is asked for: a Stop, or a newer run, while its tabs are being
// held never lets it start, and it never stops the newer one.
import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeEvent, fakePort, fakeStorage } from './fakes/browser';

const onConnect = fakeEvent<(port: ReturnType<typeof fakePort>) => void>();
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(fakeStorage(), { runtime: { id: 'ext-id', getURL: (path: string) => 'chrome-extension://ext-id/' + path.replace(/^\//, ''), onConnect, getPlatformInfo: async () => ({}) } }) }));
const runAgent = vi.fn(async (_msg: unknown, _opts: { signal: AbortSignal; send: (m: unknown) => void }) => undefined);
vi.mock('../src/background/agent-run', () => ({ runAgent }));
// Each run's tabs held when the test says so.
const holding: (() => void)[] = [];
vi.mock('../src/watches/tab-holds', () => ({
  tabHolds: { holdForRun: () => new Promise<() => Promise<void>>((resolve) => holding.push(() => resolve(async () => undefined))) },
}));

const { PORT_NAME } = await import('../src/core/protocol');
const { createSessions } = await import('../src/background/session');
createSessions(vi.fn());

const panel = (tab?: { id: number }) => {
  const port = fakePort(PORT_NAME, { url: 'chrome-extension://ext-id/sidepanel.html', ...(tab && { tab }) });
  onConnect.emit(port);
  return port;
};
const run = { type: 'run', history: [], conversationId: 'c1' };

describe('a run', () => {
  it('stopped while its tabs are held, never starts', async () => {
    holding.length = 0;
    runAgent.mockClear();
    const port = panel();
    port.onMessage.emit(run);
    port.onMessage.emit({ type: 'stop' });
    holding.shift()!();
    await new Promise((r) => setTimeout(r));
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('replaced while its tabs are held, never starts nor stops the newer one', async () => {
    holding.length = 0;
    runAgent.mockClear();
    const port = panel();
    port.onMessage.emit(run);
    port.onMessage.emit(run);
    const [older, newer] = holding.splice(0);
    newer!();
    await vi.waitFor(() => expect(runAgent).toHaveBeenCalledTimes(1));
    older!();
    await new Promise((r) => setTimeout(r));
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(runAgent.mock.calls[0]![1].signal.aborted).toBe(false);
  });

  it('knows of a plan taken away while it goes, and a chat that takes it over is told', async () => {
    holding.length = 0;
    runAgent.mockClear();
    let finish = () => {};
    runAgent.mockImplementationOnce(() => new Promise<undefined>((resolve) => (finish = () => resolve(undefined))));
    const floating = { id: 7 }; // only the chat floating on a tab takes a run over
    const port = panel(floating);
    port.onMessage.emit({ ...run, conversationId: 'c2' });
    holding.shift()!();
    await vi.waitFor(() => expect(runAgent).toHaveBeenCalledTimes(1));
    port.onMessage.emit({ type: 'plan-dismissed', id: 'p1' });
    await new Promise((r) => setTimeout(r));
    const seen = (runAgent.mock.calls[0]![1] as unknown as { dismissedPlans: ReadonlySet<string> }).dismissedPlans;
    expect(seen.has('p1')).toBe(true);
    port.onDisconnect.emit(port);
    const next = panel(floating);
    next.onMessage.emit({ type: 'attach', conversationId: 'c2' });
    await vi.waitFor(() => expect(next.postMessage).toHaveBeenCalledWith({ type: 'plan-dismissed', id: 'p1' }));
    finish();
  });

  it("sends each event back with its run's number, and none to a panel that sent none", async () => {
    holding.length = 0;
    runAgent.mockClear();
    runAgent.mockImplementation(async (_msg, { send }) => void send({ type: 'status', text: 'Reading' }));
    const port = panel();
    port.onMessage.emit({ ...run, runId: 7 });
    holding.shift()!();
    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledWith({ type: 'status', text: 'Reading', runId: 7 }));
    port.onMessage.emit(run);
    holding.shift()!();
    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledWith({ type: 'status', text: 'Reading' }));
    runAgent.mockReset();
    runAgent.mockImplementation(async () => undefined);
  });

  it('sends the error of a run replaced meanwhile with its own number, not the newer one\'s', async () => {
    holding.length = 0;
    runAgent.mockClear();
    let fail = () => {};
    runAgent.mockImplementationOnce(() => new Promise<undefined>((_resolve, reject) => (fail = () => reject(new Error('Boom')))));
    const port = panel();
    port.onMessage.emit({ ...run, runId: 1 });
    holding.shift()!();
    await vi.waitFor(() => expect(runAgent).toHaveBeenCalledTimes(1));
    port.onMessage.emit({ ...run, runId: 2 });
    fail();
    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledWith({ type: 'error', error: 'Boom', runId: 1 }));
    holding.shift()!();
  });
});
