// A run asked by a page whose site has the bubble hidden (its ✕) is refused: a stale or compromised
// page gets no action run, on load or not, once the user hid the bubble there. The extension's own
// pages (Settings → Actions' Try) are not a site's.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeEvent, fakePort, fakeStorage } from './fakes/browser';

const storage = fakeStorage();
const onConnect = fakeEvent<(port: ReturnType<typeof fakePort>) => void>();
vi.mock('wxt/browser', () => ({
  browser: fakeBrowser(storage, { runtime: { id: 'ext-id', getURL: (path: string) => 'chrome-extension://ext-id/' + path.replace(/^\//, ''), onConnect } }),
}));
vi.mock('../src/background/keep-awake', () => ({ keepAwake: () => () => undefined }));
const pageActions = vi.fn(async (_url: string | undefined) => [] as never[]);
vi.mock('../src/background/widget-host', async (original) => ({ ...(await original<object>()), pageActions }));

const { WIDGET_PLACES, WIDGET_RUN } = await import('../src/widget/protocol');
const { listenWidgetRuns } = await import('../src/background/widget-run');
listenWidgetRuns(vi.fn());

const run = async (url: string) => {
  const port = fakePort(WIDGET_RUN, { url, tab: { id: 7, url }, frameId: 0 });
  onConnect.emit(port);
  port.onMessage.emit({ type: WIDGET_RUN, id: 'a1', input: '' });
  await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'reply' })));
  return (port.postMessage.mock.calls.at(-1)![0] as { reply: { error?: string } }).reply;
};

beforeEach(() => {
  storage.reset();
  pageActions.mockClear();
});

describe('a run from a page whose site has the bubble hidden', () => {
  it('is refused before its action is even looked up', async () => {
    await storage.local.set({ [WIDGET_PLACES]: { 'shop.example.com': { hidden: true } } });
    expect((await run('https://shop.example.com/item')).error).toMatch(/hidden/);
    expect(pageActions).not.toHaveBeenCalled();
  });
  it("an older build's place, hidden with its other fields, likewise", async () => {
    await storage.local.set({ [WIDGET_PLACES]: { 'shop.example.com': { x: 10, y: 20, pinned: true, width: 300, chat: { x: 1, y: 2, width: 400, height: 500 }, hidden: true } } });
    expect((await run('https://shop.example.com/')).error).toMatch(/hidden/);
  });
  it('goes on where it is shown, or shown again', async () => {
    await storage.local.set({ [WIDGET_PLACES]: { 'shop.example.com': { hidden: false }, 'other.example.com': { hidden: true } } });
    await run('https://shop.example.com/');
    expect(pageActions).toHaveBeenCalledWith('https://shop.example.com/');
  });
});
