import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeEvent } from './fakes/browser';

const onDetach = fakeEvent<(source: { tabId?: number }, reason: string) => void>();
const onEvent = fakeEvent<(source: { tabId?: number }, method: string, params?: object) => void>();
const debuggerApi = {
  getTargets: vi.fn(async () => [] as { tabId?: number; attached: boolean; extensionId?: string }[]),
  attach: vi.fn(async (_target: { tabId: number }, _version: string) => undefined),
  detach: vi.fn(async (_target: { tabId: number }) => undefined),
  sendCommand: vi.fn(async (_target: { tabId: number }, _method: string, _params?: object): Promise<unknown> => ({})),
  onDetach,
  onEvent,
};
const sendMessage = vi.fn(async (_m: unknown) => undefined);
vi.mock('wxt/browser', () => ({
  browser: { debugger: debuggerApi, runtime: { id: 'me', sendMessage, onMessage: fakeEvent() } },
}));
let settings: { devtoolsTools?: boolean } = { devtoolsTools: true };
// What the background gives it: the settings, and the badge's DBG.
const deps = { settingsNow: async () => settings as Settings, setDebuggerBadge: vi.fn((_tabs: number) => undefined) };

const { withDebugger, attachedTabs, DevtoolsDetachedError, listenDevtools, CDP_METHODS, holdForRecording } = await import('../src/devtools/cdp');
type Settings = import('../src/storage/settings-types').Settings;
type CdpEvent = import('../src/devtools/cdp').CdpEvent;
type Method = Parameters<Parameters<typeof withDebugger>[1]>[0] extends { send(m: infer M, ...r: never[]): unknown } ? M : never;

