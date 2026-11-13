import { beforeEach, describe, expect, it, vi } from 'vitest';

// Going to an agent's tab from the agent manager, and opening the manager, or the chat in a tab, from
// the side panel.
const tabs = { get: vi.fn(), update: vi.fn(async () => undefined), query: vi.fn(), create: vi.fn(async () => undefined) };
const windows = { update: vi.fn(async () => undefined) };
vi.mock('wxt/browser', () => ({ browser: { tabs, windows, runtime: { getURL: (p: string) => `chrome-extension://ext${p}` } } }));
const { goToTab } = await import('../src/manager/tabs');
const { openFullChat, openManager } = await import('../src/browser/open-manager');
const { clampSplit } = await import('../src/entrypoints/manager/useSplit');

beforeEach(() => vi.clearAllMocks());

describe('going to an agent\'s tab', () => {
  it('shows the tab and its window', async () => {
    tabs.get.mockResolvedValue({ id: 5, windowId: 2 });
    await goToTab(5);
    expect(windows.update).toHaveBeenCalledWith(2, { focused: true });
    expect(tabs.update).toHaveBeenCalledWith(5, { active: true });
  });
  it('a tab closed meanwhile: nothing', async () => {
    tabs.get.mockRejectedValue(new Error('No tab with id: 5'));
    await expect(goToTab(5)).resolves.toBeUndefined();
    expect(tabs.update).not.toHaveBeenCalled();
  });
});

describe('opening the agent manager', () => {
  it('in a new tab', async () => {
    tabs.query.mockResolvedValue([]);
    await openManager();
    expect(tabs.query).toHaveBeenCalledWith({ url: 'chrome-extension://ext/manager.html*' });
    expect(tabs.create).toHaveBeenCalledWith({ url: 'chrome-extension://ext/manager.html' });
  });
  it('or the one open', async () => {
    tabs.query.mockResolvedValue([{ id: 9, windowId: 3, url: 'chrome-extension://ext/manager.html#x' }]);
    await openManager();
    expect(tabs.create).not.toHaveBeenCalled();
    expect(tabs.update).toHaveBeenCalledWith(9, { active: true });
    expect(windows.update).toHaveBeenCalledWith(3, { focused: true });
  });
});

describe('opening the chat in a tab', () => {
  it('in a new tab, under the extension\'s own URL', async () => {
    tabs.query.mockResolvedValue([{ id: 4, windowId: 3, url: 'chrome-extension://ext/sidepanel.html' }]);
    await openFullChat();
    expect(tabs.query).toHaveBeenCalledWith({ url: 'chrome-extension://ext/sidepanel.html*' });
    expect(tabs.create).toHaveBeenCalledWith({ url: 'chrome-extension://ext/sidepanel.html?full' });
  });
  it('or the one open', async () => {
    tabs.query.mockResolvedValue([{ id: 4, url: 'chrome-extension://ext/sidepanel.html' }, { id: 9, windowId: 3, url: 'chrome-extension://ext/sidepanel.html?full' }]);
    await openFullChat();
    expect(tabs.create).not.toHaveBeenCalled();
    expect(tabs.update).toHaveBeenCalledWith(9, { active: true });
  });
});

describe('the divider', () => {
  it('keeps both sides wide enough', () => {
    expect([clampSplit(100, 1000), clampSplit(900, 1000), clampSplit(400, 1000)]).toEqual([380, 680, 400]);
  });
});
