// In-memory stand-ins for the parts of `browser` and `fetch` the tests need. Storage behaves like
// the real one: values are copied in and out, missing keys are left out of a read, and a write tells
// the onChanged listeners (with the old and the new value).
import { vi } from 'vitest';

type AreaName = 'local' | 'session' | 'sync';
type Change = { oldValue?: unknown; newValue?: unknown };
type Listener = (changes: Record<string, Change>, area: AreaName) => void;
type Keys = string | string[] | Record<string, unknown> | null | undefined;

export interface FakeAreaOptions {
  delayMs?: number; // each read waits this long after reading, so what it read may change meanwhile
}

export interface FakeArea {
  data: Record<string, unknown>; // what is stored, to look at or set directly (no listeners told)
  get(keys?: Keys): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  clear(): Promise<void>;
  getBytesInUse(keys?: string | string[] | null): Promise<number>;
}

export interface FakeStorage {
  local: FakeArea;
  session: FakeArea;
  sync: FakeArea;
  onChanged: { addListener(l: Listener): void; removeListener(l: Listener): void; hasListener(l: Listener): boolean };
  reset(): void; // empties every area
}

export function fakeStorage(opts: FakeAreaOptions = {}): FakeStorage {
  const listeners = new Set<Listener>();
  const tell = (area: AreaName, changes: Record<string, Change>) => {
    if (Object.keys(changes).length) for (const l of [...listeners]) l(changes, area);
  };
  const area = (name: AreaName): FakeArea => {
    const data: Record<string, unknown> = {};
    const names = (keys: Keys) => (keys == null ? Object.keys(data) : typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys));
    return {
      data,
      async get(keys) {
        const defaults = keys && typeof keys === 'object' && !Array.isArray(keys) ? keys : {};
        const out = Object.fromEntries(names(keys).flatMap((k) => (k in data ? [[k, structuredClone(data[k])]] : k in defaults ? [[k, defaults[k]]] : [])));
        if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
        return out;
      },
      async set(items) {
        const changes: Record<string, Change> = {};
        for (const [k, v] of Object.entries(items)) {
          changes[k] = { oldValue: data[k], newValue: structuredClone(v) };
          data[k] = structuredClone(v);
        }
        tell(name, changes);
      },
      async remove(keys) {
        const changes: Record<string, Change> = {};
        for (const k of [keys].flat()) {
          if (!(k in data)) continue;
          changes[k] = { oldValue: data[k] };
          delete data[k];
        }
        tell(name, changes);
      },
      async clear() {
        await this.remove(Object.keys(data));
      },
      async getBytesInUse(keys) {
        return names(keys).reduce((n, k) => n + (k in data ? JSON.stringify(data[k]).length : 0), 0);
      },
    };
  };
  const areas = { local: area('local'), session: area('session'), sync: area('sync') };
  return {
    ...areas,
    onChanged: { addListener: (l) => void listeners.add(l), removeListener: (l) => void listeners.delete(l), hasListener: (l) => listeners.has(l) },
    reset() {
      for (const a of Object.values(areas)) for (const k of Object.keys(a.data)) delete a.data[k];
    },
  };
}

// `browser` with a fake storage, plus whatever else a test needs (tabs, permissions, cookies…).
export const fakeBrowser = <T extends object>(storage: FakeStorage, more?: T) => ({ storage, ...more });

// A `wxt/browser` module for code that only imports it: `browser` is never used (emptyBrowser), or
// only has its namespaces looked at, never called (inertBrowser).
// Use: vi.mock('wxt/browser', async () => (await import('./fakes/browser')).emptyBrowser());
export const emptyBrowser = () => ({ browser: {} });
export const inertBrowser = () => ({ browser: { tabs: {}, permissions: {}, storage: { local: {}, onChanged: {} }, runtime: {}, scripting: {} } });

// A browser event (runtime.onConnect, port.onMessage…) that keeps its listeners, for the test to call.
export function fakeEvent<L extends (...args: any[]) => unknown>() {
  const listeners = new Set<L>();
  return {
    listeners,
    addListener: (l: L) => void listeners.add(l),
    removeListener: (l: L) => void listeners.delete(l),
    hasListener: (l: L) => listeners.has(l),
    emit: (...args: Parameters<L>) => [...listeners].map((l) => l(...args)),
  };
}

// A runtime.Port as the background gets it: who opened it, and what is done with it.
export function fakePort(name: string, sender: { url?: string; tab?: { id: number; url?: string }; frameId?: number }) {
  return { name, sender, postMessage: vi.fn(), disconnect: vi.fn(), onMessage: fakeEvent(), onDisconnect: fakeEvent() };
}

// A stubbed global fetch: one answer for every request, answers in turn (the last one for every
// request after), or answers by how the URL ends (others get a 404). A Response given is copied for each call, so it can be read again. Its calls are typed as
// the code under test makes them: headers as a record, body as a string.
export interface FetchInit {
  method?: string;
  headers: Record<string, string>;
  body: string;
  credentials?: RequestCredentials;
  cache?: RequestCache;
  redirect?: RequestRedirect;
  signal?: AbortSignal;
}
// A redirect to another site, answered as the browser does: followed (that site's answer) unless the
// request says 'manual' (an opaque redirect, which says nothing of where it leads).
export const redirecting = (_url: string, init: FetchInit): Response =>
  init.redirect === 'manual' ? Object.defineProperty(new Response(null), 'type', { value: 'opaqueredirect' }) : new Response('{"from":"another site"}', { status: 200 });
type Answer = Response | ((url: string, init: FetchInit) => Response | Promise<Response>);
export function mockFetch(answer: Answer | Answer[] | Record<string, Answer>) {
  const reply = async (a: Answer, url: string, init: FetchInit) => (typeof a === 'function' ? a(url, init) : a.clone());
  let turn = 0;
  const fetch = vi.fn(async (url: string, init: FetchInit) => {
    if (answer instanceof Response || typeof answer === 'function') return reply(answer, url, init);
    if (Array.isArray(answer)) return reply(answer[Math.min(turn++, answer.length - 1)]!, url, init);
    const route = Object.keys(answer).find((end) => url.endsWith(end));
    return route ? reply(answer[route]!, url, init) : new Response('', { status: 404 });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

// storage/secret-db in memory: mock '../src/storage/secret-db' with it. `trusted` false is a content
// script, where the real one refuses to open the database.
export function fakeSecretDb() {
  const data = new Map<string, unknown>();
  const db = {
    data,
    trusted: true,
    check() {
      if (!db.trusted) throw new Error("Secrets are only read in the extension's own pages.");
    },
    dbGet: async (name: string) => (db.check(), structuredClone(data.get(name))),
    dbSet: async (name: string, value: unknown) => {
      db.check();
      if (value === undefined) data.delete(name);
      else data.set(name, structuredClone(value));
    },
  };
  return db;
}
