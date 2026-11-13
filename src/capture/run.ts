// A screenshot started from the toolbar popup or a keyboard shortcut (background/capture-host), into the
// chat: the one floating on the tab, or else the side panel, opened first in the pin's mode. The page
// widget is hidden while it captures; the images, made smaller, are handed to that chat's message box
// (CHAT_ATTACH), not sent. A Section is dragged on the page as it is (capture/area), the side panel
// opened only once it is captured, from the page (capture/page askToOpenChat); a Full page is captured on
// the DevTools engine when it is on, else scrolled through a viewport at a time, and cut into parts an
// attached image can show, as many as a message takes.
import { browser } from 'wxt/browser';
import { bestEffort, errorText } from '../core/errors';
import { shrinkImage } from '../core/image';
import { limit } from '../core/limits';
import { sendTab } from '../core/runtime';
import { openSidePanel } from '../core/side-panel';
import { sleep } from '../core/util';
import { withDebugger } from '../devtools/cdp';
import { hasEverySite } from '../page/granted';
import { CAPTURE_OPEN_CHAT } from '../core/protocol';
import { handoff, type HandoffTo } from '../core/handoff';
import { WIDGET_FLOAT, WIDGET_HIDE } from '../widget/protocol';
import { crop, dragArea, type Area } from './area';
import { askToOpenChat, layoutSettled, noticeInPage, pageMetrics, scrollPageTo } from './page';
import { chatTarget, leftOutNote, pagePlan } from './plan';
import { CHAT_ATTACH, type CaptureKind, type ImagesPayload } from './protocol';

type Tab = { id: number; windowId: number };
// What the background gives it (background/capture-host): whether the chat floats on a tab
// (background/floating-tabs), the pin's mode (background/panel-mode), whether a window's side panel
// shows (background/panel-windows), and the settings as the worker applies them (background/settings).
export interface CaptureDeps {
  floatingNow: (tabId: number) => boolean;
  panelFollowsNow: () => boolean | undefined;
  panelShownIn: (windowId: number) => boolean;
  settingsNow: () => Promise<unknown>;
}
// What a capture got: its images, and a note on what it left out.
type Shot = { images: Blob[]; note?: string };

// The browser takes about two captures of the visible tab a second (MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND).
const CAPTURE_GAP_MS = 550;

// The tabs being captured: a capture pressed again meanwhile is ignored (two would scroll the page at once).
const running = new Set<number>();

// Started by a key set in Settings → Shortcuts (shortcuts/keys), which grants no activeTab as the
// browser's shortcut does: the visible tab is captured only with access to every site.
type How = { pageKey?: boolean };
const NO_ACCESS = "A key set in Settings → Shortcuts captures only with access to every site (Settings → Website access). Use the browser's shortcut instead, or allow every site.";

// Inside the click or the shortcut: nothing is awaited before the side panel opens. Not for a section,
// which the panel would narrow the page under before it is dragged: the page asks for it after. Nor
// where it shows already and opening it would close it (background/panel-windows).
export function startCapture(kind: CaptureKind, tab: Tab, how: How, deps: CaptureDeps): Promise<void> {
  if (running.has(tab.id)) return Promise.resolve();
  running.add(tab.id);
  const follows = deps.panelFollowsNow();
  const { panel, to } = chatTarget(tab.id, deps.floatingNow(tab.id), follows);
  const first = panel && kind !== 'section' && !(follows !== false && deps.panelShownIn(tab.windowId));
  const opened = first ? openSidePanel(tab, follows, false, 'capture').catch((e: unknown) => console.error('[capture]', e)) : Promise.resolve();
  return opened.then(() => captureInto(kind, tab, to, first, how, deps)).finally(() => running.delete(tab.id));
}

