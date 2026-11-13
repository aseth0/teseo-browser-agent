// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeStorage } from './fakes/browser';
import { pageBrowser, pageGlobals, settle } from './fakes/panel';
import type { WidgetActionInfo } from '../src/widget/protocol';

// The page widget's UI (entrypoints/page-widget, widget/ui) on a page, over a fake background: the
// bubble is built in a closed shadow root where the page has actions, unfolds them under the pointer,
// runs one only on the user's own click and shows its reply in its card, and hides and shows again on
// the site (the shortcut, Settings → Bubble from another page).
pageGlobals();
const storage = fakeStorage();
const fake = pageBrowser(storage);
vi.mock('wxt/browser', () => ({ browser: fake.browser }));
// A content script's entry is wrapped by WXT's global defineUnlistedScript: here, the function itself.
vi.stubGlobal('defineUnlistedScript', (main: () => void) => main);

// jsdom cannot make the user's own input (isTrusted): the widget's listeners, wrapped here, see the
// events a test marks as the user's (`asUser`) as trusted; any other, as a page's script made it.
const byUser = new WeakSet<Event>();
const wrapped = new WeakMap<object, EventListener>();
const add = EventTarget.prototype.addEventListener;
const remove = EventTarget.prototype.removeEventListener;
EventTarget.prototype.addEventListener = function (type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
  if (!listener) return;
  const call = typeof listener === 'function' ? listener : (e: Event) => listener.handleEvent(e);
  const trusting = (e: Event) => call.call(this, byUser.has(e) ? new Proxy(e, { get: (t, p) => (p === 'isTrusted' ? true : typeof Reflect.get(t, p) === 'function' ? Reflect.get(t, p).bind(t) : Reflect.get(t, p)) }) : e);
  wrapped.set(listener, trusting);
  add.call(this, type, trusting, options);
};
EventTarget.prototype.removeEventListener = function (type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
  if (listener) remove.call(this, type, wrapped.get(listener) ?? (listener as EventListener), options);
};
const asUser = (target: EventTarget, event: Event) => {
  byUser.add(event);
  target.dispatchEvent(event);
};

// What the widget leaves in the page: the storage listeners it adds (all of them removed after each
// test, so that a widget of a test before does not answer this one's changes), and the page watchers
// (MutationObserver) still observing.
const storageListeners = new Set<unknown>();
const addStorage = storage.onChanged.addListener;
const removeStorage = storage.onChanged.removeListener;
storage.onChanged.addListener = (l) => (storageListeners.add(l), addStorage(l));
storage.onChanged.removeListener = (l) => (storageListeners.delete(l), removeStorage(l));
const observing = new Set<MutationObserver>();
globalThis.MutationObserver = class extends MutationObserver {
  override observe(target: Node, options?: MutationObserverInit) {
    observing.add(this);
    super.observe(target, options);
  }
  override disconnect() {
    observing.delete(this);
    super.disconnect();
  }
};

// The shadow roots the widget makes, kept as the browser would show them to the user.
const roots: ShadowRoot[] = [];
const attach = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (init: ShadowRootInit) {
  const root = attach.call(this, init);
  roots.push(root);
  return root;
};

const { WIDGET_ACTIONS, WIDGET_FLOAT, WIDGET_PLACE, WIDGET_PLACES, WIDGET_RUN, WIDGET_TOGGLE } = await import('../src/widget/protocol');
const { changePlace } = await import('../src/widget/places');
const { default: widget } = (await import('../src/entrypoints/page-widget')) as unknown as { default: () => void };

const summarize: WidgetActionInfo = { id: 'a1', name: 'Summarize', icon: '📝', input: 'none' };
let actions: WidgetActionInfo[] = [];
// The background: the page's actions, and the places it keeps per site.
fake.sendMessage.mockImplementation(async (msg: unknown) => {
  const m = msg as { type: string; site?: string; patch?: object };
  if (m.type === WIDGET_ACTIONS) return { actions };
  if (m.type === WIDGET_PLACE) return changePlace(m.site!, m.patch!);
  return undefined;
});
const site = location.host;
const host = () => document.querySelector<HTMLElement>('html > :not(head):not(body)');
const hosts = () => [...document.querySelectorAll<HTMLElement>('html > :not(head):not(body)')];
const root = () => roots.at(-1)!;
async function load() {
  widget();
  await settle(20);
}
const tellWidget = (msg: object) => Promise.all(fake.runtime.onMessage.emit(msg, {}, () => undefined));

beforeEach(() => {
  storage.reset();
  actions = [summarize];
});
afterEach(() => {
  for (const h of hosts()) h.remove();
  fake.runtime.onMessage.listeners.clear(); // the widget of the page before
  for (const l of storageListeners) storage.onChanged.removeListener(l as never);
  observing.clear();
  fake.sendMessage.mockClear();
  document.body.replaceChildren();
  delete window.__browserAgentWidget;
  vi.useRealTimers();
});

