// A headless Firefox driven over WebDriver BiDi, for Firefox's smoke run (firefox-smoke.mjs).
// Playwright's Firefox cannot load an extension, and BiDi cannot navigate to an extension's page; so
// Playwright only provides the browser (its Firefox build, downloaded with
// `pnpm exec playwright-core install firefox`, or FIREFOX_PATH), and this talks BiDi to it with Node's
// own WebSocket: webExtension.install loads the build as a temporary add-on (no signing needed), and
// the browser's own window (BiDi's "chrome" scope, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS) opens the
// extension's pages in tabs and reads the browser console, where the background's errors go.
// Every run gets a new profile, removed when it closes: never the user's Firefox or its profile.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { firefox } from 'playwright-core';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(check, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) if (await check().catch(() => false)) return true;
  return false;
}

// `ext`: the unpacked build. Its add-on id comes from its manifest; its pages' host (the UUID Firefox
// gives it) is fixed here, through a pref, so its pages' URLs are known before it installs.
export async function launchFirefox(ext) {
  const binary = process.env.FIREFOX_PATH || firefox.executablePath();
  if (!fs.existsSync(binary)) throw new Error(`no Firefox at ${binary}: run \`pnpm exec playwright-core install firefox\` or set FIREFOX_PATH`);
  const id = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8')).browser_specific_settings.gecko.id;
  const uuid = crypto.randomUUID();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-ff-profile-'));
  const prefs = {
    'extensions.webextensions.uuids': JSON.stringify({ [id]: uuid }),
    // Nothing from the network the test does not ask for.
    'app.update.enabled': false,
    'browser.shell.checkDefaultBrowser': false,
    'datareporting.policy.dataSubmissionEnabled': false,
    'toolkit.telemetry.enabled': false,
  };
  fs.writeFileSync(path.join(profile, 'user.js'), Object.entries(prefs).map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n'));
  const proc = spawn(binary, ['--headless', '--remote-debugging-port', '0', '-no-remote', '-profile', profile], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, MOZ_HEADLESS: '1', MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' },
  });
  let output = '';
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Firefox did not start its WebDriver BiDi server:\n${output.slice(-2000)}`)), 30000);
    const read = (d) => {
      output += d;
      const m = output.match(/WebDriver BiDi listening on (ws:\/\/\S+)/);
      if (m) (clearTimeout(timer), resolve(m[1]));
    };
    proc.stdout.on('data', read);
    proc.stderr.on('data', read);
    proc.on('exit', (code) => reject(new Error(`Firefox exited (${code}):\n${output.slice(-2000)}`)));
  });
  const ws = new WebSocket(`${url}/session`);
  await new Promise((resolve, reject) => (ws.addEventListener('open', resolve), ws.addEventListener('error', reject)));
  return new Firefox({ ws, proc, profile, id, uuid, ext, output: () => output });
}

class Firefox {
  constructor({ ws, proc, profile, id, uuid, ext, output }) {
    Object.assign(this, { ws, proc, profile, id, uuid, ext, output });
    this.origin = `moz-extension://${uuid}`;
    this.next = 0;
    this.pending = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      const done = this.pending.get(m.id);
      if (!done) return;
      this.pending.delete(m.id);
      done(m);
    });
  }

  // A BiDi command; none waits longer than `ms`.
  send(method, params = {}, ms = 30000) {
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      const timer = setTimeout(() => (this.pending.delete(id), reject(new Error(`${method}: no answer in ${ms} ms`))), ms);
      this.pending.set(id, (m) => (clearTimeout(timer), m.type === 'error' ? reject(new Error(`${method}: ${m.error}: ${m.message}`)) : resolve(m.result)));
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async start() {
    await this.send('session.new', { capabilities: {} });
    await this.send('webExtension.install', { extensionData: { type: 'path', path: this.ext } });
    const { contexts } = await this.send('browsingContext.getTree', { 'moz:scope': 'chrome' });
    this.window = contexts.find((c) => c.url === 'chrome://browser/content/browser.xhtml')?.context;
    if (!this.window) throw new Error(`no browser window: ${contexts.map((c) => c.url)}`);
  }

  // Runs `fn(arg)` in the browser's own window (privileged: gBrowser, Services…).
  inBrowser(fn, arg) {
    return evaluate(this, this.window, fn, arg);
  }

  // The add-on as Firefox has it: whether it runs, and its background's state.
  addon() {
    return this.inBrowser((id) => {
      const policy = WebExtensionPolicy.getByID(id);
      return { active: !!policy?.active, background: policy?.extension?.backgroundState ?? null, granted: policy ? [...policy.allowedOrigins.patterns].map((p) => p.pattern) : [] };
    }, this.id);
  }

  async tabs() {
    const { contexts } = await this.send('browsingContext.getTree', { maxDepth: 0 });
    return contexts;
  }

  // A tab with one of the extension's pages (`page`: "sidepanel.html", "options.html#about"…).
  openExtensionPage(page) {
    return this.openTab(`${this.origin}/${page}`);
  }

  // A tab at `url`, opened and selected by the browser itself: BiDi may not navigate to an extension's
  // page, and its own way to select a tab waits for a focus a headless window never gets. The chat,
  // opened in a tab after a web page, reads that page (ui/active-tab: the web tab visited last).
  // `select: false` leaves it behind the selected tab.
  async openTab(url, { select = true } = {}) {
    const before = new Set((await this.tabs()).map((c) => c.context));
    await this.inBrowser(({ u, select }) => {
      const tab = gBrowser.addTab(u, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
      if (select) gBrowser.selectedTab = tab;
    }, { u: url, select });
    let tab;
    await waitFor(async () => (tab = (await this.tabs()).find((c) => !before.has(c.context) && c.url === url)), 10000);
    if (!tab) throw new Error(`${url} did not open`);
    const t = new Tab(this, tab.context);
    await t.waitFor(() => document.readyState === 'complete', undefined, 10000);
    return t;
  }

  // Closes a tab (a BiDi context). An extension page is let settle first: closed while it still waits
  // for the background (a runtime message, a storage read, as it starts or right after a turn), Firefox
  // logs "Promise … after context unloaded" for it, with no page named. A user closing the chat at that
  // moment loses nothing (the background still gets the message), but the run would count it as an error.
  async closeTab(context) {
    const [frame] = (await this.send('browsingContext.getTree', { root: context, maxDepth: 0 }).catch(() => ({ contexts: [] }))).contexts;
    if (frame?.url.startsWith(this.origin)) await new Tab(this, context).settle();
    return this.send('browsingContext.close', { context }).catch(() => {});
  }

  // Opens the extension's sidebar (sidebar_action) in the browser's window. BiDi does not reach inside
  // it: its page is read through the extension's own pages (extension.getViews).
  async openSidebar() {
    const id = `${this.id.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}-sidebar-action`; // Firefox's widget id for the add-on
    await this.inBrowser((i) => SidebarController.show(i), id);
  }

  // Errors the extension's pages and background logged, from the browser console: uncaught errors
  // and console.error. Each entry once per Firefox (`seen`).
  async errors() {
    const all = await this.inBrowser((origin) => {
      const out = [];
      const from = (url) => typeof url === 'string' && url.startsWith(origin);
      const windowUrl = (id) => {
        try { return WindowGlobalParent.getByInnerWindowId(id)?.documentURI?.spec; } catch { return undefined; }
      };
      for (const m of Services.console.getMessageArray() ?? []) {
        if (!(m instanceof Ci.nsIScriptError)) continue;
        if (m.flags & (Ci.nsIScriptError.warningFlag | Ci.nsIScriptError.infoFlag)) continue;
        const page = windowUrl(m.innerWindowID);
        if (!from(m.sourceName) && !from(page)) continue;
        const where = `${m.sourceName.replace(origin, '')}:${m.lineNumber}${from(page) ? ` in ${page.replace(origin, '')}` : ''}`;
        out.push({ key: `e${m.timeStamp}:${m.errorMessage}`, text: `${m.errorMessage.trim()} (${where})` });
      }
      const api = Cc['@mozilla.org/consoleAPI-storage;1'].getService(Ci.nsIConsoleAPIStorage);
      for (const e of api.getEvents()) {
        if (e.level !== 'error' || !from(e.filename)) continue;
        const text = e.arguments.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'object' ? (() => { try { return JSON.stringify(a); } catch { return String(a); } })() : String(a))).join(' ');
        out.push({ key: `c${e.timeStamp}:${text}`, text: `console.error: ${text} (${e.filename.replace(origin, '')}:${e.lineNumber})` });
      }
      return out;
    }, this.origin);
    this.seen ??= new Set();
    const fresh = all.filter((e) => !this.seen.has(e.key));
    for (const e of fresh) this.seen.add(e.key);
    return fresh.map((e) => e.text);
  }

  async close() {
    try {
      await this.send('browser.close').catch(() => {});
      await Promise.race([new Promise((r) => this.proc.once('exit', r)), sleep(5000)]);
    } finally {
      if (this.proc.exitCode === null) this.proc.kill('SIGKILL');
      this.ws.close();
      fs.rmSync(this.profile, { recursive: true, force: true });
    }
  }
}