// `opened`: the side panel opened for it, which narrows the page: captured once its layout settled.
// Without the access it needs, nothing is captured: the chat says why, or the page does for a section
// (no chat could be opened for it there, the key's gesture gone).
async function captureInto(kind: CaptureKind, tab: Tab, to: HandoffTo, opened: boolean, how: How, deps: CaptureDeps) {
  if (how.pageKey && !(await hasEverySite())) {
    if (kind === 'section' && to.tab === undefined) return void (await bestEffort(inPage(tab.id, noticeInPage, NO_ACCESS), 'capture'));
    return handOver(tab.id, to, { images: [], note: NO_ACCESS });
  }
  let attach: Omit<ImagesPayload, 'kind'>;
  let area: Area | null = null;
  if (opened) await inPage(tab.id, layoutSettled).catch(() => undefined); // no access: the capture says why
  await hideWidget(tab.id, true);
  try {
    await deps.settingsNow(); // the limits as set
    if (kind === 'section' && !(area = await inPage(tab.id, dragArea))) return; // cancelled
    const shot = area ? { images: [await crop(await visible(tab), area)] } : await shoot(kind, tab);
    attach = { images: await Promise.all(shot.images.map((b) => shrinkImage(b, limit('imageSize')))), ...(shot.note && { note: shot.note }) };
  } catch (e) {
    attach = { images: [], note: `Could not capture the page (${errorText(e)}).` };
  } finally {
    await hideWidget(tab.id, false);
  }
  await handOver(tab.id, to, attach);
  // The side panel opened from the page, while the drag's gesture lasts, or else from a button by the section.
  if (to.tab === undefined && area) await bestEffort(inPage(tab.id, askToOpenChat, CAPTURE_OPEN_CHAT, area), 'capture');
}

// To the chat that is to attach it; the one floating on the page shown, unfolded, with what it got.
async function handOver(tabId: number, to: HandoffTo, attach: Omit<ImagesPayload, 'kind'>) {
  await browser.storage.session.set({ [CHAT_ATTACH]: handoff<ImagesPayload>({ kind: 'images', ...attach }, to) });
  if (to.tab !== undefined) await bestEffort(sendTab(tabId, { type: WIDGET_FLOAT }), 'capture');
}

// The bubble and the floating chat off the page while it is captured (answered once painted so); no
// widget there, nothing to hide.
const hideWidget = (tabId: number, hidden: boolean) => sendTab(tabId, { type: WIDGET_HIDE, hidden }).catch(() => undefined);

// The visible part, or the whole page (a section is dragged first: captureInto).
const shoot = async (kind: CaptureKind, tab: Tab): Promise<Shot> => (kind === 'full-page' ? fullPage(tab) : { images: [await visible(tab)] });

const visible = async (tab: Tab) => (await fetch(await browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' }))).blob();

async function inPage<A extends unknown[], R>(tabId: number, func: (...args: A) => R, ...args: A): Promise<Awaited<R>> {
  const [run] = await browser.scripting.executeScript({ target: { tabId }, func, args });
  return run?.result as Awaited<R>;
}

// The whole page, top to bottom, in parts of a viewport each: as many as a message takes images.
async function fullPage(tab: Tab): Promise<Shot> {
  const page = await inPage(tab.id, pageMetrics);
  const room = limit('imagesPerMessage');
  const plan = pagePlan(page.height, page.viewport, room);
  const note = plan.leftOut ? leftOutNote(plan.leftOut, room) : undefined;
  const part = (top: number, y = top) => ({ x: 0, y, width: page.width, height: Math.min(page.viewport, page.height - top), viewport: page.width });
  const images = await onEngine(tab.id, page, plan.tops, part).catch(() => stitched(tab, page.y, plan.tops, part));
  return { images, ...(note && { note }) };
}

type Part = (top: number, y?: number) => { x: number; y: number; width: number; height: number; viewport: number };

// On the DevTools engine (on in Settings, or it fails): the page down to the last part in one capture,
// then cut. The user's own capture, seen before it is sent: not masked, as the paperclip's is not.
async function onEngine(tabId: number, page: { width: number; height: number }, tops: number[], part: Part): Promise<Blob[]> {
  const bottom = Math.min(page.height, (tops.at(-1) ?? 0) + part(tops.at(-1) ?? 0).height);
  const clip = { x: 0, y: 0, width: page.width, height: bottom, scale: 1 };
  const { data } = await withDebugger(tabId, (s) => s.send<{ data: string }>('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip }));
  const shot = await (await fetch(`data:image/png;base64,${data}`)).blob();
  return Promise.all(tops.map((top) => crop(shot, part(top))));
}

// Scrolled a viewport at a time, captured at each stop, then scrolled back. Where the page ends before
// a part's top, the part keeps only what the one before did not show.
async function stitched(tab: Tab, back: number, tops: number[], part: Part): Promise<Blob[]> {
  const images: Blob[] = [];
  try {
    for (const top of tops) {
      if (images.length) await sleep(CAPTURE_GAP_MS);
      const at = await inPage(tab.id, scrollPageTo, top);
      const shot = await visible(tab);
      images.push(at < top ? await crop(shot, part(top, top - at)) : shot);
    }
  } finally {
    await inPage(tab.id, scrollPageTo, back).catch(() => undefined);
  }
  return images;
}
