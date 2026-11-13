import { beforeEach, describe, expect, it, vi } from 'vitest';

// A screenshot from the popup or a shortcut: the side panel opened first (inside the gesture) unless
// the chat floats on the tab, or for a section after it is dragged, the page widget out of the
// picture, the images handed to that chat.
const calls: string[] = [];
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const tabs = {
  captureVisibleTab: vi.fn(async (_w: number, _o: unknown) => (calls.push('capture'), PNG)),
  sendMessage: vi.fn(async (_t: number, m: { type: string; hidden?: boolean }) => void calls.push(m.hidden === undefined ? m.type : `hide:${m.hidden}`)),
};
const sidePanel = { open: vi.fn(async (_o: unknown) => void calls.push('panel')), setOptions: vi.fn(async () => undefined) };
const session = { set: vi.fn(async (_v: Record<string, unknown>) => void calls.push('set')) };
const executeScript = vi.fn();
// The page's layout settled after the side panel opened (capture/page layoutSettled): recorded, answered.
// Asked from the page to open the chat once a section is captured (capture/page askToOpenChat): recorded.
const settle = async ({ func, args }: { func: { name: string }; args?: unknown[] }) => {
  if (func.name === 'layoutSettled') return (calls.push('settle'), [{ result: undefined }]);
  if (func.name === 'askToOpenChat') return (calls.push('ask'), asked.push(args ?? []), [{ result: undefined }]);
  return undefined;
};
const asked: unknown[][] = [];
// Access to every site, which a capture started by a key set in Settings needs (no activeTab from it).
let everySite = true;
const permissions = { contains: vi.fn(async (_p: unknown) => everySite) };
vi.mock('wxt/browser', () => ({ browser: { tabs, sidePanel, scripting: { executeScript }, storage: { session }, permissions } }));
let floating = false;
let shown = false; // the window's side panel shows, where opening it would close it (background/panel-windows)
// What the background gives it (background/capture-host).
const deps = { floatingNow: () => floating, panelFollowsNow: () => true, panelShownIn: () => shown, settingsNow: async () => ({}) };
const withDebugger = vi.fn(async () => {
  throw new Error('Chromium DevTools tools are off');
});
vi.mock('../src/devtools/cdp', () => ({ withDebugger }));
vi.mock('../src/core/image', () => ({ shrinkImage: async () => ({ mediaType: 'image/jpeg', data: 'small' }) }));
const crop = vi.fn(async (b: Blob, _a: { y: number }) => b);
vi.mock('../src/capture/area', () => ({ crop, dragArea: () => null }));
const { startCapture } = await import('../src/capture/run');
const { CHAT_ATTACH } = await import('../src/capture/protocol');
const { WIDGET_FLOAT } = await import('../src/widget/protocol');
const { CAPTURE_OPEN_CHAT } = await import('../src/core/protocol');

const tab = { id: 7, windowId: 2 };
executeScript.mockImplementation(settle);
const handedTo = () => session.set.mock.calls.at(-1)?.[0][CHAT_ATTACH] as { at: number; payload: { kind: 'images'; images: unknown[]; note?: string }; tab?: number } | undefined;
const handed = () => handedTo()?.payload;
beforeEach(() => {
  calls.length = 0;
  asked.length = 0;
  floating = false;
  shown = false;
  everySite = true;
  vi.clearAllMocks();
  executeScript.mockReset().mockImplementation(settle);
});

describe('a capture into the side panel', () => {
  it('opens the panel before awaiting anything, then hides the widget around the capture', async () => {
    const done = startCapture('visible', tab, {}, deps);
    expect(sidePanel.open).toHaveBeenCalledWith({ windowId: 2 }); // still inside the gesture
    await done;
    expect(calls).toEqual(['panel', 'settle', 'hide:true', 'capture', 'hide:false', 'set']);
    expect(handedTo()).toEqual({ at: expect.any(Number), payload: { kind: 'images', images: [{ mediaType: 'image/jpeg', data: 'small' }] } });
  });
  it("showing already where opening it would close it (Vivaldi): left open, the page captured as it is", async () => {
    shown = true;
    await startCapture('visible', tab, {}, deps);
    expect(sidePanel.open).not.toHaveBeenCalled();
    expect(calls).toEqual(['hide:true', 'capture', 'hide:false', 'set']);
    expect(handed()?.images).toHaveLength(1);
  });
});

