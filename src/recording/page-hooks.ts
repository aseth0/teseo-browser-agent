// What a recording puts in the recorded tab: in the page's own world, fetch and XHR wrapped to tell
// the answers they get (a CustomEvent named `key`, its detail a string: objects do not cross worlds);
// in the extension's world, a relay of those events to the background. Both are injected with
// scripting.executeScript, so each is one self-contained function. The page can fire the event itself:
// an answer the browser did not see a call for is dropped before its body is read (recording/webrequest).
// An answer's detail: its head (method, URL, status, type, cut) as JSON, a line break, then its body as
// it is (parsePageAnswer). Their state hangs on the window under a Symbol: not among Object.keys(window).

// In the page's world. Once per key; its `unhook` (called when the recording ends) stops the telling
// and gives the page back its own fetch and XHR methods, those it did not wrap again since. A body is
// told whole up to `maxRead` (recording MAX_RELAY), cut past it and marked so; an event stream's never
// (a clone of it would keep all it ever sends).
export function hookAnswers(key: string, maxRead: number): void {
  const w = window as unknown as Record<symbol, unknown> & { fetch: typeof fetch };
  const state = Symbol.for(key);
  if (w[state]) return;
  const hooks = { on: true, unhook: () => undefined as void };
  w[state] = hooks;
  const tell = ({ body, ...answer }: { method: string; url: string; status: number; type?: string; body?: string }) => {
    if (!hooks.on) return;
    const head = JSON.stringify({ ...answer, ...(body !== undefined && body.length > maxRead && { cut: true }) });
    document.dispatchEvent(new CustomEvent(key, { detail: body === undefined ? head : `${head}\n${body.slice(0, maxRead)}` }));
  };
  // The same as recording/filter's `textual`: a change here must go there too.
  const textual = (type: string) => !type || /json|text|xml|javascript|urlencoded|graphql/i.test(type);
  const absolute = (url: string) => new URL(url, location.href).href;

  const pageFetch = w.fetch;
  const hookedFetch = async function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    const response = await pageFetch.call(this, input, init);
    if (!hooks.on) return response;
    try {
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      const url = absolute(input instanceof Request ? input.url : String(input));
      const type = response.headers.get('content-type') ?? '';
      if (!textual(type) || /event-stream/i.test(type)) tell({ method, url, status: response.status, type });
      else void response.clone().text().then((body) => tell({ method, url, status: response.status, type, body }), () => undefined);
    } catch {
      // the page's own call goes on as it is
    }
    return response;
  };
  w.fetch = hookedFetch;

  const xhr = XMLHttpRequest.prototype;
  const open = xhr.open;
  const send = xhr.send;
  const calls = new WeakMap<XMLHttpRequest, { method: string; url: string }>();
  const hookedOpen = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    if (hooks.on) {
      try {
        calls.set(this, { method: String(method).toUpperCase(), url: absolute(String(url)) });
      } catch {
        // not recorded
      }
    }
    return (open as (...a: unknown[]) => void).call(this, method, url, ...rest);
  };
  const hookedSend = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const call = calls.get(this);
    if (call && hooks.on) {
      this.addEventListener('loadend', () => {
        try {
          const type = this.getResponseHeader('content-type') ?? '';
          const answer =
            this.responseType === 'json' ? JSON.stringify(this.response)
            : (this.responseType === '' || this.responseType === 'text') && textual(type) ? String(this.responseText)
            : undefined;
          tell({ ...call, status: this.status, type, ...(answer !== undefined && { body: answer }) });
        } catch {
          // not recorded
        }
      });
    }
    return send.call(this, body);
  };
  xhr.open = hookedOpen;
  xhr.send = hookedSend;

  hooks.unhook = () => {
    hooks.on = false;
    // Wrapped again by the page since: left in place, ours only passes the calls on.
    if (w.fetch === hookedFetch) w.fetch = pageFetch;
    if (xhr.open === hookedOpen) xhr.open = open;
    if (xhr.send === hookedSend) xhr.send = send;
  };
}

// In the page's world, when the recording ends: its hooks stop telling and step aside.
export function unhookAnswers(key: string): void {
  const hooks = (window as unknown as Record<symbol, unknown>)[Symbol.for(key)];
  if (typeof hooks === 'object' && hooks !== null) (hooks as { unhook: () => void }).unhook();
}

// In the extension's world: each answer the page tells goes to the background, up to `maxDetail`
// characters (a longer one, which only the page itself could fire, is dropped).
export function relayAnswers(key: string, maxDetail: number): void {
  const w = window as unknown as Record<symbol, unknown>;
  const mark = Symbol.for(key);
  if (w[mark]) return;
  const runtime = (globalThis as unknown as { chrome: { runtime: { sendMessage: (m: unknown) => Promise<unknown> } } }).chrome.runtime;
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<unknown>).detail;
    if (typeof detail === 'string' && detail.length <= maxDetail) void runtime.sendMessage({ type: 'recording-answer', key, answer: detail }).catch(() => undefined);
  };
  w[mark] = listener;
  document.addEventListener(key, listener);
}