beforeAll(() => listenDevtools(deps));
beforeEach(() => {
  settings = { devtoolsTools: true };
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

describe('withDebugger', () => {
  it('refuses while the setting is off', async () => {
    settings = {};
    await expect(withDebugger(7, async () => 1)).rejects.toThrow(/turn them on in Settings → Chromium DevTools/);
    expect(debuggerApi.attach).not.toHaveBeenCalled();
  });

  it('refuses a method outside the allowlist', async () => {
    await expect(withDebugger(7, (s) => s.send('Runtime.evaluate' as Method))).rejects.toThrow('CDP method not allowed: Runtime.evaluate');
    expect(debuggerApi.sendCommand).not.toHaveBeenCalled();
    expect(debuggerApi.detach).toHaveBeenCalledTimes(1);
  });

  it('attaches with 1.3 and detaches after the call', async () => {
    debuggerApi.sendCommand.mockResolvedValueOnce({ data: 'abc' });
    const result = await withDebugger(7, (s) => s.send<{ data: string }>('Page.captureScreenshot', { format: 'jpeg' }));
    expect(result).toEqual({ data: 'abc' });
    expect(debuggerApi.attach).toHaveBeenCalledWith({ tabId: 7 }, '1.3');
    expect(debuggerApi.sendCommand).toHaveBeenCalledWith({ tabId: 7 }, 'Page.captureScreenshot', { format: 'jpeg' });
    expect(debuggerApi.detach).toHaveBeenCalledTimes(1);
  });

  it('detaches after a throw', async () => {
    await expect(withDebugger(7, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(debuggerApi.detach).toHaveBeenCalledTimes(1);
  });

  it('detaches after the time limit', async () => {
    await expect(withDebugger(7, () => new Promise(() => undefined), { timeoutMs: 30 })).rejects.toThrow(/timed out/);
    expect(debuggerApi.detach).toHaveBeenCalledTimes(1);
  });

  it('detaches an attach that ends after the time limit', async () => {
    let finish!: () => void;
    debuggerApi.attach.mockImplementationOnce(() => new Promise<undefined>((r) => (finish = () => r(undefined))));
    await expect(withDebugger(7, async () => 1, { timeoutMs: 30 })).rejects.toThrow(/timed out/);
    finish();
    await vi.waitFor(() => expect(debuggerApi.detach).toHaveBeenCalledTimes(1));
    expect(attachedTabs()).toEqual([]);
  });

  it('a session that timed out sends nothing more', async () => {
    let stale!: { send: (m: Method) => Promise<unknown> };
    let resume!: () => void;
    await expect(withDebugger(7, async (s) => {
      stale = s as typeof stale;
      await new Promise<void>((r) => (resume = r));
    }, { timeoutMs: 30 })).rejects.toThrow(/timed out/);
    resume();
    await expect(stale.send('Input.insertText')).rejects.toThrow(/ended/);
    expect(debuggerApi.sendCommand).not.toHaveBeenCalled();
  });

  it('a detach that never answers does not hold the call', async () => {
    debuggerApi.detach.mockImplementationOnce(() => new Promise(() => undefined));
    await expect(withDebugger(7, async () => 'done')).resolves.toBe('done');
    await expect(withDebugger(7, async () => 'next')).resolves.toBe('next');
  });

  it('serializes calls on one tab', async () => {
    const order: string[] = [];
    let release!: () => void;
    const first = withDebugger(7, async () => {
      order.push('first start');
      await new Promise<void>((r) => (release = r));
      order.push('first end');
    });
    const second = withDebugger(7, async () => void order.push('second'));
    await vi.waitFor(() => expect(order).toEqual(['first start']));
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['first start', 'first end', 'second']);
  });

  it('a failed call does not block the next one', async () => {
    await expect(withDebugger(7, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(withDebugger(7, async () => 'next')).resolves.toBe('next');
  });

  it('onDetach ends the call with its reason', async () => {
    const call = withDebugger(7, () => new Promise(() => undefined));
    await vi.waitFor(() => expect(debuggerApi.attach).toHaveBeenCalled());
    onDetach.emit({ tabId: 7 }, 'canceled_by_user');
    const error = await call.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DevtoolsDetachedError);
    expect((error as InstanceType<typeof DevtoolsDetachedError>).reason).toBe('canceled_by_user');
    expect((error as Error).message).toBe('The debugger was detached (canceled_by_user): try again');
    expect(attachedTabs()).toEqual([]);
  });

  it('says another debugger is attached', async () => {
    debuggerApi.attach.mockRejectedValueOnce(new Error('Another debugger is already attached to the tab with id: 7.'));
    await expect(withDebugger(7, async () => 1)).rejects.toThrow('Another debugger is attached to this tab (DevTools open?): close it and try again');
    expect(debuggerApi.detach).not.toHaveBeenCalled();
  });

  it('shows DBG while attached', async () => {
    let inside: number[] = [];
    await withDebugger(7, async () => void (inside = attachedTabs()));
    expect(inside).toEqual([7]);
    expect(attachedTabs()).toEqual([]);
    expect(deps.setDebuggerBadge.mock.calls).toEqual([[1], [0]]);
    expect(sendMessage).toHaveBeenCalledWith({ type: 'browser-agent:devtools-status', tabs: [7] });
    expect(sendMessage).toHaveBeenLastCalledWith({ type: 'browser-agent:devtools-status', tabs: [] });
  });
});

describe('listenDevtools', () => {
  // As Chrome lists them: a tab's target has no extensionId (that is a background page's), and attached
  // says that someone is, this extension or another client (the user's DevTools): detaching one this
  // extension did not attach fails, harmlessly.
  it('detaches what a stopped worker left attached, and clears the badge', async () => {
    debuggerApi.getTargets.mockResolvedValueOnce([
      { tabId: 3, attached: true },
      { tabId: 4, attached: true },
      { tabId: 5, attached: false },
      { attached: true, extensionId: 'other' },
    ]);
    debuggerApi.detach.mockImplementation(async ({ tabId }: { tabId: number }) => {
      if (tabId === 4) throw new Error('Debugger is not attached to the tab with id: 4.');
    });
    listenDevtools(deps);
    await vi.waitFor(() => expect(deps.setDebuggerBadge).toHaveBeenCalledWith(0));
    expect(debuggerApi.detach.mock.calls).toEqual([[{ tabId: 3 }], [{ tabId: 4 }]]);
    debuggerApi.detach.mockReset();
  });
});

describe('events during a call', () => {
  it("delivers a call's events to its listeners only", async () => {
    const seen: unknown[] = [];
    let release!: () => void;
    const call = withDebugger(7, async (s) => {
      s.on('Network.loadingFinished', (p) => seen.push(p));
      await new Promise<void>((r) => (release = r));
    });
    await vi.waitFor(() => expect(debuggerApi.attach).toHaveBeenCalled());
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    onEvent.emit({ tabId: 7 }, 'Network.loadingFinished', { requestId: '1' });
    onEvent.emit({ tabId: 8 }, 'Network.loadingFinished', { requestId: 'other tab' });
    onEvent.emit({ tabId: 7 }, 'Network.requestWillBeSent', { requestId: '2' });
    release();
    await call;
    expect(seen).toEqual([{ requestId: '1' }]);
  });

  it('drops listeners when the call ends', async () => {
    const seen: unknown[] = [];
    await withDebugger(7, async (s) => s.on('Network.loadingFinished', (p) => seen.push(p)));
    onEvent.emit({ tabId: 7 }, 'Network.loadingFinished', { requestId: '1' });
    expect(seen).toEqual([]);
  });

  it('refuses an event outside the list', async () => {
    await expect(withDebugger(7, async (s) => s.on('Runtime.consoleAPICalled' as CdpEvent, () => undefined))).rejects.toThrow('CDP event not allowed: Runtime.consoleAPICalled');
  });

  it("allows the engine's methods", async () => {
    const added = ['Emulation.setDeviceMetricsOverride', 'Emulation.clearDeviceMetricsOverride', 'Emulation.setEmulatedMedia', 'Network.enable'] as const;
    for (const m of added) expect(CDP_METHODS).toContain(m);
    expect(CDP_METHODS).not.toContain('Page.enable' as never);
    await withDebugger(7, (s) => s.send('Network.enable'));
    expect(debuggerApi.sendCommand).toHaveBeenCalledWith({ tabId: 7 }, 'Network.enable', undefined);
  });
});

describe("a recording's hold", () => {
  it('a tool call on a held tab fails at once', async () => {
    const hold = await holdForRecording(7, () => undefined);
    await expect(withDebugger(7, async () => 1)).rejects.toThrow('A recording is in progress on this tab: stop it first.');
    expect(debuggerApi.attach).toHaveBeenCalledTimes(1);
    await hold.release();
  });

  it('the hold waits for a running call', async () => {
    let release!: () => void;
    const call = withDebugger(7, () => new Promise<void>((r) => (release = r)));
    let held = false;
    const hold = holdForRecording(7, () => undefined).then((h) => ((held = true), h));
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(held).toBe(false);
    release();
    await call;
    await (await hold).release();
    expect(held).toBe(true);
  });

  it('is refused while the switch is off', async () => {
    settings = {};
    await expect(holdForRecording(7, () => undefined)).rejects.toThrow(/are off/);
    expect(debuggerApi.attach).not.toHaveBeenCalled();
  });

  it('recording methods are refused outside a hold', async () => {
    await expect(withDebugger(7, (s) => s.send('Network.getResponseBody' as Method))).rejects.toThrow('CDP method not allowed: Network.getResponseBody');
  });

  it('child-session sends carry the session id', async () => {
    const hold = await holdForRecording(7, () => undefined);
    await hold.send('Network.enable', undefined, 'child-1');
    await hold.send('Network.getResponseBody', { requestId: 'r1' });
    expect(debuggerApi.sendCommand).toHaveBeenCalledWith({ tabId: 7, sessionId: 'child-1' }, 'Network.enable', undefined);
    expect(debuggerApi.sendCommand).toHaveBeenCalledWith({ tabId: 7 }, 'Network.getResponseBody', { requestId: 'r1' });
    await hold.release();
  });

  it("delivers the tab's events with their child session", async () => {
    const seen: unknown[] = [];
    const hold = await holdForRecording(7, () => undefined);
    hold.on('Network.requestWillBeSent', (p, child) => seen.push([p, child]));
    onEvent.emit({ tabId: 7, sessionId: 'child-1' } as { tabId: number }, 'Network.requestWillBeSent', { requestId: 'w1' });
    onEvent.emit({ tabId: 8 }, 'Network.requestWillBeSent', { requestId: 'other' });
    expect(seen).toEqual([[{ requestId: 'w1' }, 'child-1']]);
    await hold.release();
  });

  it('release detaches', async () => {
    const hold = await holdForRecording(7, () => undefined);
    await hold.release();
    expect(debuggerApi.detach).toHaveBeenCalledWith({ tabId: 7 });
    expect(attachedTabs()).toEqual([]);
    await expect(withDebugger(7, async () => 'free')).resolves.toBe('free');
  });

  it('onDetach ends the hold with its reason', async () => {
    const ended: string[] = [];
    await holdForRecording(7, (why) => ended.push(why));
    onDetach.emit({ tabId: 7 }, 'canceled_by_user');
    expect(ended).toEqual(['canceled_by_user']);
    await expect(withDebugger(7, async () => 'free')).resolves.toBe('free');
  });
});
