// The documentation's screenshots (docs/images/), made again from the built extension:
//   pnpm build && CHROMIUM_PATH=<a Chromium build> node scripts/docs-screenshots/index.mjs
// Headless, like the e2e: a scripted OpenAI-compatible model, a demo store (page.html) and a few demo
// sites, all on a local server that the browser reaches under example.com names. No real site, account
// or key is used.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { actionPart } from '../../tests/e2e/lib.mjs';

// A build with a key from the environment has a provider of its own, which the pictures would show.
if (process.env.EXTERNAL_MODEL_API_KEY) {
  console.log('Build and run without EXTERNAL_MODEL_API_KEY: env -u EXTERNAL_MODEL_API_KEY pnpm build && …');
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve('docs/images');
const PORT = 8795;
const SHOP = 'http://shop.example.com';
const LLM = 'http://llm.example.com/v1';
const MODEL = 'example-model';
const HOSTS = ['shop.example.com', 'deals.example.com', 'status.example.com', 'llm.example.com'];

// What the user asks in each picture; the scripted model answers by it.
const ASK = 'Add the tent in Forest green to my cart.';
const CHOOSE = 'Help me choose this tent for two people and add it to my cart.';
const SALE = 'Is this tent on sale?';
const DEALS = 'Compare today\'s deals: price and discount, as a table.';
const STATUS = 'Summarize the open incidents.';

// The model's answer to a request: a page widget action's, or the chat's turn by what the user asked
// and the tool results so far.
function reply(body) {
  const messages = body.messages ?? [];
  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  if (String(system).includes('request made from a button on a web page')) {
    return { content: '**Most liked:** easy to pitch alone and dry in heavy rain.\n\n**Watch out:** tight for two tall people; some condensation below freezing.' };
  }
  const page = messages.filter((m) => m.role === 'user').map((m) => (typeof m.content === 'string' ? m.content : (m.content ?? []).map((p) => p.text ?? '').join('\n'))).join('\n');
  const ref = (re) => re.exec(page)?.[1];
  const done = messages.filter((m) => m.role === 'tool').length;
  if (page.includes(CHOOSE)) return choose(done);
  if (page.includes(SALE)) return { content: 'Not this week: the **Trailhead 2 Tent** is at its regular price, **$249.00**. The 3 person size is $40 more.' };
  if (page.includes(DEALS)) {
    return { content: '| Product | Price | Discount |\n|---|---|---|\n| Trail Runner Shoes | $89.00 | 30% |\n| Camp Stove Mini | $34.50 | 25% |\n| Down Sleeping Bag | $179.00 | 20% |\n\nThe **Trail Runner Shoes** have the largest discount.' };
  }
  if (page.includes(STATUS)) return { content: 'Two incidents are open:\n\n- **Slow uploads** in Storage, *investigating* since 09:12.\n- **Delayed emails** in Notifications, *monitoring* since 08:40.\n\nEverything else is operational.' };
  if (done === 0) {
    return {
      reasoning: 'The page has a Color selector, currently "Sand", and an "Add to cart" button. Choose "Forest green" first, then add it.',
      content: 'I will choose **Forest green** and add the tent to your cart.',
      call: { name: 'browser__select', args: { ref: ref(/combobox "Color" \[(ref_\d+)\]/), value: 'Forest green' } },
    };
  }
  if (done === 1) return { call: { name: 'browser__click', args: { ref: ref(/button "Add to cart" \[(ref_\d+)\]/) } } };
  return { content: 'Done: the **Trailhead 2 Tent** in **Forest green** (2 person, $249.00) is in your cart. The button now reads "Added ✓".' };
}

// A plan, then the questions it needs answered.
function choose(done) {
  if (done === 0) {
    return {
      content: 'Here is my plan.',
      call: { name: 'user__plan', args: { steps: [{ title: 'Read the product page', status: 'done' }, { title: 'Ask you for the color and size', status: 'in_progress' }, { title: 'Add the tent to your cart', status: 'pending' }] } },
    };
  }
  return {
    call: { name: 'user__ask', args: { questions: [
      { question: 'Which color do you want?', header: 'Color', type: 'choice', options: [{ label: 'Sand' }, { label: 'Forest green' }, { label: 'Slate blue' }] },
      { question: 'Which size?', header: 'Size', type: 'choice', options: [{ label: '2 person', description: '$249.00' }, { label: '3 person', description: '$289.00, roomier for tall people' }] },
    ] } },
  };
}

// The answer as a stream of OpenAI-compatible chunks.
function stream(res, { reasoning, content, call }) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  const send = (delta, finish = null) => res.write(`data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', model: MODEL, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
  if (reasoning) send({ reasoning_content: reasoning });
  if (content) send({ content });
  if (call) send({ tool_calls: [{ index: 0, id: `call_${Date.now()}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }] });
  send({}, call ? 'tool_calls' : 'stop');
  res.write(`data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: 7400, completion_tokens: 60, total_tokens: 7460 } })}\n\n`);
  res.end('data: [DONE]\n\n');
}

