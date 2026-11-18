// The tickets of the chat floating on a page. Its page (floating.html) is the extension's only
// web-accessible page, under a fixed URL (manifest), so any page can frame it or open it: the chat starts
// only in a page's frame, with a ticket the widget asked for (FRAME_TICKET), for its own tab, a moment
// before. The ticket is random, used once, for one tab and a short time; the chat's page redeems it
// (FRAME_REDEEM) before anything of it starts (entrypoints/sidepanel/ticket-gate). Kept in
// storage.session: a worker asleep between the two keeps them.
import { browser, type Browser } from 'wxt/browser';
import { floatingChatAvailable } from '../core/build';
import { onRuntime } from '../core/runtime';
import { senderOf } from '../core/sender';
import { isObject } from '../core/util';
import { storageRecord } from '../storage/area';
import { serialized } from '../storage/serial';
import { FRAME_REDEEM, FRAME_TICKET, FRAME_TICKETS } from '../widget/protocol';

// Long enough for a frame to load in a busy browser; a ticket is spent as soon as it has.
export const TICKET_MS = 2 * 60_000;
const MAX_TICKETS = 32; // the newest kept: a page asking again and again pushes out only its own
const TICKET = /^[0-9a-f]{64}$/;
interface Ticket {
  tab: number;
  expires: number;
}

const changing = serialized(FRAME_TICKETS);
const isTicket = (t: unknown): t is Ticket => isObject(t) && typeof t.tab === 'number' && typeof t.expires === 'number';
const unexpired = (all: Record<string, unknown>, now: number) =>
  Object.entries(all).filter((e): e is [string, Ticket] => TICKET.test(e[0]) && isTicket(e[1]) && e[1].expires > now);
const save = (tickets: [string, Ticket][]) => browser.storage.session.set({ [FRAME_TICKETS]: Object.fromEntries(tickets) });

// 256 random bits, as hex.
const randomTicket = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');

// A new ticket for the chat floating on that tab.
export const issueTicket = (tab: number, now = Date.now()): Promise<string> =>
  changing(async () => {
    const ticket = randomTicket();
    const kept = unexpired(await storageRecord<unknown>('session', FRAME_TICKETS), now).sort(([, a], [, b]) => b.expires - a.expires).slice(0, MAX_TICKETS - 1);
    await save([...kept, [ticket, { tab, expires: now + TICKET_MS }]]);
    return ticket;
  });

// Whether that ticket opens the chat in a frame of that tab: issued for it, unused, unexpired. Spent
// once asked for, whatever the answer: a ticket that leaked to another tab is of no use to it either.
export const redeemTicket = (ticket: unknown, tab: number, now = Date.now()): Promise<boolean> =>
  changing(async () => {
    if (typeof ticket !== 'string' || !TICKET.test(ticket)) return false;
    const all = await storageRecord<unknown>('session', FRAME_TICKETS);
    const found = Object.hasOwn(all, ticket) ? all[ticket] : undefined;
    const rest = unexpired(all, now).filter(([t]) => t !== ticket);
    await save(rest);
    return isTicket(found) && found.tab === tab && found.expires > now;
  });

// The floating chat's page in a frame (not a tab's top document: that one, opened by a page in a tab of
// its own, never redeems), whatever its query or fragment.
export const FLOATING_PAGE = '/floating.html';
const fromFloatingFrame = (sender: Browser.runtime.MessageSender) =>
  !!sender.frameId && typeof sender.url === 'string' && sender.url.split(/[?#]/, 1)[0] === browser.runtime.getURL(FLOATING_PAGE);

// Asked for by the widget only (a content script of this extension, in a tab's top frame); redeemed by
// the floating chat's page only, in a page's frame of the tab the ticket is for. A sender refused leaves
// the ticket as it was.
export function listenFrameTickets() {
  onRuntime(FRAME_TICKET, (_msg, sender) => {
    const tab = sender.tab?.id;
    if (!senderOf(sender).fromPage || tab === undefined || !floatingChatAvailable()) return;
    return issueTicket(tab).then((ticket) => ({ ticket }));
  });
  onRuntime(FRAME_REDEEM, (msg, sender) => {
    const tab = sender.tab?.id;
    if (!fromFloatingFrame(sender) || tab === undefined) return { shown: false };
    return redeemTicket(msg.ticket, tab).then((shown) => ({ shown }));
  });
  // A closed tab's tickets go with it (they would expire anyway).
  browser.tabs.onRemoved.addListener((tabId) => void changing(async () => {
    const all = unexpired(await storageRecord<unknown>('session', FRAME_TICKETS), Date.now());
    if (all.some(([, t]) => t.tab === tabId)) await save(all.filter(([, t]) => t.tab !== tabId));
  }).catch((e: unknown) => console.error('[frame tickets]', e)));
}