// `fn` runs in the page with `arg` (JSON), its result back as JSON. A page's DOM nodes cannot come
// back this way: see Tab.node.
async function evaluate(ff, context, fn, arg) {
  const expression = `(async () => JSON.stringify({ v: await (${fn})(${JSON.stringify(arg) ?? 'undefined'}) }))()`;
  const r = await ff.send('script.evaluate', { target: { context }, expression, awaitPromise: true, userActivation: true });
  if (r.type === 'exception') throw new Error(r.exceptionDetails.text);
  return JSON.parse(r.result.value).v;
}

// In a page: the element `selector` matches whose text, label or title is `name` (or the first, without).
const FIND = `(selector, name) => [...document.querySelectorAll(selector)].find((e) => name === undefined || [e.textContent, e.getAttribute('aria-label'), e.title, e.placeholder].some((t) => t?.trim() === name || (name.startsWith('/') && new RegExp(name.slice(1, -1)).test(t ?? ''))))`;

export class Tab {
  constructor(ff, context) {
    Object.assign(this, { ff, context });
  }

  evaluate(fn, arg) {
    return evaluate(this.ff, this.context, fn, arg);
  }

  waitFor(fn, arg, ms) {
    return waitFor(() => this.evaluate(fn, arg), ms);
  }

  text(selector = 'body') {
    return this.evaluate((s) => document.querySelector(s)?.innerText ?? '', selector);
  }