// The demo sites' icons, and their pages besides the store's tent: a title, a heading and some content.
const SITES = {
  'shop.example.com': { color: '#2f6f4e', letter: 'E' },
  'deals.example.com': { color: '#c2410c', letter: 'D' },
  'status.example.com': { color: '#1d4ed8', letter: 'S' },
};
const PAGES = {
  'shop.example.com/packs/ridge-30': ['Ridge 30 Pack · Example Outfitters', 'Ridge 30 Pack', '<p>A 30 liter daypack with a rain cover. <b>$119.00</b></p>'],
  'deals.example.com/': ['Today\'s deals · Example Deals', 'Today\'s deals', '<table><tr><th>Product</th><th>Price</th><th>Discount</th></tr><tr><td>Trail Runner Shoes</td><td>$89.00</td><td>30%</td></tr><tr><td>Camp Stove Mini</td><td>$34.50</td><td>25%</td></tr><tr><td>Down Sleeping Bag</td><td>$179.00</td><td>20%</td></tr></table>'],
  'status.example.com/': ['Status · Example Cloud', 'System status', '<ul><li>Storage: slow uploads (investigating since 09:12)</li><li>Notifications: delayed emails (monitoring since 08:40)</li><li>API, Dashboard, Billing: operational</li></ul>'],
};
const simplePage = ([title, heading, body]) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><link rel="icon" href="/favicon.svg">
  <style>body{margin:0;font:15px/1.55 system-ui,sans-serif;color:#1f2a24;background:#f7f8f6;padding:32px 48px}td,th{padding:6px 14px;text-align:left;border-bottom:1px solid #e3e8e4}</style>
  </head><body><h1>${heading}</h1>${body}</body></html>`;
const favicon = ({ color, letter }) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="${color}"/><text x="8" y="12" font-family="Arial" font-size="11" font-weight="700" fill="#fff" text-anchor="middle">${letter}</text></svg>`;

const server = http.createServer((req, res) => {
  const host = (req.headers.host ?? '').split(':')[0];
  if (host === 'llm.example.com') {
    if (req.url.endsWith('/models')) return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ data: [{ id: MODEL }] }));
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => stream(res, reply(JSON.parse(raw || '{}'))));
    return;
  }
  if (req.url === '/favicon.svg' && SITES[host]) return res.writeHead(200, { 'Content-Type': 'image/svg+xml' }).end(favicon(SITES[host]));
  const simple = PAGES[`${host}${req.url}`];
  if (simple) return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(simplePage(simple));
  if (host !== 'shop.example.com' || req.url === '/favicon.ico') return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(fs.readFileSync(path.join(here, 'page.html')));
});

