// Settings → Chromium DevTools: off by default; once on, the browser tools run on DevTools (and
// browser.hover is offered).
import { HOST, T, stored, waitFor } from '../lib.mjs';
import { ACTIONS, CARD, CHECK, EXPECT, MESSAGES, PAGES, RUN, SITE_POLICIES } from './tables.mjs';
import { startRecording as startFromPopup, stopRecording as stopFromPopup } from './helpers.mjs';

RUN['devtools-settings'] = async ({ errors, ctx, extId }) => {
  const options = await ctx.newPage();
  await options.goto(`chrome-extension://${extId}/options.html#devtools`);
  const box = options.getByLabel('Run the browser tools on DevTools', { exact: true });
  if (await box.isChecked()) errors.push('Chromium DevTools is on by default');
  await box.check();
  if (!(await waitFor(async () => (await stored(options, 'settings'))?.devtoolsTools === true))) errors.push('the switch was not saved');
  // The engine's own tool, listed once the switch is on (the link opens its group).
  await options.goto(`chrome-extension://${extId}/options.html#tools/browser.hover`);
  await options.locator('[id="tool-browser.hover"]').waitFor({ timeout: T.medium }).catch(() => errors.push('Settings → Tools lacks browser.hover once the engine is on'));
  if (!(await options.locator('[id="tool-browser.hover"] .badge.devtools').count())) errors.push('browser.hover is not marked DevTools in Settings → Tools');
  await box.page().close();
};

// The browser.* tools on the DevTools engine (the runner turns it on for the engine-* models), on
// /engine.html: a click the page sees as trusted, typing with a real Enter, Tab moving the focus, a
// hover menu.
const ENGINE = ['engine-click', 'engine-type', 'engine-tab', 'engine-hover'];
for (const name of ENGINE) PAGES[name] = '/engine.html';
// The click through its card (it says real input); the rest acting without asking.
ACTIONS['engine-click'] = { model: 'engine-click', answer: 'Allow', expect: 'ENGINE OK engine-click' };
CARD['engine-click'] = async ({ page, errors }) => {
  const card = await page.getByRole('alertdialog').innerText().catch(() => '');
  if (!card.includes('(real input)')) errors.push(`card: ${card.slice(0, 200)}`);
};
for (const name of ENGINE.slice(1)) {
  SITE_POLICIES[name] = { [HOST]: 'auto' };
  EXPECT[name] = `ENGINE OK ${name}`;
}
let enginePage;
RUN['engine-click'] = async ({ shop }) => {
  enginePage = shop;
};
CHECK['engine-click'] = async ({ page, errors }) => {
  if (!(await page.locator('details.tool .badge.devtools').count())) errors.push('the call is not marked DevTools in the chat');
  const seen = await enginePage.evaluate(() => window.__trusted).catch((e) => `unreadable: ${e.message}`);
  if (JSON.stringify(seen) !== '[true]') errors.push(`the page saw clicks: ${JSON.stringify(seen)}`);
};

// An editor that keeps its own model (/editor.html, as Slate): what browser.type does reaches the model, and
// Enter sends it. With real input, and with synthetic events.
for (const name of ['engine-editor', 'engine-unfocused', 'synthetic-editor']) {
  PAGES[name] = '/editor.html';
  SITE_POLICIES[name] = { [HOST]: 'auto' };
  EXPECT[name] = `EDITOR OK ${name}`;
}
// The page without the browser's focus: real presses on the field first. Headless, the page always has it
// (a real side panel focused or not), so that is told to the page script's world, as if it had not.
let editorPage;
const presses = () => editorPage.evaluate(() => window.__presses);
RUN['engine-unfocused'] = async ({ shop, sw }) => {
  editorPage = shop;
  await sw.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => void (document.hasFocus = () => false) });
  }, shop.url());
};
CHECK['engine-unfocused'] = async ({ errors }) => {
  if ((await presses()) !== 3) errors.push(`pressed on the field ${await presses()} times, for 3 browser.type calls`);
};
RUN['engine-editor'] = async ({ shop }) => {
  editorPage = shop;
};
CHECK['engine-editor'] = async ({ errors }) => {
  if (await presses()) errors.push('pressed on the field with the focus on the page');
};
// A field that takes nothing: the error says so, and Enter is not pressed after it.
PAGES['engine-ignored'] = '/editor.html?ignoring';
SITE_POLICIES['engine-ignored'] = { [HOST]: 'auto' };
EXPECT['engine-ignored'] = 'IGNORED OK';
RUN['engine-ignored'] = async ({ shop }) => {
  editorPage = shop;
};
CHECK['engine-ignored'] = async ({ errors }) => {
  const status = await editorPage.evaluate(() => document.getElementById('status').textContent);
  if (status !== 'Status: idle') errors.push(`Enter was pressed: ${status}`);
};
// A chat app's side rail on /rail.html: each entry an icon inside an SVG foreignObject, in a list that
// scrolls smoothly. Found by its name typed without its accent, clicked with real input and with
// synthetic events, its space opens; an entry that only shows its tooltip and its focus is said to have
// changed nothing, one whose click only changes a class is not.
const RAIL = ['engine-rail', 'act-rail', 'engine-rail-still', 'act-rail-still', 'engine-rail-look', 'act-rail-look'];
for (const name of RAIL) {
  PAGES[name] = '/rail.html';
  SITE_POLICIES[name] = { [HOST]: 'auto' };
  EXPECT[name] = `RAIL OK ${name}`;
}
// The real click is sent where the entry is once the list has scrolled to it, not where it was on the way.
let railPage;
RUN['engine-rail'] = async ({ shop }) => {
  railPage = shop;
};
CHECK['engine-rail'] = async ({ errors }) => {
  const [clicks, now] = await railPage.evaluate(() => [window.__clicks, document.querySelector('nav').scrollTop]).catch((e) => [e.message]);
  if (JSON.stringify(clicks) !== JSON.stringify([[true, 'IMG', now]])) errors.push(`the click came while the list was still scrolling: ${JSON.stringify(clicks)}, the list now at ${now}`);
};

