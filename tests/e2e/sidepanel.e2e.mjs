// E2E: loads dist/chrome-mv3 into Chromium (Playwright), points it at a mock
// OpenAI-compatible server, sends prompts from the side panel and checks the UI.
// Usage: pnpm build && node tests/e2e/sidepanel.e2e.mjs [scenario,scenario...] [--port N] (default 8787)
// Live scenarios (E2E_LIVE=1, not in the default run): web-live searches the web for real.
// The mock server is in mock/, the scenarios in scenarios/ (their tables, by area; the order they
// run in, scenarios/index.mjs).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { granting, HELLO, LIVE, PORT, SCENARIOS, T, turnEnded } from './lib.mjs';
import { seedArgs, seedStorage } from './seed.mjs';
import { server } from './mock/server.mjs';
import { resetMock } from './mock/state.mjs';
import { ALL } from './scenarios/index.mjs';
import { ACTIONS, AFTER, BEFORE, BETWEEN, CARD, CHECK, DISABLED_TOOLS, EXPECT, MESSAGES, MID_TURN, MODEL_OF, PAGES, REJECT, RUN, TURNS } from './scenarios/tables.mjs';

// A live search reads the search engine's site, which only a click in a permission prompt allows: a
// copy of the build that may read every site stands in for it.
// The test server is on localhost, which the manifest no longer grants (the user allows it from the
// chat or Settings): a copy of the build that may read it stands in for that click. [::1] stays
// ungranted, for the scenarios that need a site without access.
const EXT = granting(path.resolve('dist/chrome-mv3'), ['http://localhost/*', 'http://127.0.0.1/*', ...(LIVE ? ['<all_urls>'] : [])]);
// Expected UI text per scenario (default: the greeting) and number of prompts sent.

// Chrome discards <link rel="modulepreload"> in extension pages with a warning (Vivaldi shows
// it; this Chromium does not), so check the built HTML instead of the console.
for (const html of ['sidepanel.html', 'floating.html', 'options.html']) {
  if (fs.readFileSync(path.join(EXT, html), 'utf8').includes('modulepreload')) {
    console.log(`FAIL ${html} contains modulepreload links`);
    process.exit(1);
  }
}

// A build with a key from the environment (EXTERNAL_MODEL_API_KEY, wxt.config.ts) has a provider that
// cannot be removed, with the scenarios' id ("env"): the key would go to the mock server, and
// no-provider could not pass. Build it without that variable.
const injectedKey = process.env.EXTERNAL_MODEL_API_KEY;
// The key is compiled into the worker alone (background/env-key).
if (injectedKey && fs.readFileSync(path.join(EXT, 'background.js'), 'utf8').includes(injectedKey)) {
  console.log('FAIL the extension was built with EXTERNAL_MODEL_API_KEY: build it again without it');
  process.exit(1);
}

await new Promise((r) => server.listen(PORT, r));
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-e2e-'));
// Headless by default so the run never opens a window or steals focus. Full Chromium's
// "new" headless mode loads extensions (the headless shell does not). E2E_HEADED=1 to watch.
const headed = process.env.E2E_HEADED === '1';
const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: false, // Playwright's headless would pick the headless shell; --headless=new below instead
  executablePath: process.env.CHROMIUM_PATH,
  // Chrome match patterns have no port, so a view's fixed URL has none (http://localhost/deals):
  // every localhost port goes to the test server.
  // A fake microphone (a tone), allowed without a prompt: dictation (scenarios/voice).
  args: [...(headed ? [] : ['--headless=new']), '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, `--host-resolver-rules=MAP localhost 127.0.0.1:${PORT}`],
});

