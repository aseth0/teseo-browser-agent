import { describe, expect, it, vi } from 'vitest';
import { fakeEvent } from './fakes/browser';

// The page widget tells the background whether the chat floats on its page: the background keeps it
// at hand (background/floating-tabs) for a capture's shortcut.
const open = vi.fn(async (_o: unknown) => undefined);
const onMessage = fakeEvent<(msg: unknown, sender: unknown, reply: (r: unknown) => void) => unknown>();
const event = () => fakeEvent();
const stored: Record<string, unknown> = { 'floating:7': {} };
vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { onMessage, onInstalled: event(), getURL: (p: string) => `chrome-extension://ext${p}` },
    permissions: { onAdded: event(), onRemoved: event() },
    storage: {
      onChanged: event(),
      session: { get: async (key: string) => (key in stored ? { [key]: stored[key] } : {}), set: async () => undefined, remove: async () => undefined },
    },
    commands: { onCommand: event() },
    tabs: { onRemoved: event() },
    sidePanel: { open },
  },
}));
let saved: object[] = []; // the actions saved (Settings → Actions)
vi.mock('../src/widget/store', () => ({ syncWidgetScript: async () => undefined, actionStore: { load: async () => saved }, bubbleEverywhere: () => false }));
vi.mock('../src/page/granted', () => ({ grantedOneByOne: async () => [] }));
vi.mock('../src/agents/profiles', () => ({ agentStore: { load: async () => [], onChanged: () => undefined } }));
vi.mock('../src/background/settings', () => ({ settingsNow: async () => ({}) }));
vi.mock('../src/background/panel-mode', () => ({ panelFollowsNow: () => true }));
let shown = false; // the window's side panel shows, where opening it would close it (background/panel-windows)
vi.mock('../src/background/panel-windows', () => ({ panelShownIn: (windowId: number) => shown && windowId === 2 }));
const markFloating = vi.fn();
vi.mock('../src/background/floating-tabs', () => ({ markFloating }));
const changePlace = vi.fn(async (_site: string, patch: object) => patch);
vi.mock('../src/widget/places', async (original) => ({ ...(await original<typeof import('../src/widget/places')>()), changePlace }));
const { hostWidget } = await import('../src/background/widget-host');
const { WIDGET_ACTIONS, WIDGET_FLOATING, WIDGET_OPEN_CHAT, WIDGET_PLACE } = await import('../src/widget/protocol');

hostWidget(() => undefined);
const fromPage = { tab: { id: 7, url: 'https://shop.example.com/' }, frameId: 0, url: 'https://shop.example.com/' };
const ask = (msg: unknown) => new Promise((resolve) => onMessage.emit(msg, fromPage, resolve));

describe('the widget says the chat floats on its page', () => {
  it('when it asks for its actions with the chat floating there', async () => {
    expect(await ask({ type: WIDGET_ACTIONS })).toMatchObject({ floating: true });
    expect(markFloating).toHaveBeenCalledWith(7, true);
  });
  it('when the chat opens or closes there', async () => {
    markFloating.mockClear();
    await ask({ type: WIDGET_FLOATING, open: true });
    expect(markFloating).toHaveBeenLastCalledWith(7, true);
    await ask({ type: WIDGET_FLOATING, open: false });
    expect(markFloating).toHaveBeenLastCalledWith(7, false);
  });
});

describe('the actions beside a selection', () => {
  it('marked only on those of the page that show there: on a click, taking a text or the selection', async () => {
    const { newAction } = await import('../src/widget/actions');
    const act = (id: string, more: object) => ({ ...newAction(), id, name: id, tool: 't', where: ['https://shop.example.com/*'], ...more });
    saved = [act('sel', { input: 'selection', besideSelection: true }), act('text', { besideSelection: true }), act('none', { input: 'none', besideSelection: true }),
      act('plain', {}), act('elsewhere', { where: ['https://other.example.com/*'], besideSelection: true }), act('off', { enabled: false, besideSelection: true })];
    const { actions } = (await ask({ type: WIDGET_ACTIONS })) as { actions: { id: string; besideSelection?: boolean }[] };
    saved = [];
    expect(actions.map((a) => [a.id, !!a.besideSelection])).toEqual([['sel', true], ['text', true], ['none', false], ['plain', false]]);
  });
});

describe("the bubble's open chat", () => {
  const bubble = { tab: { id: 7, windowId: 2, url: 'https://shop.example.com/' }, frameId: 0, url: 'https://shop.example.com/' };
  const openChat = () => new Promise((resolve) => onMessage.emit({ type: WIDGET_OPEN_CHAT }, bubble, resolve));
  it("opens the window's side panel inside the click", async () => {
    expect(await openChat()).toEqual({ opened: true });
    expect(open).toHaveBeenCalledWith({ windowId: 2 });
  });
  it('leaves it open where it shows already and opening it would close it (Vivaldi)', async () => {
    open.mockClear();
    shown = true;
    expect(await openChat()).toEqual({ opened: true });
    expect(open).not.toHaveBeenCalled();
    shown = false;
  });
});

describe("a widget's place", () => {
  const place = (site: string, sender: unknown = fromPage) => onMessage.emit({ type: WIDGET_PLACE, site, patch: { hidden: true } }, sender, () => undefined);
  it("changes for its own page's site", () => {
    changePlace.mockClear();
    place('shop.example.com');
    expect(changePlace).toHaveBeenCalledWith('shop.example.com', { hidden: true });
  });
  it('not for another site than the page that asks', () => {
    changePlace.mockClear();
    place('bank.example.com');
    place('');
    place('shop.example.com', { tab: { id: 7 }, frameId: 0 }); // no page address known
    expect(changePlace).not.toHaveBeenCalled();
  });
});