// A copy of the build that may read the demo hosts (the user grants a site from the chat or Settings).
function granting(dir, origins) {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-shots-ext-'));
  fs.cpSync(dir, copy, { recursive: true });
  const file = path.join(copy, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  manifest.host_permissions = [...(manifest.host_permissions ?? []), ...origins];
  fs.writeFileSync(file, JSON.stringify(manifest));
  return copy;
}

const widgetAction = (id, name, icon, prompt, label) => ({
  id, enabled: true, name, icon, where: [`${SHOP}/*`], input: 'none', tool: '', args: {},
  reads: { reviews: '{{selector:section.reviews}}' }, prompt, providerId: 'env', model: MODEL, outputs: [{ label }],
});
const ACTIONS = [
  widgetAction('reviews', 'Summarize reviews', '★', 'Summarize these reviews in two short lines, what people like and what to watch out for: {reviews}', 'Reviews'),
  widgetAction('questions', 'Questions to ask', '?', 'From these reviews, list three questions to ask before buying: {reviews}', 'Questions'),
];
const AGENTS = [
  { id: 'shopper', enabled: true, name: 'Shopper', icon: '🛒', description: 'Compares products and fills carts on store sites.', instructions: 'Always state prices with their currency.', tools: ['browser.read_page', 'browser.find', 'browser.click', 'browser.select', 'browser.type'], skills: [], templates: [], sites: { 'store.example.org': 'ask' }, canAsk: false, canBeAsked: true },
  { id: 'research', enabled: true, name: 'Research', icon: '🔎', description: 'Searches the web and summarizes what it reads.', instructions: '', tools: ['web.search', 'web.read'], skills: [], templates: [], sites: {}, canAsk: true, canBeAsked: false },
];
const ACCESS = ['sites', 'onlyItsSites', 'tools', 'canAsk', 'canBeAsked', 'enabled'];
const skill = (name, description, body) => ({ name, description, matches: [], body, references: [] });
const SKILLS = [{ id: 'product-compare', enabled: true, ...skill('product-compare', 'Compares products as a table: price, weight and rating.', 'Read each product page, then answer with one table.') }];
// What Settings → Skills is given to import: one of the user's again, a new one, a built-in's name.
const IMPORTED = { skills: [
  skill('product-compare', 'Compares products as a table: price, weight, rating and warranty.', 'Read each product page, then answer with one table and a recommendation.'),
  skill('shipping-check', 'Checks delivery dates and costs before checkout.', 'Find the delivery options on the cart page and list each one with its cost and date.'),
  skill('summarize-page', 'Summarizes the page.', 'Summarize it.'),
] };

// The extension's storage as a user would have it: one provider, page widget actions, two agents, a skill.
async function seed(sw) {
  await sw.evaluate(async ({ LLM, MODEL, actionParts, ACTIONS, AGENTS, ACCESS, SKILLS }) => {
    const kept = {
      sitePolicies: { browser: {} },
      settings: { providers: { env: { baseURL: LLM, apiKey: 'example-key' } } },
      agentAccess: Object.fromEntries(AGENTS.map((a) => [a.id, Object.fromEntries(ACCESS.map((f) => [f, a[f]]))])),
      customToolSecrets: {},
      widgetActions: actionParts,
      moved: Object.fromEntries(['mcpAuth', 'sitePolicies', 'actionLog', 'settingsSecrets', 'agentAccess', 'customToolSecrets', 'customToolSourceSecrets', 'widgetActions', 'mcpProviderIds'].map((id) => [id, true])),
    };
    await navigator.locks.request('secrets', () => new Promise((resolve, reject) => {
      const open = indexedDB.open('browser-agent', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('secrets');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction('secrets', 'readwrite');
        const secrets = tx.objectStore('secrets');
        secrets.clear();
        for (const [name, value] of Object.entries(kept)) secrets.put(value, name);
        tx.oncomplete = () => (open.result.close(), resolve());
        tx.onerror = () => reject(tx.error);
      };
    }));
    await chrome.storage.local.clear();
    await chrome.storage.local.set({
      pageActions: { user: ACTIONS, disabledBuiltins: [] },
      agents: { user: AGENTS.map((a) => Object.fromEntries(Object.entries(a).filter(([k]) => !ACCESS.includes(k)))), disabledBuiltins: [] },
      skills: { user: SKILLS, disabledBuiltins: [] },
      pageWidgetPlaces: {},
      settings: {
        providers: [{ id: 'env', name: 'Example LLM', baseURL: LLM, apiKey: '', defaultModel: MODEL }],
        activeProviderId: 'env',
        chatView: { steps: 'inline' },
        pageWidget: { everywhere: false },
      },
    });
  }, { LLM, MODEL, actionParts: Object.fromEntries(ACTIONS.map((a) => [a.id, actionPart(a)])), ACTIONS, AGENTS, ACCESS, SKILLS });
}

const dataUrl = (file) => `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
const DOT = (color) => `<span style="width:11px;height:11px;border-radius:50%;background:${color}"></span>`;

// `inner` in a plain browser window frame (its address bar showing `url`, the extension's icon at the
// right of the toolbar when `icon`), as one picture.
async function framed(ctx, file, url, inner, icon) {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1500, height: 900 });
  const button = icon ? `<span style="margin-left:auto;width:26px;height:26px;border-radius:6px;background:#dfe6df;display:grid;place-items:center"><img src="${dataUrl(icon)}" width="16" height="16"></span>` : '';
  await page.setContent(`<body style="margin:0;background:#e9ece9;padding:24px;font:13px system-ui">
    <div style="display:inline-block;border-radius:12px;overflow:hidden;box-shadow:0 10px 40px #0003;background:#fff">
      <div style="height:34px;background:#f1f3f1;display:flex;align-items:center;gap:8px;padding:0 14px;border-bottom:1px solid #dfe3df">
        ${DOT('#ec6a5e')}${DOT('#f4bf4f')}${DOT('#61c554')}
        <span style="margin-left:18px;background:#fff;border:1px solid #dfe3df;border-radius:6px;padding:3px 12px;color:#555;flex:0 0 420px">${url}</span>${button}</div>
      ${inner}
    </div></body>`);
  await page.locator('body > div').screenshot({ path: path.join(OUT, file) });
  await page.close();
}

// The page and the panel side by side.
const sideBySide = (ctx, file, left, right) => framed(ctx, file, 'shop.example.com/tents/trailhead-2',
  `<div style="display:flex"><img src="${dataUrl(left)}" style="width:960px;height:800px;display:block"><img src="${dataUrl(right)}" style="width:432px;height:800px;display:block;border-left:1px solid #dfe3df"></div>`);

// A new side panel page (a tab), the chat working on the web tab visited last.
async function openPanel(ctx, extId) {
  const panel = await ctx.newPage();
  await panel.setViewportSize({ width: 432, height: 800 });
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  return panel;
}
async function say(chat, text) {
  const box = chat.getByPlaceholder(/Ask something/);
  await box.waitFor({ timeout: 10_000 });
  await box.fill(text);
  await box.press('Enter');
}

// 1. The chat: a question, the model's step, the confirmation card; then the turn done.
async function chatShots(ctx, extId, shop, tmp) {
  const panel = await openPanel(ctx, extId);
  await say(panel, ASK);
  const card = panel.getByRole('alertdialog');
  await card.waitFor({ timeout: 20_000 });
  await shop.screenshot({ path: path.join(tmp, 'page.png') });
  await panel.screenshot({ path: path.join(tmp, 'confirm.png') });
  await sideBySide(ctx, 'chat-confirm.png', path.join(tmp, 'page.png'), path.join(tmp, 'confirm.png'));
  await card.getByRole('button', { name: 'Allow', exact: true }).click();
  await panel.getByRole('alertdialog').waitFor({ timeout: 20_000 });
  await panel.getByRole('alertdialog').getByRole('button', { name: 'Allow', exact: true }).click();
  await panel.getByText(/is in your cart/).waitFor({ timeout: 20_000 });
  await panel.evaluate(() => document.querySelectorAll('details.reasoning').forEach((d) => (d.open = true)));
  await shop.evaluate(() => scrollTo(0, 0));
  await shop.screenshot({ path: path.join(tmp, 'page-done.png') });
  await panel.screenshot({ path: path.join(tmp, 'done.png') });
  await sideBySide(ctx, 'chat.png', path.join(tmp, 'page-done.png'), path.join(tmp, 'done.png'));
  await panel.close();
}

// 3. The toolbar button's popup, open over the top right of the store page.
async function popupShot(ctx, extId, shop, tmp) {
  await shop.goto(`${SHOP}/tents/trailhead-2`); // the widget's card closed
  await shop.screenshot({ path: path.join(tmp, 'page-top.png'), clip: { x: 1280 - 720, y: 0, width: 720, height: 500 } });
  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 300, height: 400 });
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await shop.bringToFront();
  await popup.locator('.popup').screenshot({ path: path.join(tmp, 'popup.png') });
  await popup.close();
  await framed(ctx, 'popup.png', 'shop.example.com/tents/trailhead-2',
    `<div style="position:relative;width:720px;height:500px"><img src="${dataUrl(path.join(tmp, 'page-top.png'))}" style="display:block;opacity:.85">
      <img src="${dataUrl(path.join(tmp, 'popup.png'))}" style="position:absolute;top:4px;right:8px;border:1px solid #d5dbd5;border-radius:10px;box-shadow:0 8px 28px #0003"></div>`,
    path.resolve('dist/chrome-mv3/icon/32.png'));
}

// 2. The page widget: its bubble's actions, then an action's card with the model's answer.
async function widgetShots(shop) {
  await shop.setViewportSize({ width: 1280, height: 800 });
  await shop.goto(`${SHOP}/tents/trailhead-2`);
  await shop.waitForTimeout(1500);
  const box = { x: 1234, y: 754 };
  await shop.mouse.click(box.x, box.y);
  await shop.waitForTimeout(800);
  await shop.screenshot({ path: path.join(OUT, 'widget-bubble.png'), clip: { x: 1280 - 200, y: 800 - 260, width: 200, height: 260 } });
  await shop.mouse.click(box.x, box.y - 48); // the first action's button, above the bubble
  await shop.waitForTimeout(2500);
  await shop.screenshot({ path: path.join(OUT, 'widget-action.png') });
}

// 4. The tab picker: the chat works on the store's tent (its first turn ran there) while you are on
// another tab; a second window has two more sites. The panel is a window of its own here, left out of
// the picker as the extension's own windows are (the real side panel is not a tab).
async function tabPickerShot(ctx, sw, extId, shop) {
  const pack = await ctx.newPage();
  await pack.goto(`${SHOP}/packs/ridge-30`);
  await sw.evaluate(async () => {
    await chrome.windows.create({ url: ['http://deals.example.com/', 'http://status.example.com/'], focused: false });
  });
  await shop.bringToFront();
  const opened = ctx.waitForEvent('page', { predicate: (p) => p.url().includes('/sidepanel.html') });
  await sw.evaluate(async (url) => {
    const own = await chrome.windows.create({ url, type: 'popup', width: 432, height: 800, focused: false });
    await chrome.storage.session.set({ backgroundTabWindows: [own.id] });
  }, `chrome-extension://${extId}/sidepanel.html`);
  const panel = await opened;
  await panel.setViewportSize({ width: 432, height: 800 });
  await say(panel, SALE);
  await panel.getByText(/regular price/).waitFor({ timeout: 20_000 });
  await pack.bringToFront();
  await panel.getByRole('button', { name: /^Working on:/ }).click({ timeout: 10_000 });
  await panel.locator('.tab-picker-tab').first().waitFor({ timeout: 10_000 });
  await panel.waitForTimeout(800); // the icons
  await panel.screenshot({ path: path.join(OUT, 'tab-picker.png') });
  await panel.close();
  await pack.close();
}

