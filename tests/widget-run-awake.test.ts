// A page widget's run keeps the service worker awake while it goes on (the card's answer, a model's
// first token), and lets it sleep once it has replied.
import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeEvent, fakePort, fakeStorage } from './fakes/browser';

const onConnect = fakeEvent<(port: ReturnType<typeof fakePort>) => void>();
vi.mock('wxt/browser', () => ({
  browser: fakeBrowser(fakeStorage(), { runtime: { id: 'ext-id', getURL: (path: string) => 'chrome-extension://ext-id/' + path.replace(/^\//, ''), onConnect } }),
}));
const awake = vi.fn();
vi.mock('../src/background/keep-awake', () => ({ keepAwake: () => awake }));
let release: ((actions: never[]) => void) | undefined;
vi.mock('../src/background/widget-host', async (original) => ({
  ...(await original<object>()),
  pageActions: () => new Promise<never[]>((resolve) => (release = resolve)),
}));

const { WIDGET_RUN } = await import('../src/widget/protocol');
const { listenWidgetRuns } = await import('../src/background/widget-run');
listenWidgetRuns(vi.fn());

describe("a page widget's run", () => {
  it('keeps the worker awake until it replies', async () => {
    const port = fakePort(WIDGET_RUN, { url: 'https://example.com/', tab: { id: 7 }, frameId: 0 });
    onConnect.emit(port);
    port.onMessage.emit({ type: WIDGET_RUN, id: 'a1', input: '' });
    expect(awake.mock.calls).toEqual([[true]]);
    await vi.waitFor(() => expect(release).toBeDefined()); // the page's actions asked
    release!([]);
    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'reply' })));
    await vi.waitFor(() => expect(awake.mock.calls).toEqual([[true], [false]]));
  });
});