describe('a capture started by a key set in Settings → Shortcuts', () => {
  it('with access to every site: captured as from its browser shortcut', async () => {
    await startCapture('visible', tab, { pageKey: true }, deps);
    expect(permissions.contains).toHaveBeenCalledWith({ origins: ['<all_urls>'] });
    expect(handed()?.images).toHaveLength(1);
  });
  it('without it: the panel opened all the same, nothing captured, a note there on why and what to use instead', async () => {
    everySite = false;
    await startCapture('visible', tab, { pageKey: true }, deps);
    expect(sidePanel.open).toHaveBeenCalled();
    expect(calls).not.toContain('capture');
    expect(handed()?.images).toEqual([]);
    expect(handed()?.note).toMatch(/access to every site.*browser's shortcut/);
  });
  it('a section without it: nothing to drag, the page says why (no panel opens after an await)', async () => {
    everySite = false;
    await startCapture('section', tab, { pageKey: true }, deps);
    const ran = executeScript.mock.calls.map(([o]) => o as { func: { name: string }; args?: unknown[] });
    expect(ran.map((o) => o.func.name)).toEqual(['noticeInPage']);
    expect(String(ran[0]?.args?.[0])).toMatch(/access to every site.*browser's shortcut/);
    expect(session.set).not.toHaveBeenCalled();
  });
  it("from its browser shortcut, nothing is asked: the shortcut grants the tab's access", async () => {
    await startCapture('visible', tab, {}, deps);
    expect(permissions.contains).not.toHaveBeenCalled();
  });
});

describe('a capture into the chat floating on the tab', () => {
  it('no panel; handed to that chat, which is shown (unfolded) after', async () => {
    floating = true;
    await startCapture('visible', tab, {}, deps);
    expect(sidePanel.open).not.toHaveBeenCalled();
    expect(handedTo()?.tab).toBe(7);
    expect(calls.slice(-2)).toEqual(['set', WIDGET_FLOAT]);
    expect(calls).not.toContain('settle'); // no panel opened: nothing moved
  });
});

describe('a section', () => {
  it('cancelled (Esc): nothing handed over, the widget shown again', async () => {
    executeScript.mockImplementation(async (o: { func: { name: string } }) => (await settle(o)) ?? [{ result: null }]);
    await startCapture('section', tab, {}, deps);
    expect(session.set).not.toHaveBeenCalled();
    expect(calls.at(-1)).toBe('hide:false');
  });
  const area = { x: 1, y: 2, width: 30, height: 40, viewport: 1000 };
  const dragged = () => executeScript.mockImplementation(async (o: { func: { name: string } }) => (await settle(o)) ?? [{ result: area }]);
  it('dragged: the capture cut to it', async () => {
    dragged();
    await startCapture('section', tab, {}, deps);
    expect(crop).toHaveBeenCalledWith(expect.any(Blob), area);
    expect(handed()?.images).toHaveLength(1);
  });
  it('dragged on the page as it is: the side panel opened after, asked from the page (its gesture)', async () => {
    dragged();
    const done = startCapture('section', tab, {}, deps);
    expect(sidePanel.open).not.toHaveBeenCalled(); // it would narrow the page before the drag
    await done;
    expect(calls).toEqual(['hide:true', 'capture', 'hide:false', 'set', 'ask']);
    expect(asked).toEqual([[CAPTURE_OPEN_CHAT, area]]);
  });
  it('into the chat floating on the tab: shown there, nothing asked', async () => {
    floating = true;
    dragged();
    await startCapture('section', tab, {}, deps);
    expect(calls.slice(-2)).toEqual(['set', WIDGET_FLOAT]);
    expect(asked).toEqual([]);
  });
  it('cancelled: nothing asked', async () => {
    executeScript.mockImplementation(async (o: { func: { name: string } }) => (await settle(o)) ?? [{ result: null }]);
    await startCapture('section', tab, {}, deps);
    expect(asked).toEqual([]);
    expect(sidePanel.open).not.toHaveBeenCalled();
  });
  it('captured but failed: the note handed over, the chat asked for all the same', async () => {
    dragged();
    tabs.captureVisibleTab.mockRejectedValueOnce(new Error('denied'));
    await startCapture('section', tab, {}, deps);
    expect(handed()?.note).toBe('Could not capture the page (denied).');
    expect(asked).toEqual([[CAPTURE_OPEN_CHAT, area]]);
  });
});

describe('a capture that fails', () => {
  it('hands over a note instead', async () => {
    tabs.captureVisibleTab.mockRejectedValueOnce(new Error('denied'));
    await startCapture('visible', tab, {}, deps);
    expect(handedTo()).toEqual({ at: expect.any(Number), payload: { kind: 'images', images: [], note: 'Could not capture the page (denied).' } });
    expect(calls).toContain('hide:false');
  });
});

describe('a whole page, stitched (DevTools off)', () => {
  it('a capture per viewport, scrolled back after; the last one cut to what the one before did not show', async () => {
    vi.useFakeTimers();
    const scrolled: number[] = [];
    executeScript.mockImplementation(async ({ func, args }: { func: { name: string }; args?: number[] }) => {
      if (func.name === 'layoutSettled') return [{ result: undefined }];
      if (!args?.length) return [{ result: { width: 1000, viewport: 1000, height: 2500, y: 300 } }];
      scrolled.push(args[0]!);
      return [{ result: Math.min(args[0]!, 1500) }]; // the page ends at 2500: scrolled to 1500 at most
    });
    const done = startCapture('full-page', tab, {}, deps);
    await vi.runAllTimersAsync();
    await done;
    vi.useRealTimers();
    expect(tabs.captureVisibleTab).toHaveBeenCalledTimes(3);
    expect(scrolled).toEqual([0, 1000, 2000, 300]);
    expect(crop).toHaveBeenCalledTimes(1);
    expect(crop).toHaveBeenCalledWith(expect.any(Blob), { x: 0, y: 500, width: 1000, height: 500, viewport: 1000 });
    expect(handed()?.images).toHaveLength(3);
    expect(handed()?.note).toBeUndefined();
  });
  it('more parts than images per message: the rest counted in a note', async () => {
    vi.useFakeTimers();
    executeScript.mockImplementation(async ({ func, args }: { func: { name: string }; args?: number[] }) =>
      [{ result: func.name === 'layoutSettled' ? undefined : args?.length ? args[0] : { width: 1000, viewport: 1000, height: 6500, y: 0 } }]);
    const done = startCapture('full-page', tab, {}, deps);
    await vi.runAllTimersAsync();
    await done;
    vi.useRealTimers();
    expect(handed()?.images).toHaveLength(4);
    expect(handed()?.note).toBe('3 parts of the page left out: at most 4 images per message (Settings → Limits).');
  });
});

describe('a whole page on the DevTools engine', () => {
  it('captured down to the last part kept, at once, then cut into parts', async () => {
    const send = vi.fn(async (_m: string, _p: unknown) => ({ data: 'iVBORw0KGgo=' }));
    withDebugger.mockImplementationOnce((async (_t: number, fn: (s: { send: typeof send }) => Promise<unknown>) => fn({ send })) as never);
    executeScript.mockImplementation(async ({ func }: { func: { name: string } }) => [{ result: func.name === 'layoutSettled' ? undefined : { width: 1000, viewport: 1000, height: 6500, y: 0 } }]);
    await startCapture('full-page', tab, {}, deps);
    expect(send).toHaveBeenCalledWith('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1000, height: 4000, scale: 1 } });
    expect(tabs.captureVisibleTab).not.toHaveBeenCalled();
    expect(crop.mock.calls.map(([, a]) => a.y)).toEqual([0, 1000, 2000, 3000]);
    expect(handed()?.images).toHaveLength(4);
    expect(handed()?.note).toBe('3 parts of the page left out: at most 4 images per message (Settings → Limits).');
  });
});

describe('a capture pressed again while one runs on the tab', () => {
  it('is ignored; once it ended, the next one runs', async () => {
    const first = startCapture('visible', tab, {}, deps);
    await startCapture('visible', tab, {}, deps);
    await first;
    expect(sidePanel.open).toHaveBeenCalledTimes(1);
    expect(tabs.captureVisibleTab).toHaveBeenCalledTimes(1);
    await startCapture('visible', tab, {}, deps);
    expect(tabs.captureVisibleTab).toHaveBeenCalledTimes(2);
  });
});
