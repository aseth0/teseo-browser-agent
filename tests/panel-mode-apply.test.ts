// The browser set for the chat's pin (core/side-panel applyPanelMode) once per browser session and pin:
// in Vivaldi, setting the side panel's options while its web panel shows closes it, and a worker that
// restarts (woken by the message you send) would do it each time.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeEvent, fakeStorage } from './fakes/browser';

const storage = fakeStorage();
const setOptions = vi.fn(async (_o: unknown) => undefined);
const setPanelBehavior = vi.fn(async (_o: unknown) => undefined);
vi.mock('wxt/browser', () => ({
  browser: {
    storage,
    sidePanel: { open: vi.fn(async () => undefined), setOptions, setPanelBehavior },
    tabs: { query: vi.fn(async () => [{ id: 1 }, { id: 2 }]) },
    commands: { onCommand: fakeEvent() },
    runtime: { onMessage: fakeEvent(), getURL: (path: string) => `chrome-extension://ext${path}` },
  },
}));
type Pin = { follows: boolean };
let pin: Pin = { follows: true };
const changed: ((s: Pin) => void)[] = [];
vi.mock('../src/storage/settings', () => ({ loadSettings: async () => pin, onSettingsChanged: (l: (s: Pin) => void) => void changed.push(l) }));
vi.mock('../src/storage/settings-select', () => ({ panelFollowsOn: (s: Pin) => s.follows }));
const { listenPanelMode } = await import('../src/background/panel-mode');
const { PANEL_TRACE_KEY, panelTraced } = await import('../src/background/panel-trace');

const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  await panelTraced();
};
const browserAsked = () => setOptions.mock.calls.length + setPanelBehavior.mock.calls.length;

beforeEach(() => {
  storage.reset();
  setOptions.mockClear();
  setPanelBehavior.mockClear();
  changed.length = 0;
  pin = { follows: true };
});

describe('the pin applied to the browser', () => {
  it('on the first worker start of the browser session: applied, and traced', async () => {
    listenPanelMode();
    await settle();
    expect(setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: false });
    expect(setOptions).toHaveBeenCalledWith({ path: 'sidepanel.html', enabled: true });
    expect(storage.session.data[PANEL_TRACE_KEY]).toEqual([expect.objectContaining({ event: 'apply-mode', follows: true })]);
  });

  it('a worker that restarts with the pin as applied in this session leaves the side panel alone (Vivaldi would close it)', async () => {
    listenPanelMode();
    await settle();
    setOptions.mockClear();
    setPanelBehavior.mockClear();
    listenPanelMode(); // the worker stopped, and a message woke it
    await settle();
    expect(browserAsked()).toBe(0);
  });

  it('the pin changed, or another browser session: applied again', async () => {
    listenPanelMode();
    await settle();
    setOptions.mockClear();
    changed.at(-1)!({ follows: false });
    await settle();
    expect(setOptions).toHaveBeenCalledWith({ enabled: false });
    setOptions.mockClear();
    setPanelBehavior.mockClear();
    pin = { follows: false };
    listenPanelMode(); // restarts with the pin as applied: nothing
    await settle();
    expect(browserAsked()).toBe(0);
    for (const k of Object.keys(storage.session.data)) delete storage.session.data[k]; // the browser restarted
    listenPanelMode();
    await settle();
    expect(setOptions).toHaveBeenCalledWith({ enabled: false });
  });

  it('one that failed is applied again by the next worker', async () => {
    setPanelBehavior.mockRejectedValueOnce(new Error('no'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    listenPanelMode();
    await settle();
    setOptions.mockClear();
    listenPanelMode();
    await settle();
    expect(setOptions).toHaveBeenCalledWith({ path: 'sidepanel.html', enabled: true });
    error.mockRestore();
  });
});
