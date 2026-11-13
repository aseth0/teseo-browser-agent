// The browser an extension page sees (the side panel, Options, the Agents Panel), over the shared fake
// storage: one normal window with one tab on a granted site, a runtime whose ports the test answers as
// the background would, and the events a page listens to, kept for the test to fire.
import { vi } from 'vitest';
import { fakeBrowser, fakeEvent, type FakeStorage } from './browser';

export interface FakeTab {
  id: number;
  windowId: number;
  url: string;
  title?: string;
  active?: boolean;
}

// A port the page opened (runtime.connect): what it posted, and the background's side of it.
export interface PagePort {
  name: string;
  posted: unknown[];
  disconnected: boolean;
  postMessage(msg: unknown): void;
  disconnect(): void;
  onMessage: ReturnType<typeof fakeEvent>;
  onDisconnect: ReturnType<typeof fakeEvent>;
  send(event: unknown): void; // the background posts it to the page
  lose(): void; // the background went away (the service worker died)
}

export function pageBrowser(storage: FakeStorage, opts: { tabs?: FakeTab[]; granted?: string[] } = {}) {
  const tabs: FakeTab[] = opts.tabs ?? [{ id: 1, windowId: 1, url: 'https://shop.example.com/a', title: 'Shop', active: true }];
  const granted = new Set(opts.granted ?? ['<all_urls>']);
  const ports: PagePort[] = [];
  const connect = ({ name }: { name: string }) => {
    const port: PagePort = {
      name,
      posted: [],
      disconnected: false,
      postMessage(msg) {
        if (port.disconnected) throw new Error('Attempting to use a disconnected port object');
        port.posted.push(structuredClone(msg));
      },
      disconnect() {
        port.disconnected = true;
      },
      onMessage: fakeEvent(),
      onDisconnect: fakeEvent(),
      send: (event) => void port.onMessage.emit(structuredClone(event)),
      lose() {
        port.disconnected = true;
        port.onDisconnect.emit(port);
      },
    };
    ports.push(port);
    return port;
  };
  const tab = (id: number) => tabs.find((t) => t.id === id);
  const sendMessage = vi.fn(async (_msg: unknown): Promise<unknown> => undefined);
  // The page's runtime: its messages to the background (sendMessage) and from it (onMessage.emit).
  const runtime = {
    id: 'extension-id',
    connect,
    sendMessage,
    getURL: (path: string) => `chrome-extension://extension-id${path.startsWith('/') ? '' : '/'}${path}`,
    getManifest: () => ({ version: '1.0.0', manifest_version: 3 }),
    getContexts: async () => [],
    openOptionsPage: vi.fn(async () => undefined),
    onMessage: fakeEvent<(msg: unknown, sender: object, reply: (r: unknown) => void) => unknown>(),
    onConnect: fakeEvent(),
  };
  const browser = fakeBrowser(storage, {
    runtime,
    tabs: {
      get: async (id: number) => {
        const t = tab(id);
        if (!t) throw new Error(`No tab with id: ${id}.`);
        return { ...t };
      },
      query: async (q: { active?: boolean } = {}) => tabs.filter((t) => q.active === undefined || !!t.active === q.active).map((t) => ({ ...t })),
      getCurrent: async () => undefined,
      create: vi.fn(async (props: { url?: string }) => ({ id: 99, windowId: 1, url: props.url })),
      update: vi.fn(async (id: number) => tab(id)),
      sendMessage: vi.fn(async () => undefined),
      onActivated: fakeEvent(),
      onUpdated: fakeEvent(),
      onRemoved: fakeEvent(),
      onCreated: fakeEvent(),
    },
    windows: {
      getLastFocused: async () => ({ id: 1, type: 'normal', tabs: tabs.map((t) => ({ ...t })) }),
      getAll: async () => [{ id: 1, type: 'normal' }],
      update: vi.fn(async () => undefined),
      onFocusChanged: fakeEvent(),
      onRemoved: fakeEvent(),
    },
    permissions: {
      contains: async ({ origins = [] }: { origins?: string[] }) => granted.has('<all_urls>') || origins.every((o) => granted.has(o)),
      request: vi.fn(async ({ origins = [] }: { origins?: string[] }) => (origins.forEach((o) => granted.add(o)), true)),
      remove: vi.fn(async () => true),
      getAll: async () => ({ origins: [...granted], permissions: [] }),
      onAdded: fakeEvent(),
      onRemoved: fakeEvent(),
    },
    sidePanel: { open: vi.fn(async () => undefined), setOptions: vi.fn(async () => undefined), setPanelBehavior: vi.fn(async () => undefined) },
    commands: { getAll: async () => [] },
    tabCapture: {}, // present: the popup offers a tab's audio
    offscreen: {},
    identity: { getRedirectURL: (path = '') => `https://extension-id.chromiumapp.example/${path}` },
    bookmarks: { getTree: async () => [], onCreated: fakeEvent(), onRemoved: fakeEvent(), onChanged: fakeEvent(), onMoved: fakeEvent() },
  });
  // The last port the page opened by that name.
  const port = (name: string) => ports.filter((p) => p.name === name).at(-1);
  return { browser, runtime, ports, port, tabs, granted, sendMessage };
}

// What a page's UI calls that jsdom lacks: media queries (none match), size observers (never report),
// and scrolling (nothing to scroll).
export function pageGlobals() {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.scrollTo ??= function () {};
  Element.prototype.scrollIntoView ??= function () {};
}

// What a user does on a rendered page, and what a test waits for: typing sets the value as the browser
// does (React sees an input event), a button is found by its text or its accessible name.
export async function typeInto(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const { act } = await import('react');
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
export const buttonNamed = (root: ParentNode, name: string) =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === name || b.getAttribute('aria-label') === name);
// Lets the promises and timers of a few ticks run (storage reads, a port's replies).
export async function settle(ms = 10) {
  const { act } = await import('react');
  await act(async () => new Promise((r) => setTimeout(r, ms)));
}
