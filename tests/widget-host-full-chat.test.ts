import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeEvent } from './fakes/browser';

// Where the chat cannot float on a page (Firefox's build: core/build floatingChat), whatever opens the
// chat from the page (the bubble, an action that opens the chat, a card's "Open in the chat", the
// floating chat's shortcut) opens it full screen in a tab, through the background, with what it carries
// addressed to that chat: never the frame, which would lack the APIs the chat needs, nor the sidebar,
// which the browser opens only from a click in the extension's own pages.
vi.stubGlobal('__FIREFOX__', true);
const sidePanelOpen = vi.fn(async (_o: unknown) => undefined);
const onMessage = fakeEvent<(msg: unknown, sender: unknown, reply: (r: unknown) => void) => unknown>();
const event = () => fakeEvent();
const session: Record<string, unknown> = {};
const sendTab = vi.fn(async (_id: number, _m: unknown) => undefined);
vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { onMessage, onInstalled: event(), getURL: (p: string) => `moz-extension://ext${p}` },
    permissions: { onAdded: event(), onRemoved: event() },
    storage: {
      onChanged: event(),
      session: {
        get: async (key: string | string[]) => Object.fromEntries([key].flat().filter((k) => k in session).map((k) => [k, session[k]])),
        set: async (items: Record<string, unknown>) => void Object.assign(session, items),
        remove: async () => undefined,
      },
    },
    commands: { onCommand: event() },
    tabs: { onRemoved: event(), sendMessage: sendTab, query: async () => [{ id: 7, windowId: 2, url: 'https://shop.example.com/' }] },
    sidebarAction: { open: sidePanelOpen }, // Firefox's sidebar, never opened from a page
  },
}));
const openFullChat = vi.fn(async () => undefined);
vi.mock('../src/browser/open-manager', () => ({ openFullChat }));
const shortcut = vi.hoisted(() => ({ listener: undefined as undefined | ((command: string) => void) }));
vi.mock('../src/background/shortcuts', () => ({ onShortcut: (l: (command: string) => void) => void (shortcut.listener = l) }));
let saved: object[] = [];
vi.mock('../src/widget/store', () => ({ syncWidgetScript: async () => undefined, actionStore: { load: async () => saved }, bubbleEverywhere: () => false }));
vi.mock('../src/page/granted', () => ({ grantedOneByOne: async () => [] }));
vi.mock('../src/agents/profiles', () => ({ agentStore: { load: async () => [], onChanged: () => undefined } }));
vi.mock('../src/background/settings', () => ({ settingsNow: async () => ({}) }));
vi.mock('../src/background/panel-mode', () => ({ panelFollowsNow: () => true }));
vi.mock('../src/background/panel-windows', () => ({ panelShownIn: () => false }));
vi.mock('../src/background/floating-tabs', () => ({ markFloating: vi.fn() }));
const { hostWidget } = await import('../src/background/widget-host');
const { CHAT_HANDOFF, FLOATING_PREFIX, FLOAT_COMMAND, WIDGET_ACTIONS, WIDGET_CHATS, WIDGET_OPEN_CHAT } = await import('../src/widget/protocol');
const { newAction } = await import('../src/widget/actions');

hostWidget(() => undefined);
const fromPage = { tab: { id: 7, windowId: 2, url: 'https://shop.example.com/' }, frameId: 0, url: 'https://shop.example.com/' };
const ask = (msg: unknown) => new Promise((resolve) => onMessage.emit(msg, fromPage, resolve));
const settle = () => new Promise((r) => setTimeout(r, 10));
const handed = () => session[CHAT_HANDOFF] as { full?: true; tab?: number; panelTab?: number; payload: { messages: unknown[]; send?: string } } | undefined;

beforeEach(() => {
  for (const k of Object.keys(session)) delete session[k];
  vi.clearAllMocks();
});

describe('where the chat cannot float, the page opens it full screen', () => {
  it('the bubble: the full-screen chat, never the sidebar', async () => {
    expect(await ask({ type: WIDGET_OPEN_CHAT })).toEqual({ opened: true });
    expect(openFullChat).toHaveBeenCalledTimes(1);
    expect(sidePanelOpen).not.toHaveBeenCalled();
    expect(handed()).toBeUndefined();
  });
  it('asked to float there (a widget of an older settings copy): the same', async () => {
    expect(await ask({ type: WIDGET_OPEN_CHAT, floating: true })).toEqual({ opened: true });
    expect(openFullChat).toHaveBeenCalledTimes(1);
  });
  it("a card's Open in the chat: its conversation goes to the full-screen chat", async () => {
    session[WIDGET_CHATS] = { c1: { messages: [{ role: 'user', content: 'hi' }], at: Date.now() } };
    await ask({ type: WIDGET_OPEN_CHAT, chat: 'c1' });
    await settle();
    expect(handed()).toMatchObject({ full: true, payload: { kind: 'conversation', messages: [{ role: 'user', content: 'hi' }] } });
    expect(handed()).not.toHaveProperty('tab');
    expect(handed()).not.toHaveProperty('panelTab');
  });
  it('an action that opens the chat: its message, sent there', async () => {
    saved = [{ ...newAction(), id: 'a2', name: 'Ask', input: 'none', openChat: true, prompt: 'Explain this page', where: ['https://shop.example.com/*'] }];
    await ask({ type: WIDGET_OPEN_CHAT, action: { id: 'a2', input: '' } });
    await settle();
    saved = [];
    expect(handed()).toMatchObject({ full: true, payload: { kind: 'conversation', messages: [] } });
    expect(handed()!.payload.send).toContain('Explain this page');
  });
  it('the floating chat\'s shortcut: the full-screen chat, nothing sent to the page', async () => {
    shortcut.listener!(FLOAT_COMMAND);
    await settle();
    expect(openFullChat).toHaveBeenCalledTimes(1);
    expect(sendTab).not.toHaveBeenCalled();
  });
  it('a page reloaded where the chat floated is not told to open it again', async () => {
    session[FLOATING_PREFIX + 7] = {};
    expect(await ask({ type: WIDGET_ACTIONS })).not.toHaveProperty('floating');
  });
});
