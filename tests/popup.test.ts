import { describe, expect, it, vi } from 'vitest';

// The toolbar button's popup: floating the chat on the current page.
const sendMessage = vi.fn();
const permissions = { contains: vi.fn(async (_p: { origins: string[] }) => true), request: vi.fn(async (_p: { origins: string[] }) => true) };
// The tab is on a site where the bubble is not hidden (widget/float shows a hidden one again: widget-wake.test).
const storage = { local: { get: async () => ({}) } };
vi.mock('wxt/browser', () => ({ browser: { tabs: { sendMessage, get: async (id: number) => ({ id, url: 'https://shop.example.com/' }) }, permissions, storage } }));
const { enableAndFloat, floatChat, whyNoFloat } = await import('../src/ui/popup-actions');
const { WIDGET_FLOAT } = await import('../src/widget/protocol');

describe('floating the chat from the popup', () => {
  it("asks the page's widget", async () => {
    sendMessage.mockResolvedValueOnce({ floated: true });
    expect(await floatChat(4)).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith(4, { type: WIDGET_FLOAT });
  });
  it('no widget on the page, or it could not', async () => {
    sendMessage.mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.'));
    expect(await floatChat(4)).toBe(false);
    sendMessage.mockResolvedValueOnce({ floated: false });
    expect(await floatChat(4)).toBe(false);
  });
});

describe('why the chat does not float on a page', () => {
  it('the extension has no access to the site', async () => {
    permissions.contains.mockResolvedValue(false);
    expect(await whyNoFloat('https://shop.example.com/a')).toBe('access');
    expect(permissions.contains).toHaveBeenCalledWith({ origins: ['https://shop.example.com/*'] });
  });
  it('it has: the bubble is off there', async () => {
    permissions.contains.mockResolvedValue(true);
    expect(await whyNoFloat('https://shop.example.com/a')).toBe('bubble');
  });
});

describe('enabling a site from the popup', () => {
  it('asks for it first, then floats the chat once the widget is there', async () => {
    vi.useFakeTimers();
    sendMessage.mockReset().mockRejectedValueOnce(new Error('no widget yet')).mockResolvedValueOnce({ floated: true });
    const done = enableAndFloat(4, 'https://shop.example.com/a');
    expect(permissions.request).toHaveBeenCalledWith({ origins: ['https://shop.example.com/*'] });
    await vi.runAllTimersAsync();
    expect(await done).toBe('floated');
    vi.useRealTimers();
  });
  it('refused: nothing more', async () => {
    permissions.request.mockResolvedValueOnce(false);
    sendMessage.mockReset();
    expect(await enableAndFloat(4, 'https://shop.example.com/a')).toBe('refused');
    expect(sendMessage).not.toHaveBeenCalled();
  });
  it('granted, but no widget comes: the bubble is off there', async () => {
    vi.useFakeTimers();
    sendMessage.mockReset().mockRejectedValue(new Error('no widget'));
    const done = enableAndFloat(4, 'https://shop.example.com/a');
    await vi.runAllTimersAsync();
    expect(await done).toBe('bubble');
    vi.useRealTimers();
  });
});

describe("what the extension may do on a tab's page (the popup's site line, the page bar)", async () => {
  const { pageAccess } = await import('../src/page/access');
  it('a site granted, itself or with every site', async () => {
    permissions.contains.mockReset().mockImplementation(async ({ origins }) => origins[0] === '<all_urls>');
    expect(await pageAccess('https://shop.example.com/a')).toBe('ok');
  });
  it('a site not granted yet', async () => {
    permissions.contains.mockReset().mockResolvedValue(false);
    expect(await pageAccess('https://shop.example.com/a')).toBe('needs-permission');
  });
  it('a page no extension may reach, asked of nobody', async () => {
    permissions.contains.mockReset();
    for (const url of [undefined, 'chrome://extensions/', 'vivaldi://settings/', 'about:blank', 'file:///tmp/a.html', 'https://chromewebstore.google.com/x']) expect(await pageAccess(url)).toBe('restricted');
    expect(permissions.contains).not.toHaveBeenCalled();
  });
});
