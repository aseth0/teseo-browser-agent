// browser.click (synthetic events): its reply says when the click changed nothing on the page.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '../src/core/types';
import { TOOL_SETTINGS } from './helpers';

const calls: { op: string; [k: string]: unknown }[] = [];
let changed: boolean | Error = false;
let acted: () => Promise<string> = async () => 'clicked';
vi.mock('../src/page/bridge', () => ({
  callPage: vi.fn(async (_tab: number, req: { op: string }) => {
    calls.push(req);
    if (req.op === 'change-start') return 'w1';
    if (req.op === 'change-end') {
      if (changed instanceof Error) throw changed;
      return changed;
    }
    if (req.op === 'context') return { meta: { url: 'https://chat.example.test/', title: 'Chat' }, snapshot: { text: 'treeitem "Example Space" [ref_1]', truncated: false } };
    return null;
  }),
  actOnPage: vi.fn(() => acted()),
  waitForLoad: async () => undefined,
}));
const created = new Set<unknown>();
vi.mock('wxt/browser', () => ({ browser: { tabs: { onCreated: { addListener: (l: unknown) => created.add(l), removeListener: (l: unknown) => created.delete(l) } } } }));
vi.mock('../src/core/util', async (orig) => ({ ...(await orig<object>()), sleep: async () => undefined }));

const { writeTools } = await import('../src/tools/browser/write-tools');
const tool = (name: string) => writeTools().find((t) => t.name === name)!;
const ctx: ToolContext = { tabId: 7, signal: new AbortController().signal, settings: TOOL_SETTINGS };
const reply = async (name: string, args: Record<string, unknown>) => ((await tool(name).run(args, ctx)) as { text: string }).text;

beforeEach(() => {
  calls.length = 0;
  changed = false;
  acted = async () => 'clicked';
});

describe('browser.click', () => {
  it('watches the page from before the click until it settled, and says when nothing changed', async () => {
    expect(await reply('browser.click', { ref: 'ref_1' })).toMatch(/^clicked, but nothing changed: same URL, no change in the page, the focus did not move and no tab opened\. /);
    expect(calls.map((c) => c.op)).toEqual(['change-start', 'settle', 'change-end', 'context']);
    expect(created.size).toBe(0);
  });

  it('says only "clicked" when the page changed, or went away (it navigated)', async () => {
    changed = true;
    expect(await reply('browser.click', { ref: 'ref_1' })).toMatch(/^clicked\.\nNow on:/);
    changed = new Error('Receiving end does not exist');
    expect(await reply('browser.click', { ref: 'ref_1' })).toMatch(/^clicked\.\nNow on:/);
  });

  it('stops watching the tabs when the click fails', async () => {
    acted = async () => {
      throw new Error('ref_1 no longer exists on the page; read it again');
    };
    await expect(reply('browser.click', { ref: 'ref_1' })).rejects.toThrow('no longer exists');
    expect(created.size).toBe(0);
  });

  it('other actions are not watched', async () => {
    await reply('browser.press_key', { key: 'Enter' });
    expect(calls.map((c) => c.op)).not.toContain('change-start');
  });
});