// 5. The model asks: its plan pinned above the message box and its questions in a card.
async function askShot(ctx, extId, shop) {
  await shop.bringToFront();
  const panel = await openPanel(ctx, extId);
  await say(panel, CHOOSE);
  await panel.getByText('The model asks').waitFor({ timeout: 20_000 });
  await panel.waitForTimeout(500);
  await panel.screenshot({ path: path.join(OUT, 'user-ask.png') });
  await panel.close();
}

// 5b. A recording of the store's requests, reviewed in the chat: its calls (the account's ⚠ one left
// unticked), then what the model gets. The recording is handed to the chat as the background does.
const RECORDED = (now) => {
  const call = (id, method, pathAndQuery, status, at, more) => ({ id, method, url: `${SHOP}${pathAndQuery}`, status, at: now - at, included: true, responseType: 'application/json', ...more });
  return {
    tabId: 1, site: 'shop.example.com', startedAt: now - 38_000, endedAt: now, hidden: [], preset: 'API calls', leftOut: 5,
    calls: [
      call('1', 'GET', '/api/search?q=tent', 200, 30_000, { responseBody: '{"items":[{"id":"trailhead-2","name":"Trailhead 2","price":189}]}' }),
      call('2', 'POST', '/api/cart', 201, 20_000, { requestBody: '{"item":"trailhead-2","color":"Forest green","qty":1}', responseBody: '{"cart":"c-4471","count":1}' }),
      call('3', 'GET', '/api/cart/c-4471', 200, 15_000, { responseBody: '{"cart":"c-4471","items":[{"id":"trailhead-2","qty":1}],"total":189}' }),
      call('4', 'GET', '/api/account', 200, 10_000, { responseBody: '{"name":"Demo User","email":"demo@example.com"}', included: false }),
    ],
  };
};
async function recordingShots(ctx, sw, extId) {
  const panel = await openPanel(ctx, extId);
  await panel.getByPlaceholder(/Ask something/).waitFor({ timeout: 10_000 });
  await sw.evaluate((recording) => chrome.storage.session.set({ recordingHandoff: { at: Date.now(), recording } }), RECORDED(Date.now()));
  const review = panel.getByRole('dialog', { name: 'Recording review' });
  await review.waitFor({ timeout: 10_000 });
  await panel.waitForTimeout(300);
  await panel.screenshot({ path: path.join(OUT, 'recording-review.png') });
  await review.locator('details[data-section="calls"] > summary').click();
  await review.locator('details[data-section="model"] > summary').click();
  await panel.waitForTimeout(300);
  await panel.screenshot({ path: path.join(OUT, 'recording-preview.png') });
  await review.getByRole('button', { name: 'Discard' }).click();
  await panel.close();
}