// Recording through DevTools (the runner turns the engine on for rec-*): its modes in the popup, a Web Worker's
// call caught (today's recording misses it), several tabs in order, and a value hidden under a name.
// Several tabs makes the same call in each: Everything keeps both (API calls would keep the first).
const startRecording = async (page, shop, mode, preset) => {
  await startFromPopup(page, shop, { mode, preset });
  // The background attaches a moment after it says it records (the chat's DevTools chip says when).
  await page.locator('.topbar .devtools-on').waitFor({ timeout: T.short });
};
const stopRecording = async (page, shop) => {
  const review = await stopFromPopup(page, shop);
  await new Promise((r) => setTimeout(r, 1200)); // late bodies
  return review;
};
for (const name of ['rec-worker', 'rec-tabs', 'rec-hide-secret']) PAGES[name] = '/worker.html';
// The page's own step, or why it did not end in time (a worker the debugger holds would hang it).
const inTime = async (step, what, errors) => {
  let timer;
  const late = new Promise((r) => (timer = setTimeout(() => r(errors.push(`${what}: did not end in 5 s`)), 5000)));
  try {
    return await Promise.race([step, late]);
  } finally {
    clearTimeout(timer); // ended in time: no error later
  }
};

RUN['rec-worker'] = async ({ page, errors, shop }) => {
  await startRecording(page, shop, 'This tab');
  await inTime(shop.evaluate(() => window.runWorker()), 'rec-worker: the worker', errors);
  const review = await stopRecording(page, shop);
  const text = await review.innerText();
  if (!text.includes('/api/worker-data')) errors.push(`rec-worker: the worker's call is not listed: ${text.slice(0, 300)}`);
  await review.getByRole('button', { name: 'Discard' }).click();
};

RUN['rec-tabs'] = async ({ page, errors, ctx, shop }) => {
  await startRecording(page, shop, 'Several tabs', 'Everything');
  await inTime(shop.evaluate(() => fetch('/rec/items?q=first')), 'rec-tabs: first fetch', errors);
  const second = await ctx.newPage();
  await second.goto(`http://${HOST}/worker.html?second`);
  await second.bringToFront();
  await new Promise((r) => setTimeout(r, 800));
  await inTime(second.evaluate(() => fetch('/rec/items?q=second')), 'rec-tabs: second fetch', errors);
  await new Promise((r) => setTimeout(r, 500));
  await shop.bringToFront();
  const review = await stopRecording(page, shop);
  const text = await review.innerText();
  const first = text.indexOf('q=first');
  const moved = text.indexOf('→ ');
  const later = text.indexOf('q=second');
  if (!(first >= 0 && moved > first && later > moved)) errors.push(`rec-tabs: not in order with the tab change: ${text.slice(0, 500)}`);
  await review.getByRole('button', { name: 'Discard' }).click();
  await second.close();
};

MESSAGES['rec-hide-secret'] = 'What does this call send?';
EXPECT['rec-hide-secret'] = 'SECRET HIDDEN OK';
RUN['rec-hide-secret'] = async ({ page, errors, shop }) => {
  await startRecording(page, shop, 'This tab');
  await inTime(shop.evaluate(() => window.callApi()), 'rec-hide-secret: the call', errors);
  const review = await stopRecording(page, shop);
  const call = review.locator('details.recording-call', { hasText: '/api/customer' }).first();
  await call.locator('.recording-url').click();
  await call.getByRole('tab', { name: 'Values' }).click();
  await call.locator('tr', { hasText: 'customer' }).first().getByRole('button', { name: 'Hide…' }).click();
  if ((await call.getByLabel('Name of the hidden customer').inputValue()) !== 'customer') errors.push('rec-hide-secret: the name was not proposed');
  await call.getByRole('button', { name: 'Hide', exact: true }).click();
  await review.getByRole('button', { name: /^Attach 1 / }).click().catch(() => errors.push('rec-hide-secret: could not attach'));
};

// A post sent gzip'd, as big JSON APIs do: the review shows it unpacked, its password hidden, never the
// raw bytes as garbled text.
PAGES['rec-gzip'] = '/worker.html';
RUN['rec-gzip'] = async ({ page, errors, shop }) => {
  await startRecording(page, shop, 'This tab');
  await inTime(shop.evaluate(async () => {
    const packed = new Blob([JSON.stringify({ name: 'Echidna', password: 'hunter2' })]).stream().pipeThrough(new CompressionStream('gzip'));
    await fetch('/rec/items', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }, body: await new Response(packed).arrayBuffer() });
  }), "rec-gzip: the gzip'd post", errors);
  const review = await stopRecording(page, shop);
  const post = review.locator('details.recording-call', { hasText: '/rec/items' }).first();
  await post.locator('.recording-url').click();
  const sent = await post.locator('.recording-body').first().innerText().catch(() => '');
  if (!sent.includes('Echidna') || !sent.includes('"password": "••••"') || sent.includes('hunter2')) errors.push(`rec-gzip: the post shows ${JSON.stringify(sent.slice(0, 200))}`);
  await review.getByRole('button', { name: 'Discard' }).click();
};