describe('the page widget', () => {
  it('is built in a closed shadow root where the page has actions', async () => {
    await load();
    const el = host()!;
    expect(el).not.toBeNull();
    expect(el.shadowRoot).toBeNull(); // closed: the page cannot reach inside
    expect(root().mode).toBe('closed');
    expect(root().querySelector('[role="button"][aria-label="Agent"]')).not.toBeNull();
    expect([...root().querySelectorAll('.menu button')].map((b) => b.getAttribute('aria-label'))).toEqual(['Summarize', 'Open the chat here', 'Hide on this site']);
    expect(root().querySelector('.menu button[aria-label="Hide on this site"]')!.getAttribute('title')).toMatch(/nothing of the bubble runs here, not even its actions on page load/);
  });

  it('lays its actions out as Settings → Bubble → Actions says: by default square, in a column, icons, large', async () => {
    await load();
    const menu = root().querySelector<HTMLElement>('.menu')!;
    expect({ ...menu.dataset }).toEqual({ shape: 'square', layout: 'column', labels: 'icon', size: 'large' });
    expect(menu.classList.contains('up')).toBe(true); // the bubble starts at the bottom right
    expect([...menu.querySelectorAll('.act-name')].map((n) => n.textContent)).toEqual(['Summarize', 'Chat here']);
    await storage.local.set({ widgetSettings: { appearance: { actionsShape: 'circle', actionsLayout: 'arc', actionsLabels: 'name', actionsSize: 'small' } } });
    await settle(20);
    expect({ ...menu.dataset }).toEqual({ shape: 'circle', layout: 'arc', labels: 'icon', size: 'small' });
    const [first] = [...menu.querySelectorAll<HTMLElement>('.act')];
    expect(first!.style.getPropertyValue('--dx')).toBe('0px');
    expect(parseFloat(first!.style.getPropertyValue('--dy'))).toBeLessThan(0); // upward, toward the top first
  });

  it('none on a page without actions', async () => {
    actions = [];
    await load();
    expect(host()).toBeNull();
  });

  it('unfolds its actions while the pointer rests on it, and folds them once it leaves', async () => {
    await load();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const menu = root().querySelector<HTMLElement>('.menu')!;
    expect(menu.hidden).toBe(true);
    host()!.dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(150);
    expect(menu.hidden).toBe(false);
    host()!.dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(400);
    expect(menu.hidden).toBe(true);
  });

  it("runs an action on the user's click, not on a page's, and shows its reply in its card", async () => {
    await load();
    const button = root().querySelector<HTMLButtonElement>('.menu button[aria-label="Summarize"]')!;
    button.click(); // a page's script
    await settle();
    expect(fake.port(WIDGET_RUN)).toBeUndefined();
    asUser(button, new MouseEvent('click', { bubbles: true }));
    await settle();
    const port = fake.port(WIDGET_RUN)!;
    expect(port.posted).toEqual([expect.objectContaining({ type: WIDGET_RUN, id: 'a1', input: '' })]);
    const pop = root().querySelector<HTMLElement>('.pop')!;
    expect(pop.hidden).toBe(false);
    expect(pop.textContent).toContain('Running…');
    port.send({ type: 'delta', kind: 'text', text: 'Three points' });
    expect(pop.textContent).toContain('Three points');
    port.send({ type: 'reply', reply: { outputs: [{ label: 'Summary', lines: [{ text: 'Free shipping over 50' }, { text: 'Returns in 30 days' }] }] } });
    await settle();
    expect([...pop.querySelectorAll('.box li')].map((li) => li.textContent)).toEqual(['Free shipping over 50', 'Returns in 30 days']);
    expect(pop.querySelector('.box-label')!.textContent).toBe('Summary');
  });

  it('an error from the background shows in the card', async () => {
    await load();
    asUser(root().querySelector('.menu button[aria-label="Summarize"]')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    fake.port(WIDGET_RUN)!.send({ type: 'reply', reply: { error: 'The provider did not answer.' } });
    await settle();
    expect(root().querySelector('.pop .error')!.textContent).toBe('The provider did not answer.');
  });

  it("hidden on the site by the shortcut: nothing of it stays, kept for the site; a page's click on ✕ hides nothing", async () => {
    await load();
    root().querySelector<HTMLButtonElement>('.menu button[aria-label="Hide on this site"]')!.click(); // a page's script
    await settle();
    expect(host()!.style.display).toBe('');
    await tellWidget({ type: WIDGET_TOGGLE });
    await settle();
    expect(host()).toBeNull();
    expect((storage.local.data[WIDGET_PLACES] as Record<string, { hidden?: boolean }>)[site]!.hidden).toBe(true);
    expect(fake.runtime.onMessage.listeners.size).toBe(0); // the shortcut comes back through the background
    expect(storageListeners.size).toBe(0);
    expect(window.__browserAgentWidget).toBe(false); // the background may put it here again
  });
});

// Hidden on a site with its ✕: nothing of the bubble loads there, until it is called back (the
// background then puts the widget into the page again, as it does here with `widget()`).
describe('the page widget hidden on the site', () => {
  const counter: WidgetActionInfo = { id: 'w1', name: 'Comments', input: 'none', load: true, reads: { n: '{{selector:.count}}' } };
  const runs = () => fake.ports.filter((p) => p.name === WIDGET_RUN);
  const asked = () => fake.sendMessage.mock.calls.map(([m]) => (m as { type: string }).type).filter((t) => t !== WIDGET_PLACE);
  const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);
  beforeEach(() => {
    fake.ports.length = 0;
    document.body.innerHTML = '<span class="count">3</span>';
    actions = [counter, summarize];
  });

  it.each([
    ['as this build keeps it', { hidden: true }],
    ["as an older build keeps it, with its other fields", { x: 40, y: 60, pinned: true, width: 320, height: 240, chat: { x: 1, y: 2, width: 400, height: 500 }, hidden: true }],
  ])('a page loaded there builds nothing, asks nothing and runs no action (%s)', async (_, place) => {
    await changePlace(site, place);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    widget();
    await tick(15 * 60_000);
    document.body.append('more of the page');
    await tick(15 * 60_000);
    expect(hosts()).toEqual([]);
    expect(asked()).toEqual([]);
    expect(runs()).toEqual([]);
    expect(fake.runtime.onMessage.listeners.size).toBe(0);
    expect(storageListeners.size).toBe(0);
    expect(observing.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(window.__browserAgentWidget).toBe(false);
  });

  it("hidden with its ✕ on an open page: the watched action in flight is stopped, and nothing of it is left", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    widget();
    await tick(20);
    expect(observing.size).toBe(1); // waiting for the page's values as they change
    await tick(1000);
    const run = runs()[0]!;
    expect(run.posted).toEqual([expect.objectContaining({ type: WIDGET_RUN, id: 'w1' })]);
    expect(run.disconnected).toBe(false);
    asUser(root().querySelector('.menu button[aria-label="Hide on this site"]')!, new MouseEvent('click', { bubbles: true }));
    await tick(0);
    expect(run.disconnected).toBe(true); // the background's run is aborted with its port
    expect(hosts()).toEqual([]);
    expect(observing.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(fake.runtime.onMessage.listeners.size).toBe(0);
    expect(storageListeners.size).toBe(0);
    fake.sendMessage.mockClear();
    document.querySelector('.count')!.textContent = '4';
    history.pushState({}, '', '/another-page');
    await tick(15 * 60_000);
    expect(asked()).toEqual([]);
    expect(runs()).toEqual([run]);
    history.pushState({}, '', '/');
  });

  it('called back, it starts as on a fresh page: its on-load actions run once', async () => {
    await changePlace(site, { hidden: true });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    widget();
    await tick(5000);
    expect(runs()).toEqual([]);
    await changePlace(site, { hidden: false }); // Settings → Bubble's Show, or the shortcut, in the background
    widget(); // which puts the widget into the site's open tabs
    await tick(20);
    expect(host()!.style.display).toBe('');
    await tick(1000);
    expect(runs()).toHaveLength(1);
    runs()[0]!.send({ type: 'reply', reply: { badge: '3', outputs: [] } });
    await tick(10 * 60_000);
    expect(runs()).toHaveLength(1);
    expect(root().querySelector('.count')!.textContent).toBe('3');
  });

  it('hidden from another tab of the site, or Settings → Bubble: there and then, nothing of it is left', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    widget();
    await tick(1020);
    runs()[0]!.send({ type: 'reply', reply: { badge: '3', outputs: [] } });
    await changePlace(site, { hidden: true }); // from another tab of the site
    await tick(0);
    expect(hosts()).toEqual([]);
    expect(fake.runtime.onMessage.listeners.size).toBe(0);
  });

  it('a chat floating on the page stays, unfolded, until it is closed: then the rest goes', async () => {
    await load();
    asUser(root().querySelector('.menu button[aria-label="Open the chat here"]')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(hosts()).toHaveLength(2);
    const chatRoot = root();
    expect(chatRoot.querySelector('iframe')).not.toBeNull();
    asUser(chatRoot.querySelector('button[aria-label^="Fold it"]')!, new MouseEvent('click', { bubbles: true }));
    await tellWidget({ type: WIDGET_TOGGLE });
    await settle();
    const [chat] = hosts();
    expect(hosts()).toHaveLength(1); // the bubble went
    expect(chat!.style.display).toBe('block'); // unfolded: no bubble to bring it back
    fake.sendMessage.mockClear();
    await settle(1100);
    expect(asked()).toEqual([]); // its actions are not asked any more
    asUser(chatRoot.querySelector('button[aria-label^="Close it"]')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(hosts()).toEqual([]);
    expect(fake.runtime.onMessage.listeners.size).toBe(0);
    expect(storageListeners.size).toBe(0);
  });

  it('floating the chat there calls the bubble back', async () => {
    await load();
    asUser(root().querySelector('.menu button[aria-label="Open the chat here"]')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    await tellWidget({ type: WIDGET_TOGGLE }); // hidden, the chat stays
    await settle();
    expect(await tellWidget({ type: WIDGET_FLOAT })).toBeDefined();
    await settle();
    expect((storage.local.data[WIDGET_PLACES] as Record<string, { hidden?: boolean }>)[site]!.hidden).toBe(false);
    expect(hosts()).toHaveLength(2); // the bubble back beside the chat
  });
});
