// Firefox's smoke run: loads dist/firefox-mv3 into a headless Firefox as a temporary add-on, points it
// at the e2e's mock server, and checks that the build works there: it installs and its background runs,
// the chat answers (in a tab and in the browser's sidebar) and reads a page, a script tool runs (QuickJS),
// Settings and the popup render, and what Firefox lacks says so. Any error the extension's pages or
// background log fails the run.
// Usage: pnpm exec wxt build -b firefox --mv3 && node tests/e2e/firefox-smoke.mjs [check,check…] [--port N]
// (default 8787; `pnpm e2e:firefox` builds and runs it). The browser: firefox/firefox.mjs.
import path from 'node:path';
import fs from 'node:fs';
import { granting, HELLO, PORT, SCENARIOS, T } from './lib.mjs';
import { seedArgs, seedStorage } from './seed.mjs';
import { server } from './mock/server.mjs';
import { resetMock } from './mock/state.mjs';
import './scenarios/index.mjs'; // fills the scenarios' tables (seed)
import { EXPECT, PAGES } from './scenarios/tables.mjs';
import { ENTER, launchFirefox, waitFor } from './firefox/firefox.mjs';

const BUILD = path.resolve('dist/firefox-mv3');
// E2E_DEBUG=1: also the errors expected (below), and Firefox's own output when the run fails.
const DEBUG = process.env.E2E_DEBUG === '1';
if (!fs.existsSync(path.join(BUILD, 'manifest.json'))) {
  console.log('FAIL no Firefox build: run `pnpm exec wxt build -b firefox --mv3` first');
  process.exit(1);
}
// As the e2e (sidepanel.e2e.mjs): a build with a key from the environment would send it to the mock.
const injectedKey = process.env.EXTERNAL_MODEL_API_KEY;
if (injectedKey && fs.readFileSync(path.join(BUILD, 'background.js'), 'utf8').includes(injectedKey)) {
  console.log('FAIL the extension was built with EXTERNAL_MODEL_API_KEY: build it again without it');
  process.exit(1);
}
// The test server is on localhost, which the manifest does not grant (the user allows it): a copy that may read it.
const EXT = granting(BUILD, ['http://localhost/*', 'http://127.0.0.1/*']);

// What Firefox's build lacks (core/build), by the names Settings → About gives them.
const LACKS = ['Chromium DevTools engine', 'Speak', 'System voice', "A tab's audio", 'Floating chat', 'Custom tool sources'];
// Errors Firefox logs for the extension that are not failures:
const EXPECTED_ERRORS = [
  // Zod (the MCP SDK's) checks once whether it may compile its parsers: `Function('')` in a try. The CSP
  // refuses it, as it should, and Zod parses without; Firefox logs the refusal (Chrome does not).
  /^Content-Security-Policy: .*blocked a JavaScript eval .*\(Missing 'unsafe-eval'\)/,
];
const unexpected = (errors) => errors.filter((e) => !EXPECTED_ERRORS.some((x) => x.test(e)));

await new Promise((resolve, reject) => server.once('error', reject).listen(PORT, resolve));
const ff = await launchFirefox(EXT);

// The storage seeded as the e2e's `scenario` (its tables), and the page the chat reads, selected. Every
// tab from the step before is closed first: an open chat could save the settings it holds over the seed.
async function seed(scenario) {
  resetMock();
  for (const t of await ff.tabs()) if (t.url.startsWith(ff.origin)) await ff.closeTab(t.context);
  const seeder = await ff.openExtensionPage('popup.html');
  await seeder.evaluate(seedStorage, seedArgs(scenario, scenario));
  await seeder.close();
  const old = await ff.tabs();
  const web = await ff.openTab(`http://localhost:${PORT}${PAGES[scenario] ?? '/shop.html'}`);
  for (const t of old) await ff.closeTab(t.context); // the last tab is never closed: its window would go
  return web;
}

// The chat, opened as a tab after the page it reads.
async function chatFor(scenario) {
  await seed(scenario);
  return ff.openExtensionPage('sidepanel.html');
}

// Sends a message from the chat and waits for its turn to end (its Stop button gone).
async function send(chat, message) {
  const sent = await chat.evaluate(() => document.querySelectorAll('.msg.user').length);
  if (!(await chat.waitFor(() => !!document.querySelector('textarea[placeholder^="Ask something"]'), undefined, T.medium))) throw new Error('no message box');
  await chat.type('textarea[placeholder^="Ask something"]', message);
  await chat.keys(ENTER);
  const stop = () => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Stop');
  if (!(await chat.waitFor((n) => document.querySelectorAll('.msg.user').length > n, sent, T.short))) throw new Error('the message was not sent');
  if (!(await chat.waitFor(`() => !(${stop})()`, undefined, T.turn))) throw new Error('the turn did not end');
  return (await chat.text('#root')).replace(/\s+/g, ' ');
}

