// Where the chat app may start, before anything of it loads (its modules imported only once it may:
// entrypoints/sidepanel/main, entrypoints/floating/main).
// - floating.html, the chat floating on a page: the only extension page a web page can load
//   (web-accessible, manifest). It starts only in a web page's frame, with a ticket the background
//   redeems (background/frame-tickets): the one the page widget asked for and put in the frame's URL
//   fragment. Opened in a tab of its own, or framed with no ticket or a bad one, it stays an empty
//   document: no chat, no settings, no listeners.
// - sidepanel.html, every other chat (the side panel, full screen in a tab, the agent manager's, the
//   Appearance preview): not web-accessible, so no web page can frame it; were one to, it would not start.
import { sendRuntime } from '../../core/runtime';
import { framedByPage } from '../../ui/framed-by-page';
import { FRAME_REDEEM, FRAME_TICKET_PARAM } from '../../widget/protocol';

// The ticket in a URL's fragment (`#ticket=…`), if any.
export const ticketOf = (hash: string) => new URLSearchParams(hash.replace(/^#/, '')).get(FRAME_TICKET_PARAM) || undefined;

// Whether the floating chat may show: framed by a web page, and its ticket redeemed now. Any failure
// (not framed, no ticket, refused, a browser that gives the frame no extension API, as Firefox): not.
export async function mayFloat(framed: boolean, hash: string, redeem: (ticket: string) => Promise<{ shown: boolean } | undefined>): Promise<boolean> {
  if (!framed) return false;
  const ticket = ticketOf(hash);
  if (!ticket) return false;
  try {
    return (await redeem(ticket))?.shown === true;
  } catch {
    return false;
  }
}

const redeem = (ticket: string) => sendRuntime({ type: FRAME_REDEEM, ticket });

// The chat started (`load`: its modules imported and rendered) once it may show; else nothing at all.
export async function startChat(load: () => Promise<unknown>, show: () => Promise<boolean>): Promise<boolean> {
  if (!(await show())) return false;
  await load();
  return true;
}

// floating.html's chat: only as mayFloat says.
export const startFloating = (load: () => Promise<unknown>, show = () => mayFloat(framedByPage(window), location.hash, redeem)) => startChat(load, show);
// sidepanel.html's: anywhere but in a web page's frame (a second line: no web page can frame it).
export const startPanel = (load: () => Promise<unknown>, framed = () => framedByPage(window)) => startChat(load, async () => !framed());
