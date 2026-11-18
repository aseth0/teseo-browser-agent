// The tickets of the chat floating on a page (background/frame-tickets): issued only to the page widget
// (a content script in a tab's top frame), redeemed only by the floating chat's page (floating.html) in a
// frame of the tab the ticket is for, once, before it expires; never by it as a tab's top document, nor
// by any other page of the extension.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeEvent, fakeStorage } from './fakes/browser';

const EXTENSION = 'chrome-extension://ext-id/';
const storage = fakeStorage();
const onMessage = fakeEvent<(msg: unknown, sender: object, sendResponse: (reply: unknown) => void) => unknown>();
const onRemoved = fakeEvent<(tabId: number) => void>();
vi.mock('wxt/browser', () => ({
  browser: fakeBrowser(storage, {
    runtime: { id: 'ext-id', getURL: (path: string) => EXTENSION + path.replace(/^\//, ''), onMessage },
    tabs: { onRemoved },
  }),
}));
const available = vi.hoisted(() => ({ floating: true }));
vi.mock('../src/core/build', () => ({ floatingChatAvailable: () => available.floating }));

const { FRAME_REDEEM, FRAME_TICKET, FRAME_TICKETS } = await import('../src/widget/protocol');
const { issueTicket, listenFrameTickets, redeemTicket, TICKET_MS } = await import('../src/background/frame-tickets');
listenFrameTickets();

const WIDGET = { url: 'https://example.com/', tab: { id: 7 }, frameId: 0 }; // the widget: a content script, top frame
const PAGE_FRAME = { url: 'https://ads.example.com/', tab: { id: 7 }, frameId: 2 }; // a script of a page's frame
const EXTENSION_PAGE = { url: `${EXTENSION}sidepanel.html` }; // the side panel: no tab
const FRAME = (tab = 7) => ({ url: `${EXTENSION}floating.html#ticket=x`, tab: { id: tab }, frameId: 3 }); // the floating chat's page in a page's frame
const TOP_TAB = { url: `${EXTENSION}sidepanel.html?full`, tab: { id: 7 }, frameId: 0 }; // the chat in a tab of its own
const FLOATING_TOP = { url: `${EXTENSION}floating.html#ticket=x`, tab: { id: 7 }, frameId: 0 }; // floating.html opened by a page in a tab of its own
const PANEL_FRAME = { url: `${EXTENSION}sidepanel.html?floating`, tab: { id: 7 }, frameId: 3 }; // another page of the extension in a frame

// What a one-off message gets: its listeners' answer, or none (undefined) when all leave it.
const message = async (msg: object, sender: object) => {
  const replies: unknown[] = [];
  const kept = onMessage.emit(msg, sender, (r) => replies.push(r));
  if (kept.includes(true)) await vi.waitFor(() => expect(replies.length).toBe(1));
  return replies[0] as { ticket?: string; shown?: boolean } | undefined;
};
const ask = (sender: object) => message({ type: FRAME_TICKET }, sender);
const redeem = (ticket: unknown, sender: object) => message({ type: FRAME_REDEEM, ticket }, sender);

beforeEach(() => {
  storage.reset();
  available.floating = true;
});

describe('issuing a ticket', () => {
  it('gives the widget a random ticket for its tab, kept where a sleeping worker finds it', async () => {
    const a = (await ask(WIDGET))!.ticket!;
    const b = (await ask(WIDGET))!.ticket!;
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).not.toBe(a);
    expect(Object.keys(storage.session.data[FRAME_TICKETS] as object).sort()).toEqual([a, b].sort());
  });

  it("is refused to anyone but this extension's content script in a tab's top frame", async () => {
    for (const sender of [PAGE_FRAME, EXTENSION_PAGE, FRAME(), TOP_TAB, FLOATING_TOP, {}]) expect(await ask(sender)).toBeUndefined();
    expect(storage.session.data[FRAME_TICKETS]).toBeUndefined();
  });

  it('gives none where the chat cannot float (Firefox)', async () => {
    available.floating = false;
    expect(await ask(WIDGET)).toBeUndefined();
  });

  it('keeps only the newest few, the expired ones dropped', async () => {
    const old = await issueTicket(7, 0);
    for (let i = 0; i < 40; i++) await issueTicket(7, TICKET_MS);
    const kept = Object.keys(storage.session.data[FRAME_TICKETS] as object);
    expect(kept).toHaveLength(32);
    expect(kept).not.toContain(old);
  });
});

describe('redeeming a ticket', () => {
  it("shows the chat in a frame of the ticket's tab, once", async () => {
    const { ticket } = (await ask(WIDGET))!;
    expect(await redeem(ticket, FRAME())).toEqual({ shown: true });
    expect(await redeem(ticket, FRAME())).toEqual({ shown: false }); // used twice
    expect(storage.session.data[FRAME_TICKETS]).toEqual({});
  });

  it('refuses one issued for another tab, and spends it', async () => {
    const { ticket } = (await ask(WIDGET))!;
    expect(await redeem(ticket, FRAME(8))).toEqual({ shown: false });
    expect(await redeem(ticket, FRAME(7))).toEqual({ shown: false });
  });

  it('refuses one expired', async () => {
    const ticket = await issueTicket(7, 1000);
    expect(await redeemTicket(ticket, 7, 1000 + TICKET_MS)).toBe(false);
    const fresh = await issueTicket(7, 1000);
    expect(await redeemTicket(fresh, 7, 1000 + TICKET_MS - 1)).toBe(true);
  });

  it('refuses one never issued, or not a ticket at all', async () => {
    await ask(WIDGET);
    for (const made of ['0'.repeat(64), 'f'.repeat(64), '__proto__', 'constructor', '', 42, null, undefined, {}]) expect(await redeem(made, FRAME())).toEqual({ shown: false });
    expect(Object.keys(storage.session.data[FRAME_TICKETS] as object)).toHaveLength(1); // the real one, untouched
  });

  it("refuses a sender that is not the floating chat's page in a page's frame", async () => {
    const others = [
      FLOATING_TOP, // its page as a tab's top document: never
      { ...FLOATING_TOP, frameId: undefined },
      PANEL_FRAME, // sidepanel.html, even in a frame
      { ...FRAME(), url: `${EXTENSION}floating.html.js` },
      { ...FRAME(), url: `${EXTENSION}sub/floating.html` },
      { ...FRAME(), url: `chrome-extension://other-id/floating.html` },
      { ...FRAME(), url: `https://example.com/floating.html` },
      { ...FRAME(), url: 'not a URL' },
      { ...FRAME(), url: undefined },
    ];
    for (const sender of [WIDGET, PAGE_FRAME, EXTENSION_PAGE, TOP_TAB, { ...FRAME(), url: `https://example.com/?${EXTENSION}` }, ...others, {}]) {
      const { ticket } = (await ask(WIDGET))!;
      expect(await redeem(ticket, sender)).toEqual({ shown: false });
      expect(await redeem(ticket, FRAME())).toEqual({ shown: true }); // left as it was
    }
  });

  it('survives the worker going to sleep: kept in storage.session', async () => {
    const ticket = await issueTicket(7);
    vi.resetModules(); // a new worker: the module loaded afresh
    const again = await import('../src/background/frame-tickets');
    expect(again.redeemTicket).not.toBe(redeemTicket);
    expect(await again.redeemTicket(ticket, 7)).toBe(true);
  });

  it("drops a closed tab's tickets", async () => {
    const mine = await issueTicket(7);
    const other = await issueTicket(9);
    onRemoved.emit(7);
    await vi.waitFor(() => expect(Object.keys(storage.session.data[FRAME_TICKETS] as object)).toEqual([other]));
    expect(await redeemTicket(mine, 7)).toBe(false);
  });
});