// 6. The agent manager: two agents done, the third waiting for you on the store.
async function managerShot(ctx, extId) {
  const manager = await ctx.newPage();
  await manager.setViewportSize({ width: 1280, height: 760 });
  await manager.goto(`chrome-extension://${extId}/manager.html`);
  const chat = () => manager.frameLocator('iframe.manager-frame:not([hidden])');
  const start = async (tabTitle, agent, text) => {
    await manager.getByRole('button', { name: '+ New agent', exact: true }).click();
    const tabs = manager.getByLabel('Work on tab');
    await tabs.locator('option').first().waitFor({ state: 'attached', timeout: 10_000 });
    const offered = await tabs.locator('option').allInnerTexts();
    await tabs.selectOption({ label: offered.find((t) => t.startsWith(tabTitle)) });
    const agents = await manager.getByLabel('Agent', { exact: true }).locator('option').allInnerTexts();
    await manager.getByLabel('Agent', { exact: true }).selectOption({ label: agents.find((a) => a.endsWith(agent)) });
    await manager.getByRole('button', { name: 'Start', exact: true }).click();
    await say(chat(), text);
  };
  await start('Status', 'Research', STATUS);
  await chat().getByText(/Two incidents are open/).waitFor({ timeout: 20_000 });
  await start('Today', 'Shopper', DEALS);
  await chat().getByText(/largest discount/).waitFor({ timeout: 20_000 });
  await start('Trailhead', 'Browser', ASK);
  await chat().getByRole('alertdialog').waitFor({ timeout: 20_000 });
  await manager.getByRole('listitem').getByText('Waiting for you').waitFor({ timeout: 10_000 });
  await manager.waitForTimeout(500);
  await manager.screenshot({ path: path.join(OUT, 'agent-manager.png') });
  await manager.close();
}