  exists(selector, name) {
    return this.evaluate(`(a) => !!(${FIND})(a[0], a[1])`, [selector, name]);
  }

  // A DOM node, as BiDi refers to it (for input actions), scrolled into view.
  async node(selector, name) {
    const r = await this.ff.send('script.evaluate', {
      target: { context: this.context },
      expression: `(() => { const e = (${FIND})(${JSON.stringify(selector)}, ${JSON.stringify(name)}); e?.scrollIntoView({ block: 'center' }); return e; })()`,
      awaitPromise: false,
      resultOwnership: 'root',
    });
    if (r.type === 'exception') throw new Error(r.exceptionDetails.text);
    if (r.result.type !== 'node') throw new Error(`no ${selector}${name === undefined ? '' : ` "${name}"`}`);
    return r.result;
  }

  // A real click (a pointer's), in the middle of the element.
  async click(selector, name) {
    const element = await this.node(selector, name);
    await this.ff.send('input.performActions', {
      context: this.context,
      actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [
        { type: 'pointerMove', x: 0, y: 0, origin: { type: 'element', element: { sharedId: element.sharedId } } },
        { type: 'pointerDown', button: 0 },
        { type: 'pointerUp', button: 0 },
      ] }],
    });
  }

  // Real keys, into the focused element. `keys`: text, or WebDriver key codes ("" is Enter).
  async keys(keys) {
    const actions = [...keys].flatMap((value) => [{ type: 'keyDown', value }, { type: 'keyUp', value }]);
    await this.ff.send('input.performActions', { context: this.context, actions: [{ type: 'key', id: 'keyboard', actions }] });
  }

  async type(selector, text) {
    await this.click(selector);
    await this.keys(text);
  }

  // Waits for the page to go quiet: idle, then no change to its document for `quiet` ms (an answer from
  // the background shows as one), at most `ms`.
  settle(quiet = 500, ms = 5000) {
    return this.evaluate(
      ({ quiet, ms }) =>
        new Promise((resolve) => {
          const end = setTimeout(done, ms);
          let timer;
          const observer = new MutationObserver(() => wait());
          function wait() {
            clearTimeout(timer);
            timer = setTimeout(done, quiet);
          }
          function done() {
            observer.disconnect();
            clearTimeout(end);
            clearTimeout(timer);
            resolve(true);
          }
          observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
          requestIdleCallback(wait, { timeout: ms });
        }),
      { quiet, ms },
    ).catch(() => false);
  }

  close() {
    return this.ff.closeTab(this.context);
  }
}

export const ENTER = '';