let failed = false;
try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const extId = new URL(sw.url()).host;
  sw.on('console', (m) => m.type() === 'error' && console.log('[sw]', m.text()));

  // Target web page: the panel (opened as a tab) uses the most recently visited web tab.
  const shop = await ctx.newPage();
  await shop.goto(`http://localhost:${PORT}/shop.html`);

  for (const scenario of SCENARIOS ?? ALL) {
    const action = ACTIONS[scenario];
    const model = action?.model ?? MODEL_OF[scenario] ?? scenario;
    // Nothing left from the scenario before: the mock's counters, the browser's cookies and tabs, the
    // sites granted at run time, the extension's storage and secrets (seeded again below).
    resetMock();
    await ctx.clearCookies();
    for (const p of ctx.pages()) if (p !== shop) await p.close();
    // Blank while the storage is seeded: a chat the scenario before left floating on it would come back
    // with the page, and save the settings it still holds over the seed.
    await shop.goto('about:blank');
    await sw.evaluate(async () => {
      // The browser's own side panel, opened by a scenario before (the widget's "open the chat",
      // a met watch): not one of the test's pages, so closed here, disabled and enabled again. Left
      // open, it would answer the seed below with the settings it still holds and save them over it.
      await chrome.sidePanel.setOptions({ enabled: false });
      await chrome.sidePanel.setOptions({ enabled: true });
      for (let i = 0; i < 50 && (await chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })).length; i++) await new Promise((r) => setTimeout(r, 20));
    });
    await sw.evaluate(seedStorage, seedArgs(scenario, model));
    await shop.goto(`http://localhost:${PORT}${PAGES[scenario] ?? '/shop.html'}`); // fresh page state (and refs) for every scenario

    const page = await ctx.newPage();
    // Emulates recent Chromium builds (Vivaldi): scrollIntoView returns a Promise.
    await page.addInitScript(() => {
      const orig = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (...a) {
        orig.apply(this, a);
        return Promise.resolve();
      };
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
    await page.goto(`chrome-extension://${extId}/sidepanel.html`);
    const policySelect = page.locator('select[title*="may do on this site"]'); // Default's, or the agent's whose site it is
    await policySelect.waitFor({ timeout: T.medium }).catch(() => errors.push('page bar without read access'));
    await BEFORE[scenario]?.(page).catch((e) => errors.push(`before: ${e.message.split('\n')[0]}`));
    await RUN[scenario]?.({ page, errors, ctx, extId, shop, sw, policySelect, action, model });
    for (let turn = 0; turn < (TURNS[model] ?? 1); turn++) {
      if (turn > 0) await BETWEEN[scenario]?.(page, turn).catch((e) => errors.push(`between: ${e.message.split('\n')[0]}`));
      const sent = await page.locator('.msg.user').count();
      const message = scenario in MESSAGES ? MESSAGES[scenario] : `hello ${turn + 1}`;
      if (message !== null) await page.getByPlaceholder(/Ask something/).fill(message);
      else await page.getByPlaceholder(/Ask something/).focus();
      await page.keyboard.press('Enter');
      if (action) {
        await page.getByRole('alertdialog').waitFor({ timeout: T.medium }).catch(() => errors.push('no confirmation card'));
        if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/${scenario}-card.png` });
        await CARD[scenario]?.({ page, errors });
        if (action.comment) await page.getByRole('alertdialog').getByLabel('Comment for the model').fill(action.comment).catch(() => errors.push('no comment field'));
        // An answer is a button of the card; or steps, each a button of a named card or a menu item
        // (the card's "Allow on <host> ▾" menu).
        for (const step of typeof action.answer === 'string' ? [{ button: action.answer }] : action.answer) {
          const where = step.dialog ? page.getByRole('alertdialog', { name: step.dialog }) : page.getByRole('alertdialog');
          const target = step.menuitem ? page.getByRole('menuitem', { name: step.menuitem, exact: true }) : where.getByRole('button', { name: step.button, exact: true });
          await target.click({ timeout: T.medium }).catch(() => errors.push(`could not answer: ${step.menuitem ?? step.button}`));
        }
      }
      if (!MID_TURN[scenario] && !(await turnEnded(page, sent))) errors.push(`turn ${turn + 1} did not end`);
    }
    if (action?.policy && (await policySelect.inputValue()) !== action.policy) errors.push(`site policy is not ${action.policy}`);
    if (DISABLED_TOOLS[scenario]) {
      await page.getByTitle('Tools offered to the model').click(); // open the catalog, and its Browser group
      await page.locator('.tools-list').getByRole('button', { name: /Browser$/ }).click();
    }
    await AFTER[scenario]?.(page).catch((e) => errors.push(`after: ${e.message.split('\n')[0]}`));

    if (process.env.E2E_SHOTS) {
      await page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));
      await page.setViewportSize({ width: 420, height: 900 });
      await page.screenshot({ path: `${process.env.E2E_SHOTS}/${scenario}.png`, fullPage: true });
    }
    // Expand collapsed reasoning blocks so their text is visible to innerText.
    await page.evaluate(() => document.querySelectorAll('details.reasoning').forEach((d) => (d.open = true)));
    const text = (await page.locator('#root').innerText()).replace(/\s+/g, ' ');
    const want = action?.expect ?? EXPECT[scenario] ?? EXPECT[model] ?? HELLO;
    const ok = Array.isArray(want) ? want.every((w) => text.includes(w)) : typeof want === 'string' ? text.includes(want) : want.test(text);
    // Hidden context attached to user messages must never be rendered (tool results may show page content).
    const userText = (await page.locator('.msg.user').allInnerTexts()).join(' ');
    const leaked = userText.includes('untrusted_page_content') || userText.includes('<site_skill');
    await CHECK[scenario]?.({ page, errors });
    if (REJECT[scenario]?.test(text)) errors.push(`unexpected: ${text.match(REJECT[scenario])[0]}`);
    const good = ok && !leaked && !errors.length;
    console.log(`${good ? 'OK  ' : 'FAIL'} [${scenario}] UI: ${text.slice(0, 220)}`);
    if (leaked) console.log('     page context leaked into the UI');
    if (errors.length) console.log('     errors: ' + errors.join(' | '));
    if (!good) failed = true;
    await page.close();
  }
} finally {
  await ctx.close();
  server.close();
  // The build's copy and the browser profile, made for this run.
  for (const dir of [EXT, userDataDir]) fs.rmSync(dir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
