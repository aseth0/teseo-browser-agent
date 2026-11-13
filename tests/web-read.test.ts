// web.read: in a background tab of the agent's window (the panel's tab's), as many characters as the
// model asks for (within the limits), and repeatable for the in-turn savings though it is a write.
import { describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '../src/core/types';
import { fakeBrowser, fakeStorage } from './fakes/browser';

const opened: { url: string; options: unknown }[] = [];
const textCalls: unknown[] = [];
let landed = 'https://docs.example.com/page'; // where the background tab ends up
const browser = fakeBrowser(fakeStorage(), { tabs: { get: async () => ({ url: landed }) } });
vi.mock('wxt/browser', () => ({ browser }));
vi.mock('../src/page/access', () => ({ requireAccess: async () => undefined }));
vi.mock('../src/templates/store', () => ({ templateStore: { load: async () => [] } }));
vi.mock('../src/page/background-tab', () => ({
  LOAD_TIMEOUT_MS: 0,
  inBackgroundTab: async (url: string, options: unknown, run: (tabId: number) => Promise<unknown>) => {
    opened.push({ url, options });
    return run(1);
  },
}));
vi.mock('../src/page/bridge', () => ({
  isNavigationError: () => false,
  waitForLoad: async () => undefined,
  callPage: async (_tabId: number, req: { op: string }) => {
    if (req.op === 'sign-in') return false;
    textCalls.push(req);
    return { title: 'Page', markdown: { text: 'Hello', truncated: false } };
  },
}));
vi.mock('../src/core/util', async (original) => ({ ...(await original<typeof import('../src/core/util')>()), sleep: async () => undefined }));

const { webTools } = await import('../src/web/tools');
const { limit } = await import('../src/core/limits');
const read = webTools().find((t) => t.name === 'web.read')!;
const ctx = { tabId: 50, signal: new AbortController().signal, settings: { webSearch: { muteTabs: true } } } as unknown as ToolContext;

describe('web.read', () => {
  it("opens its background tab in the window of the panel's tab", async () => {
    await read.run({ url: 'https://docs.example.com/page' }, ctx);
    expect(opened.at(-1)).toEqual({ url: 'https://docs.example.com/page', options: { web: { muteTabs: true }, agentTab: 50 } });
  });

  it('reads as many characters as asked (a number written as text too), within the limits', async () => {
    textCalls.length = 0;
    for (const maxChars of [undefined, '2000', 10 ** 9]) await read.run({ url: 'https://docs.example.com/page', maxChars }, ctx);
    expect(textCalls.map((c) => (c as { maxChars: number }).maxChars)).toEqual([limit('pageText'), 2000, limit('pageTextMax')]);
  });

  it('is a write that may be repeated', () => {
    expect([read.effect, read.repeatable]).toEqual(['write', true]);
  });

  describe('redirected to another site', () => {
    it("is not read under the requested site's policy: the page it went to is read as a call of its own", async () => {
      landed = 'https://other.example.org/?d=1';
      textCalls.length = 0;
      const callTool = vi.fn(async () => ({ content: 'read through the policy' }));
      const result = await read.run({ url: 'https://docs.example.com/redirect', maxChars: 2000 }, { ...ctx, callTool });
      expect(textCalls).toEqual([]);
      expect(callTool).toHaveBeenCalledWith('web.read', { url: 'https://other.example.org/?d=1', maxChars: 2000 });
      expect(result).toEqual({ type: 'text', text: 'read through the policy' });
      landed = 'https://docs.example.com/page';
    });

    it('is refused when the call cannot run another (a page that redirects again)', async () => {
      landed = 'https://other.example.org/';
      textCalls.length = 0;
      const result = await read.run({ url: 'https://docs.example.com/redirect' }, ctx);
      expect(textCalls).toEqual([]);
      expect(result).toMatchObject({ type: 'text', isError: true });
      landed = 'https://docs.example.com/page';
    });

    it('from https to http on the same host, too', async () => {
      landed = 'http://docs.example.com/page';
      textCalls.length = 0;
      const result = await read.run({ url: 'https://docs.example.com/page' }, ctx);
      expect([textCalls.length, (result as { isError?: boolean }).isError]).toEqual([0, true]);
      landed = 'https://docs.example.com/page';
    });

    it('is read as usual when it stays on the site', async () => {
      landed = 'https://docs.example.com/other';
      textCalls.length = 0;
      await read.run({ url: 'https://docs.example.com/page' }, ctx);
      expect(textCalls.length).toBe(1);
      landed = 'https://docs.example.com/page';
    });
  });
});