const expectText = (text, want) => {
  for (const w of [want].flat()) if (!text.includes(w)) throw new Error(`no "${w}" in: ${text.slice(0, 300)}`);
};

const CHECKS = {
  // It installs, its background starts and stays without errors.
  async install() {
    const state = await ff.addon();
    if (!state.active) throw new Error(`not active: ${JSON.stringify(state)}`);
    if (!state.granted.some((p) => p.startsWith('http://localhost'))) throw new Error(`localhost not granted: ${state.granted}`);
    // An event page: it starts with the add-on, or with the first page that wakes it.
    const tab = await ff.openExtensionPage('popup.html');
    const ok = await waitFor(async () => (await ff.addon()).background === 'running', T.medium);
    await tab.close();
    if (!ok) throw new Error(`background: ${(await ff.addon()).background}`);
  },
  // The chat page renders; without a provider, it says to add one.
  async 'chat-renders'() {
    const chat = await chatFor('basic');
    await chat.evaluate(async () => {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...settings, providers: [], activeProviderId: undefined } });
    });
    await chat.close();
    const fresh = await ff.openExtensionPage('sidepanel.html');
    if (!(await fresh.waitFor(() => document.body.innerText.includes('Add an OpenAI-compatible provider'), undefined, T.medium))) throw new Error(`no provider notice: ${(await fresh.text()).slice(0, 200)}`);
  },
  // With a provider pointed at the mock, a message gets its answer.
  async answer() {
    const chat = await chatFor('basic');
    expectText(await send(chat, 'hello 1'), HELLO);
  },
  // The browser's own sidebar, beside the shop's tab: it shows that site in its page bar and answers.
  // Driven through an extension page behind it (its DOM: real input does not reach the sidebar).
  async sidebar() {
    await seed('basic');
    const helper = await ff.openTab(`${ff.origin}/popup.html`, { select: false });
    await ff.openSidebar();
    const inSidebar = (fn, arg) => helper.evaluate(`async (arg) => { const v = browser.extension.getViews({ type: 'sidebar' })[0]; return v ? (${fn})(v, arg) : null; }`, arg);
    const bar = await waitFor(() => inSidebar((v) => !!v.document.querySelector('select[title="What the agent may do on this site"]') && !!v.document.querySelector('textarea')), T.medium);
    if (!bar) throw new Error(`no page bar or message box: ${String(await inSidebar((v) => v.document.body.innerText.slice(0, 200)))}`);
    await inSidebar((v, text) => {
      const box = v.document.querySelector('textarea');
      Object.getOwnPropertyDescriptor(v.HTMLTextAreaElement.prototype, 'value').set.call(box, text);
      box.dispatchEvent(new v.Event('input', { bubbles: true }));
      box.dispatchEvent(new v.KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    }, 'hello 1');
    const answered = await waitFor(() => inSidebar((v, hello) => v.document.body.innerText.includes(hello) && ![...v.document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Stop'), HELLO), T.turn);
    if (!answered) throw new Error(`no answer: ${String(await inSidebar((v) => v.document.body.innerText.slice(0, 300)))}`);
  },
  // The chat reads the page: a page tool (browser.get_page_text) and back.
  async 'page-tool'() {
    const chat = await chatFor('tool-text');
    expectText(await send(chat, 'hello 1'), EXPECT['tool-text']);
  },
  // A custom tool with a script (QuickJS) that calls tools.
  async 'script-tool'() {
    const chat = await chatFor('script-steps');
    expectText(await send(chat, 'hello 1'), EXPECT['script-steps']);
    const inside = await chat.evaluate(() => document.querySelector('.sub-agent')?.textContent ?? '');
    for (const w of ['steps.check', 'browser.wait_for', 'browser.find', 'Found 20 buttons']) if (!inside.includes(w)) throw new Error(`its steps, under its call: ${inside.slice(0, 300)}`);
  },
  // Settings: every section renders, without an error; what Firefox lacks says so.
  async settings() {
    const options = await ff.openExtensionPage('options.html');
    if (!(await options.waitFor(() => !!document.querySelector('.options-nav a'), undefined, T.medium))) throw new Error(`no menu: ${(await options.text()).slice(0, 200)}`);
    const sections = await options.evaluate(() => [...document.querySelectorAll('.options-nav a')].map((a) => ({ hash: a.getAttribute('href'), title: a.textContent.trim(), marked: !!a.querySelector('.feature-mark') })));
    const problems = [];
    for (const s of sections) {
      await options.evaluate((h) => (location.hash = h), s.hash);
      const shown = await options.waitFor((h) => location.hash === h && document.querySelector('.options-main')?.innerText.trim().length > 20, s.hash, T.medium);
      const alert = await options.evaluate(() => document.querySelector('.options-main [role=alert]')?.textContent ?? '');
      if (!shown) problems.push(`${s.hash}: empty`);
      if (alert) problems.push(`${s.hash}: ${alert}`);
      for (const e of unexpected(await ff.errors())) problems.push(`${s.hash}: ${e}`);
    }
    // The sections about what it lacks: marked in the menu, a notice in their place.
    for (const id of ['#devtools', '#speak']) {
      const s = sections.find((x) => x.hash === id);
      if (!s?.marked) problems.push(`${id}: not marked in the menu`);
      await options.evaluate((h) => (location.hash = h), id);
      if (!(await options.waitFor(() => !!document.querySelector('.options-main .feature-notice'), undefined, T.short))) problems.push(`${id}: no notice`);
    }
    // About: what this version leaves out.
    await options.evaluate(() => (location.hash = '#about'));
    await options.waitFor(() => !!document.querySelector('ul[aria-label="This version leaves out"]'), undefined, T.short);
    const left = await options.evaluate(() => [...document.querySelectorAll('ul[aria-label="This version leaves out"] strong')].map((s) => s.textContent.trim()));
    if (left.join('|') !== LACKS.join('|')) problems.push(`About leaves out: ${left.join(', ')}`);
    // In a tab of a section that works: Voice's "A tab's audio" (Firefox lacks it), Custom tools' sources (its
    // build leaves them out, core/build FIREFOX_LEAVES_OUT).
    for (const [id, tab] of [['#voice', "A tab's audio"], ['#custom-tools', '/^Sources/']]) {
      await options.evaluate((h) => (location.hash = h), id);
      if (await waitFor(() => options.exists('.options-main [role=tab]', tab), T.short)) {
        await options.click('.options-main [role=tab]', tab);
        if (!(await options.waitFor(() => !!document.querySelector('.options-main .feature-notice:not([hidden] *)'), undefined, T.short))) problems.push(`${id}: no notice in ${tab}`);
      } else problems.push(`${id}: no tabs`);
    }
    if (problems.length) throw new Error(problems.join(' | '));
  },
  // The toolbar button's popup, opened as a page: its tiles and lines, the floating chat and a tab's audio greyed with their mark.
  async popup() {
    await seed('basic'); // a provider, and a web page for the popup's tab
    const popup = await ff.openExtensionPage('popup.html');
    if (!(await popup.waitFor(() => document.querySelectorAll('[role=menuitem]').length > 3, undefined, T.medium))) throw new Error(`no menu: ${(await popup.text()).slice(0, 200)}`);
    const floating = await popup.exists('[aria-disabled=true]', '/^Chat on this page: /');
    const audio = await popup.evaluate(() => [...document.querySelectorAll('.popup-row.off')].map((r) => r.getAttribute('aria-label')));
    if (!floating) throw new Error('the floating chat is not greyed');
    if (!audio.some((a) => /audio/i.test(a ?? ''))) throw new Error(`a tab's audio is not greyed: ${audio}`);
  },
};

let failed = false;
try {
  await ff.start();
  for (const name of SCENARIOS ?? Object.keys(CHECKS)) {
    if (!CHECKS[name]) throw new Error(`no check "${name}": ${Object.keys(CHECKS).join(', ')}`);
    let error;
    try {
      await CHECKS[name]();
    } catch (e) {
      error = e.message.split('\n')[0];
    }
    const all = await ff.errors();
    const logged = unexpected(all);
    const good = !error && !logged.length;
    console.log(`${good ? 'OK  ' : 'FAIL'} [${name}]${error ? ` ${error}` : ''}`);
    for (const e of logged) console.log(`     logged: ${e}`);
    if (DEBUG) for (const e of all.filter((x) => !logged.includes(x))) console.log(`     expected: ${e}`);
    if (!good) failed = true;
  }
} catch (e) {
  console.log(`FAIL ${e.message}`);
  failed = true;
} finally {
  if (failed && DEBUG) console.log(ff.output().slice(-4000));
  await ff.close();
  server.close();
  fs.rmSync(EXT, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