// 7. Settings: a provider unfolded, the agents, and a skills file about to be imported.
async function settingsShots(ctx, extId) {
  const options = await ctx.newPage();
  await options.setViewportSize({ width: 1280, height: 860 });
  await options.goto(`chrome-extension://${extId}/options.html#providers`);
  await options.getByText('Example LLM', { exact: true }).click();
  await options.waitForTimeout(800);
  await options.screenshot({ path: path.join(OUT, 'settings-providers.png') });
  await options.goto(`chrome-extension://${extId}/options.html#agents`);
  await options.waitForTimeout(800);
  await options.screenshot({ path: path.join(OUT, 'settings-agents.png') });
  await options.goto(`chrome-extension://${extId}/options.html#skills`);
  await options.getByRole('button', { name: 'Import ▾' }).click();
  await options.getByRole('menuitem', { name: 'Paste JSON…' }).click();
  await options.locator('.paste-json textarea').fill(JSON.stringify(IMPORTED, null, 2));
  await options.locator('.paste-json').getByRole('button', { name: 'Import', exact: true }).click();
  await options.locator('.import-preview').waitFor({ timeout: 10_000 });
  await options.waitForTimeout(400);
  await options.screenshot({ path: path.join(OUT, 'settings-import.png'), clip: { x: 240, y: 0, width: 800, height: 484 } }); // the list's head and the preview
  await options.close();
}

fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-shots-'));
const EXT = granting(path.resolve('dist/chrome-mv3'), HOSTS.map((h) => `http://${h}/*`));
await new Promise((r) => server.listen(PORT, r));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-shots-profile-'));
const ctx = await chromium.launchPersistentContext(profile, {
  headless: false,
  executablePath: process.env.CHROMIUM_PATH,
  colorScheme: 'light',
  args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, `--host-resolver-rules=${HOSTS.map((h) => `MAP ${h} 127.0.0.1:${PORT}`).join(', ')}`],
});
try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const extId = new URL(sw.url()).host;
  await seed(sw);
  const shop = await ctx.newPage();
  await shop.setViewportSize({ width: 960, height: 800 });
  await shop.goto(`${SHOP}/tents/trailhead-2`);
  for (const blank of ctx.pages().filter((p) => p.url() === 'about:blank')) await blank.close(); // the profile's first tab

  await chatShots(ctx, extId, shop, tmp);
  await widgetShots(shop);
  await popupShot(ctx, extId, shop, tmp);
  await tabPickerShot(ctx, sw, extId, shop);
  await askShot(ctx, extId, shop);
  await recordingShots(ctx, sw, extId);
  await managerShot(ctx, extId);
  await settingsShots(ctx, extId);
  console.log(`Screenshots in ${OUT}`);
} finally {
  await ctx.close();
  server.close();
  for (const dir of [EXT, tmp, profile]) fs.rmSync(dir, { recursive: true, force: true });
}
