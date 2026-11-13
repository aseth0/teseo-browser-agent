// The page widget: its actions, the floating chat, the action log.
import { actionPart, HELLO, HOST, PORT, QUIET_MS, setSecret, stored, storedSecret, T, waitFor } from '../lib.mjs';
import { apiCalls } from '../mock/state.mjs';
import { recordClipboard } from './helpers.mjs';
import { ACTIONS, AFTER, AGENT_PROFILES, APPEARANCE, CHAT_WINDOW, COMPACTION, CUSTOM_TOOLS, EXPECT, MODEL_OF, PAGE_ACTIONS, RUN } from './tables.mjs';
import { SCANNED_PDF, TEXT_PDF } from '../pdf-fixtures.mjs';

// The page widget: an action on the article page that runs api.search with the selected text.
Object.assign(PAGE_ACTIONS, {
  'page-widget': [{
    id: 'items', enabled: true, name: 'Search items', where: ['http://localhost/article'], input: 'text', placeholder: 'a word',
    tool: 'api.search', args: { query: '{input}' }, outputs: [{ label: 'Items', from: '[]', link: 'http://localhost/items/{value}' }],
  }],
});
CUSTOM_TOOLS['page-widget'] = CUSTOM_TOOLS['custom-http'];
// An agent's actions: "shop"'s shows on its site and runs its tool; "far"'s (an agent that uses only
// its sites, not this one) is not shown.
PAGE_ACTIONS['widget-agent'] = [
  { ...PAGE_ACTIONS['page-widget'][0], agent: 'shop' },
  { ...PAGE_ACTIONS['page-widget'][0], id: 'far', name: 'Far away', agent: 'far' },
];
CUSTOM_TOOLS['widget-agent'] = CUSTOM_TOOLS['custom-http'];
AGENT_PROFILES['widget-agent'] = [
  { id: 'shop', enabled: true, name: 'shop', description: '', instructions: '', tools: ['api.search'], skills: [], templates: [], sites: { [HOST]: 'read-only', localhost: 'read-only' }, canAsk: false, canBeAsked: false },
  { id: 'far', enabled: true, name: 'far', description: '', instructions: '', tools: ['api.search'], skills: [], templates: [], sites: { 'jira.test': 'ask' }, onlyItsSites: true, canAsk: false, canBeAsked: false },
];
MODEL_OF['widget-agent'] = 'basic';
// Actions as JSON (Settings → Actions): imported off, their agent by its name, exported back.
AFTER['widget-agent'] = async (page) => {
  const options = await page.context().newPage();
  await options.goto(page.url().replace('sidepanel.html', 'options.html#actions'));
  await options.getByRole('button', { name: 'Import ▾' }).click();
  await options.getByRole('menuitem', { name: 'Paste JSON…' }).click();
  const pasted = { name: 'Pasted lookup', where: ['http://localhost/article'], input: 'text', tool: 'api.search', args: { query: '{input}' }, outputs: [{ label: 'Items', from: '[]' }], agent: 'shop' };
  await options.locator('.paste-json textarea').fill(JSON.stringify({ actions: [pasted] }));
  await options.locator('.paste-json').getByRole('button', { name: 'Import', exact: true }).click();
  await options.locator('.import-preview').getByRole('button', { name: /^Import \d/ }).click();
  await options.getByText(/^Imported Pasted lookup/).waitFor({ timeout: T.short });
  if (await options.locator('.collection-table tr', { hasText: 'Pasted lookup' }).locator('input[type=checkbox]').isChecked()) throw new Error('imported on');
  const pageActions = await stored(options, 'pageActions');
  if (pageActions.user.find((a) => a.name === 'Pasted lookup')?.agent !== 'shop') throw new Error('imported without its agent');
  const copied = await recordClipboard(options);
  await options.getByRole('button', { name: 'Export ▾' }).click();
  await options.getByRole('menuitem', { name: /^Copy all as JSON/ }).click();
  const exported = JSON.parse((await copied()).at(-1)?.plain ?? '{}');
  const names = exported.actions?.map((a) => `${a.name}/${a.agent}`).join();
  if (names !== 'Search items/shop,Far away/far,Pasted lookup/shop') throw new Error(`exported: ${names}`);
  await options.close();
};
// Actions with a prompt: one with only the model (its own), one with a tool and two boxes from JSON.
PAGE_ACTIONS['widget-prompt'] = [
  { id: 'say', enabled: true, name: 'Translate', where: ['http://localhost/article'], input: 'selection', tool: '', args: {}, prompt: 'Translate to Spanish: {input}', providerId: 'env', model: 'widget-say', thinking: 'high', outputs: [{ label: 'Spanish' }] },
  { ...PAGE_ACTIONS['page-widget'][0], id: 'sum', name: 'Summarize items', prompt: 'Summarize the items for {input}', providerId: 'env', model: 'widget-json',
    outputs: [{ label: 'Summary', from: 'summary' }, { label: 'First', from: 'first' }] },
];
CUSTOM_TOOLS['widget-prompt'] = CUSTOM_TOOLS['custom-http'];
PAGE_ACTIONS['widget-fold'] = [{ id: 'fold', enabled: true, name: 'Report', where: ['http://localhost/article'], input: 'none', tool: '', args: {}, prompt: 'Write the report', providerId: 'env', model: 'fold-headings', outputs: [{ label: 'Report' }] }];
MODEL_OF['widget-fold'] = 'basic';
// On page load, with a value read from the page (its heading): a badge, the card at once, a cache.
PAGE_ACTIONS['widget-load'] = [{ id: 'load', enabled: true, name: 'Related items', where: ['http://localhost/article'], input: 'none', when: 'load',
  reads: { word: '{{selector:h1}}' }, tool: 'api.search', args: { query: '{word}' }, outputs: [{ label: 'Items', from: '[]' }] }];
CUSTOM_TOOLS['widget-load'] = CUSTOM_TOOLS['custom-http'];
// An action that opens the chat: its message, with the selection in it, sent at once by the panel.
PAGE_ACTIONS['widget-chat'] = [{ id: 'ask', enabled: true, name: 'Ask the chat', where: ['http://localhost/article'], input: 'selection', tool: '', args: {}, openChat: true, prompt: 'Explain this: {input}', outputs: [] }];
MODEL_OF['widget-chat'] = 'basic';
// The chat floating on the shop: it clicks "Buy now" there, allowed only once the frame is in full view.
PAGE_ACTIONS['widget-floating'] = [{ id: 'f', enabled: true, name: 'Shop info', where: ['http://localhost/shop.html'], input: 'none', tool: 'browser.list_tabs', args: {}, outputs: [{ label: 'Tabs' }] }];
// A conversation moved from a panel to float on the shop, an action's message sent into it, folded
// and shown again by the shortcut's message, then moved back to the side panel.
PAGE_ACTIONS['widget-move'] = [{ id: 'ask', enabled: true, name: 'Ask about it', where: ['http://localhost/shop.html'], input: 'none', tool: '', args: {}, openChat: true, prompt: 'Explain this page', outputs: [] }];
MODEL_OF['widget-move'] = 'basic';
// Settings → Appearance → Chat: the chat floats, first on the left, 420 px wide, the window's height.
Object.assign(APPEARANCE, { 'widget-floating': { bubbleIcon: 'bot' } });
Object.assign(COMPACTION, { compaction: { keepTurns: 1 }, 'compaction-trim': { keepTurns: 1, summarize: false }, 'compaction-tool': { keepTurns: 1 } });
Object.assign(CHAT_WINDOW, { 'widget-float-default': { opens: 'floating', side: 'left', width: 420, height: 'full' } });
PAGE_ACTIONS['widget-float-default'] = PAGE_ACTIONS['widget-move'];
MODEL_OF['widget-float-default'] = 'basic';
// The pinned conversation: floating on the shop, pinned from its bar, shown by the chat floating on
// the article's tab too; one tab runs a turn at a time, each shows the other's; unpinned, each tab back
// to its own; moved to the side panel or deleted, unpinned.
PAGE_ACTIONS['widget-sticky'] = [{ ...PAGE_ACTIONS['widget-floating'][0], where: ['http://localhost/*'] }, { ...PAGE_ACTIONS['widget-move'][0], where: ['http://localhost/*'], agent: 'helper' }];
// The site's agent ("shop", the first with it) answers the pinned conversation; the action is "helper"'s.
AGENT_PROFILES['widget-sticky'] = ['shop', 'helper'].map((id) => ({ id, enabled: true, name: id, description: '', instructions: '', tools: [], skills: [], templates: [], sites: { [HOST]: 'read-only', localhost: 'read-only' }, canAsk: false, canBeAsked: false }));
Object.assign(CHAT_WINDOW, { 'widget-sticky': { opens: 'floating' } });
MODEL_OF['widget-sticky'] = 'manager-slow';
EXPECT['widget-sticky'] = 'SLOW DONE'; // the side panel ends with the conversation moved there
// A floating chat's turn goes on through a reload of its page (its confirmation still waiting) and
// through the agent taking it to another page.
PAGE_ACTIONS['widget-turn-reload'] = [{ ...PAGE_ACTIONS['widget-floating'][0], where: ['http://localhost/*'] }];
ACTIONS['widget-turn-reload'] = { model: 'navigate', answer: 'Allow', expect: 'NAV OK' };
// Then the panel's own turn (the same model) is an action like the others.
ACTIONS['widget-floating'] = { model: 'act-click', answer: 'Allow', expect: 'ACT OK' };
MODEL_OF['widget-load'] = 'basic';
// An action that writes (an HTTP POST): asked in the card, by the widget's column in Website access.
PAGE_ACTIONS['widget-write'] = [{ id: 'add', enabled: true, name: 'Add item', where: ['http://localhost/article'], input: 'none', tool: 'api.add', args: { name: 'Echidna' }, outputs: [{ label: 'Created', from: 'created' }] }];
CUSTOM_TOOLS['widget-write'] = CUSTOM_TOOLS['custom-http-post'];
MODEL_OF['widget-write'] = 'basic';
MODEL_OF['widget-prompt'] = 'basic';
CUSTOM_TOOLS['action-save'] = CUSTOM_TOOLS['custom-http'];
// Saved by the model once the user allows it, marked as the model's, after a trial the card shows.
// The action log (Settings → Logs, for the session by default): the read ran without asking, the
// click was denied in its card; and the Logs page lists them.
AFTER['click-deny'] = async (page) => {
  // Written in batches (logs/actions), a moment after the calls.
  const logged = async () => (await page.evaluate(() => chrome.storage.session.get('actionLog'))).actionLog ?? [];
  await waitFor(async () => (await logged()).length >= 2, T.short);
  const actionLog = await logged();
  const brief = actionLog.map((e) => `${e.source}:${e.agent}:${e.tool}:${e.decision}:${e.ok}:${e.host ?? ''}`).reverse();
  if (brief.join() !== `chat:Browser:browser.find:free:true:,chat:Browser:browser.click:deny:false:${HOST}`) throw new Error(`action log: ${brief.join()}`);
  if (!actionLog[0].summary) throw new Error('the denied call has no summary');
  const options = await page.context().newPage();
  await options.goto(page.url().replace('sidepanel.html', 'options.html#logs'));
  const shown = await options.locator('.action-log').innerText({ timeout: T.short }).catch(() => '');
  await options.close();
  if (!shown.includes('browser.click') || !shown.includes('Denied') || !shown.includes('Without asking')) throw new Error(`Logs page: ${shown.slice(0, 200)}`);
};
AFTER['action-save'] = async (page) => {
  const pageActions = await stored(page, 'pageActions');
  const saved = pageActions?.user?.[0];
  if (saved?.name !== 'Search items' || saved.createdBy !== 'model' || saved.outputs?.[0]?.from !== '[]' || !saved.enabled) throw new Error(`saved: ${JSON.stringify(pageActions)}`);
};

// The widget lives in a closed shadow root, out of reach of the page and of Playwright's locators:
// the DevTools protocol sees through it. Clicks go as real mouse events (the widget ignores others).
async function widgetNodes(page) {
  const cdp = await page.context().newCDPSession(page);
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const inside = [];
  const walk = (node, shadow) => {
    if (shadow) inside.push(node);
    for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) walk(child, shadow || node.shadowRootType === 'closed');
  };
  walk(root, false);
  const text = (node) => (node.nodeType === 3 ? node.nodeValue : (node.children ?? []).map(text).join(' '));
  return { cdp, inside, text };
}
async function widgetText(page) {
  const { inside, cdp } = await widgetNodes(page);
  const all = inside.filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join(' ');
  await cdp.detach();
  return all.replace(/\s+/g, ' ');
}
// The widget's element of that name: a button's text or aria-label, an input's aria-label, or a class.
async function widgetNode(page, name) {
  const w = await widgetNodes(page);
  const attr = (n, a) => { const i = (n.attributes ?? []).indexOf(a); return i >= 0 ? n.attributes[i + 1] : undefined; };
  const named = (n) => attr(n, 'aria-label') === name || attr(n, 'arialabel') === name;
  const node = w.inside.find((n) => n.nodeName === 'BUTTON' && (w.text(n).trim() === name || named(n)))
    ?? w.inside.find((n) => named(n) || attr(n, 'class')?.split(' ').includes(name));
  if (!node) { await w.cdp.detach(); throw new Error(`no "${name}" in the widget`); }
  return { ...w, node };
}
async function widgetCenter(page, name) {
  const { cdp, node } = await widgetNode(page, name);
  const { model } = await cdp.send('DOM.getBoxModel', { backendNodeId: node.backendNodeId });
  await cdp.detach();
  const [x1, y1, , , x3, y3] = model.content;
  return [(x1 + x3) / 2, (y1 + y3) / 2];
}
// Its box on the page: [left, top, width, height].
async function widgetBox(page, name) {
  const { cdp, node } = await widgetNode(page, name);
  const { model } = await cdp.send('DOM.getBoxModel', { backendNodeId: node.backendNodeId });
  await cdp.detach();
  const [x1, y1, , , x3, y3] = model.border;
  return [x1, y1, x3 - x1, y3 - y1];
}
// Clicks it with a real mouse event, or rests the pointer on it.
const widgetClick = async (page, name) => page.mouse.click(...(await widgetCenter(page, name)));
const widgetHover = async (page, name) => page.mouse.move(...(await widgetCenter(page, name)));
// Whether the widget's button of that name can be clicked: the confirmation card's Allow works only
// once the card has been seen whole for a moment (widget/ui/confirm whenSeen).
async function widgetEnabled(page, name) {
  const { cdp, node } = await widgetNode(page, name);
  await cdp.detach();
  return !(node.attributes ?? []).includes('disabled');
}
// Whether the widget's element of that class is hidden.
async function widgetHidden(page, name) {
  const { cdp, node } = await widgetNode(page, name);
  await cdp.detach();
  return (node.attributes ?? []).includes('hidden');
}
// The value of the widget's input of that name.
async function widgetInputValue(page, name) {
  const { inside, cdp } = await widgetNodes(page);
  const node = inside.find((n) => n.nodeName === 'INPUT' && (n.attributes ?? []).includes(name));
  const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: node.backendNodeId });
  const { result } = await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: 'function () { return this.value; }', returnByValue: true });
  await cdp.detach();
  return result.value;
}


// Focuses the widget's input of that name.
async function widgetFocusInput(page, name) {
  const { inside, cdp } = await widgetNodes(page);
  const node = inside.find((n) => n.nodeName === 'INPUT' && (n.attributes ?? []).includes(name));
  await cdp.send('DOM.focus', { backendNodeId: node.backendNodeId });
  await cdp.detach();
}


RUN['widget-chat'] = async ({ page, errors, ctx, model }) => {
  const article = await ctx.newPage();
  await article.goto(`http://localhost:${PORT}/article`);
  if (!(await waitFor(async () => (await widgetText(article)).includes('✦')))) errors.push('widget chat: no bubble');
  await article.evaluate(() => {
    const p = document.querySelector('p');
    const range = document.createRange();
    range.setStart(p.firstChild, p.textContent.indexOf('PLATYPUS'));
    range.setEnd(p.firstChild, p.textContent.length);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await widgetHover(article, 'Agent').catch((e) => errors.push(`widget: ${e.message}`));
  await waitFor(async () => !(await widgetHidden(article, 'menu')));
  await widgetClick(article, 'Ask the chat').catch((e) => errors.push(`widget: ${e.message}`));
  // The panel (a tab here) sends it, in a new conversation, and the model answers.
  const sent = await waitFor(async () => {
    const shown = await page.locator('#root').innerText();
    return shown.includes('Explain this: PLATYPUS FACT.') && shown.includes(HELLO) && !shown.includes('hello'); // a new conversation
  });
  if (!sent) errors.push(`widget chat: not sent (${(await page.locator('#root').innerText()).replace(/\s+/g, ' ').slice(0, 300)})`);
  await article.close();
};

RUN['widget-floating'] = async ({ page, errors, shop }) => {
  await widgetHover(shop, 'Agent').catch((e) => errors.push(`widget: ${e.message}`));
  await waitFor(async () => !(await widgetHidden(shop, 'menu')));
  await widgetClick(shop, 'Open the chat here').catch((e) => errors.push(`widget: ${e.message}`));
  const floating = async () => {
    let frame;
    await waitFor(async () => (frame = shop.frames().find((f) => f.url().includes('sidepanel.html?floating'))) && (await frame.getByPlaceholder(/Ask something/).isVisible()));
    return frame;
  };
  const chat = await floating();
  if (!chat) throw new Error('floating: no chat on the page');
  if ((await shop.evaluate(() => [window.length, document.querySelectorAll('iframe').length].join())) !== '0,0') errors.push('floating: the page sees the frame');
  // Each chat holds the conversation it shows (history/held), seen from the others: the side panel and
  // the chat floating on a page share the locks, the frame in a site's page too.
  const held = (f) => f.evaluate(async () => (await navigator.locks.query()).held.map((l) => l.name).filter((n) => /^browser-agent:held:(chat|floating):/.test(n)).sort().join());
  if (!(await waitFor(async () => (await held(chat)).split(',').length >= 2 && (await held(chat)) === (await held(page))))) errors.push(`floating: the chats do not see each other's open conversations (${await held(page)} / ${await held(chat)})`);
  // No policy to choose in its page bar (the side panel has it): a page could lead clicks there.
  if (await chat.getByRole('combobox', { name: /^Policy on / }).count()) errors.push('floating: a policy select in its page bar');
  // PDFs dropped there are read too (pdf.js's worker and data from the frame's own origin): one with
  // text, one rendered to an image; taken out again before the turn.
  const dropped = await chat.evaluateHandle((pdfs) => {
    const dt = new DataTransfer();
    for (const { name, b64 } of pdfs) dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], name, { type: 'application/pdf' }));
    return dt;
  }, [{ name: 'report.pdf', b64: TEXT_PDF.toString('base64') }, { name: 'scan.pdf', b64: SCANNED_PDF.toString('base64') }]);
  await chat.getByPlaceholder(/Ask something/).dispatchEvent('drop', { dataTransfer: dropped });
  for (const name of ['Remove file report.pdf', 'Remove file scan.pdf', 'Remove image 1']) {
    await chat.getByRole('button', { name }).waitFor({ timeout: T.medium }).catch(async () => errors.push(`floating: no "${name}" (${(await chat.locator('.attachments').innerText().catch(() => '')).slice(0, 200)})`));
  }
  await chat.getByRole('button', { name: 'Remove file report.pdf' }).click().catch(() => {});
  await chat.getByRole('button', { name: 'Remove file scan.pdf' }).click().catch(() => {});
  if (await chat.locator('.attachment').count()) errors.push('floating: a scanned PDF\'s page stayed once the PDF was removed');
  // See-through (the page owns the frame's host): the card cannot be allowed.
  const seeThrough = (on) => shop.evaluate((on) => { for (const d of document.documentElement.children) if (d.tagName === 'BA-WIDGET') d.style.opacity = on ? '0.5' : ''; }, on);
  await seeThrough(true);
  await chat.getByPlaceholder(/Ask something/).fill('buy it');
  await chat.getByPlaceholder(/Ask something/).press('Enter');
  const allow = chat.getByRole('button', { name: 'Allow', exact: true });
  await allow.waitFor({ timeout: T.long }).catch(() => errors.push('floating: no confirmation'));
  if (!(await waitFor(() => allow.isDisabled(), T.short))) errors.push('floating: Allow works while see-through');
  if (!(await chat.getByText(/Allowing works only while the chat is in full view/).isVisible())) errors.push('floating: no note');
  // Folded while the card waits: the bubble says so (and shows the icon chosen in Appearance); a
  // click on it brings the chat back.
  const bubble = async () => {
    const { cdp, node, inside } = await widgetNode(shop, 'Agent');
    await cdp.detach();
    const at = (node.attributes ?? []).indexOf('class');
    const svg = inside.some((n) => n.nodeName === 'svg' || n.nodeName === 'SVG');
    return { classes: at >= 0 ? node.attributes[at + 1].split(' ') : [], svg };
  };
  await widgetClick(shop, 'Fold it (the bubble brings it back)').catch((e) => errors.push(`widget: ${e.message}`));
  if (!(await waitFor(async () => (await bubble()).classes.includes('waiting'), T.short))) errors.push(`floating: the folded bubble does not say it waits (${(await bubble()).classes})`);
  if (!(await bubble()).svg) errors.push('floating: the bubble does not show the chosen icon');
  await widgetClick(shop, 'Agent').catch((e) => errors.push(`widget: ${e.message}`));
  if (!(await waitFor(async () => !(await bubble()).classes.includes('waiting'), T.short))) errors.push('floating: the bubble still says it waits with the chat shown');
  await seeThrough(false);
  if (!(await waitFor(async () => !(await allow.isDisabled()), T.short))) errors.push('floating: Allow stays off in full view');
  await allow.click();
  if (!(await waitFor(async () => (await chat.locator('#root').innerText()).includes('ACT OK')))) errors.push(`floating: ${(await chat.locator('#root').innerText()).replace(/\s+/g, ' ').slice(-200)}`);
  // Reloaded: it opens again, with the same conversation.
  await shop.reload();
  const again = await floating();
  if (!again || !(await waitFor(async () => (await again.locator('#root').innerText()).includes('ACT OK')))) errors.push('floating: not open again with its conversation after a reload');
  // Closed: not after the next reload.
  await widgetClick(shop, 'Close it (the conversation stays in the history)').catch((e) => errors.push(`widget: ${e.message}`));
  await shop.reload();
  // The widget is back on the page; the chat would open with it.
  if (!(await waitFor(async () => (await widgetText(shop)).trim().length > 0, T.medium))) errors.push('floating: no widget after the reload');
  await shop.waitForTimeout(QUIET_MS);
  if (shop.frames().some((f) => f.url().includes('sidepanel.html?floating'))) errors.push('floating: open again after closing it');
};

RUN['widget-move'] = async ({ page, errors, ctx, extId, shop, sw, action }) => {
  const floatingFrame = () => shop.frames().find((f) => f.url().includes('sidepanel.html?floating'));
  const frameText = async () => (await floatingFrame()?.locator('#root').innerText().catch(() => '')) ?? '';
  // A second panel (a tab here): its conversation floats on its page, the shop.
  const other = await ctx.newPage();
  await other.goto(`chrome-extension://${extId}/sidepanel.html`);
  await other.getByPlaceholder(/Ask something/).fill('move me');
  await other.getByPlaceholder(/Ask something/).press('Enter');
  if (!(await waitFor(async () => (await other.locator('#root').innerText()).includes(HELLO)))) errors.push('move: no answer in the panel');
  await other.getByRole('button', { name: 'Float on this page' }).click();
  if (!(await waitFor(async () => { const t = await frameText(); return t.includes('move me') && t.includes(HELLO); }))) errors.push(`move: not floating with its conversation (${(await frameText()).slice(0, 200)})`);
  if (!other.isClosed() && (await other.locator('#root').innerText()).includes('move me')) errors.push('move: still in the panel it left');
  if (!other.isClosed()) await other.close();
  // An action that opens the chat sends into the floating one, not the panel.
  await widgetHover(shop, 'Agent').catch((e) => errors.push(`widget: ${e.message}`));
  await waitFor(async () => !(await widgetHidden(shop, 'menu')));
  await widgetClick(shop, 'Ask about it').catch((e) => errors.push(`widget: ${e.message}`));
  if (!(await waitFor(async () => { const t = await frameText(); return t.includes('Explain this page') && t.includes(HELLO) && !t.includes('move me'); }))) errors.push(`move: the action's message not in the floating chat (${(await frameText()).slice(0, 200)})`);
  if ((await page.locator('#root').innerText()).includes('Explain this page')) errors.push('move: the action went to the side panel too');
  // The shortcut folds it, and shows it again.
  const chatShown = () => shop.evaluate(() => [...document.documentElement.children].filter((d) => d.tagName === 'BA-WIDGET').pop()?.style.display !== 'none');
  const shortcut = () => sw.evaluate(async () => { const [t] = await chrome.tabs.query({ url: 'http://localhost/shop.html' }); await chrome.tabs.sendMessage(t.id, { type: 'browser-agent:widget-float', toggle: true }); });
  await shortcut();
  if (!(await waitFor(async () => !(await chatShown()), 2000))) errors.push('move: the shortcut did not fold it');
  await shortcut();
  if (!(await waitFor(chatShown, 2000))) errors.push('move: the shortcut did not show it again');
  // Back to the side panel from the floating chat's own bar, not its chat's (the panel tab here takes
  // it): opened, the floating chat closes; not, it starts anew.
  if (await floatingFrame().getByRole('button', { name: 'Open in the side panel' }).count()) errors.push('move: the button still in the floating chat');
  await widgetClick(shop, 'Open in the side panel').catch((e) => errors.push(`widget: ${e.message}`));
  if (!(await waitFor(async () => (await page.locator('#root').innerText()).includes('Explain this page')))) errors.push('move: not in the side panel');
  if (floatingFrame() && (await frameText()).includes('Explain this page')) errors.push('move: still floating');
};

RUN['widget-turn-reload'] = async ({ errors, shop }) => {
  const frameOf = () => shop.frames().find((f) => f.url().includes('sidepanel.html?floating'));
  const floating = async () => {
    let frame;
    await waitFor(async () => (frame = frameOf()) && (await frame.getByPlaceholder(/Ask something/).isVisible()));
    return frame;
  };
  await widgetHover(shop, 'Agent').catch((e) => errors.push(`widget: ${e.message}`));
  await waitFor(async () => !(await widgetHidden(shop, 'menu')));
  await widgetClick(shop, 'Open the chat here').catch((e) => errors.push(`widget: ${e.message}`));
  const chat = await floating();
  if (!chat) throw new Error('turn reload: no floating chat');
  await chat.getByPlaceholder(/Ask something/).fill('go to the deals');
  await chat.getByPlaceholder(/Ask something/).press('Enter');
  await chat.getByRole('button', { name: 'Allow', exact: true }).waitFor({ timeout: T.long }).catch(() => errors.push('turn reload: no confirmation'));
  // Reloaded while it waits: the chat opens again with the turn, its question still waiting.
  await shop.reload();
  const again = await floating();
  const allow = again?.getByRole('button', { name: 'Allow', exact: true });
  if (!again || !(await allow.waitFor({ timeout: T.long }).then(() => true, () => false))) errors.push(`turn reload: the question did not come back (${(await again?.locator('#root').innerText().catch(() => ''))?.replace(/\s+/g, ' ').slice(0, 200)})`);
  else {
    if (!(await again.locator('#root').innerText()).includes('go to the deals')) errors.push('turn reload: the message did not come back');
    await waitFor(async () => !(await allow.isDisabled()), T.short);
    await allow.click();
    // The agent takes the tab to the deals: the chat floats there and the turn ends in it.
    const done = await waitFor(async () => shop.url().endsWith('/deals') && (await frameOf()?.locator('#root').innerText().catch(() => ''))?.includes('NAV OK'), 15000);
    if (!done) errors.push(`turn reload: did not end on the deals (${shop.url()} ${(await frameOf()?.locator('#root').innerText().catch(() => ''))?.replace(/\s+/g, ' ').slice(-200)})`);
  }
  await shop.goto(`http://localhost:${PORT}/shop.html`); // the panel's own turn
};

RUN['widget-float-default'] = async ({ page, errors, ctx, extId, shop, action }) => {
  const floatingFrame = () => shop.frames().find((f) => f.url().includes('sidepanel.html?floating'));
  // The bubble's click floats the chat, where and as big as the settings say.
  await widgetClick(shop, 'Agent').catch((e) => errors.push(`widget: ${e.message}`));
  if (!(await waitFor(async () => !!floatingFrame()))) errors.push('float default: the bubble did not float the chat');
  const box = await shop.evaluate(() => { const r = [...document.documentElement.children].filter((d) => d.tagName === 'BA-WIDGET').pop().getBoundingClientRect(); return [r.left, r.top, r.width, r.height, innerHeight].map(Math.round).join(); });
  const height = Number(box.split(',')[4]) - 48;
  if (box !== `24,24,420,${height},${height + 48}`) errors.push(`float default: placed at ${box}`);
  // An action that opens the chat goes to it.
  await widgetHover(shop, 'Agent').catch((e) => errors.push(`widget: ${e.message}`));
  await waitFor(async () => !(await widgetHidden(shop, 'menu')));
  await widgetClick(shop, 'Ask about it').catch((e) => errors.push(`widget: ${e.message}`));
  const said = async () => (await floatingFrame()?.locator('#root').innerText().catch(() => '')) ?? '';
  if (!(await waitFor(async () => (await said()).includes('Explain this page') && (await said()).includes(HELLO)))) errors.push(`float default: the action's message not floating (${(await said()).slice(0, 200)})`);
  // The setting, in Settings → Bubble.
  const options = await ctx.newPage();
  await options.goto(`chrome-extension://${extId}/options.html#bubble`);
  await options.getByRole('tab', { name: 'Opening the chat' }).click();
  const opens = options.getByRole('group', { name: /^Its bubble, its actions that open the chat/ });
  if (!(await opens.getByRole('radio', { name: 'Floating on the page' }).isChecked().catch(() => false))) errors.push('float default: the setting is not shown');
  await opens.getByRole('radio', { name: 'In the side panel' }).check();
  await waitFor(async () => (await stored(options, 'settings')).chatWindow?.opens === 'panel', T.short);
  const saved = (await stored(options, 'settings')).chatWindow?.opens;
  if (saved !== 'panel') errors.push(`float default: the setting was not saved (${saved})`);
  await options.close();
};

RUN['widget-sticky'] = async ({ page, errors, ctx, extId, shop }) => {
  const DONE = 'SLOW DONE'; // each answer takes a few seconds (the mock's manager-slow)
  const frameOf = (tab) => tab.frames().find((f) => f.url().includes('sidepanel.html?floating'));
  const textOf = async (tab) => (await frameOf(tab)?.locator('#root').innerText().catch(() => '')) ?? '';
  const answers = async (tab) => (await textOf(tab)).split(DONE).length - 1;
  const floatOn = async (tab) => {
    await waitFor(async () => (await widgetText(tab)).trim().length > 0, T.medium); // the widget in the page
    await widgetHover(tab, 'Agent').catch((e) => errors.push(`widget: ${e.message}`));
    await waitFor(async () => !(await widgetHidden(tab, 'menu')));
    await widgetClick(tab, 'Open the chat here').catch((e) => errors.push(`widget: ${e.message}`));
    await waitFor(async () => frameOf(tab) && (await frameOf(tab).getByPlaceholder(/Ask something/).isVisible()));
    if (!frameOf(tab)) throw new Error(`sticky: no floating chat (${errors.join('; ')})`);
    return frameOf(tab);
  };
  const say = async (frame, text) => {
    await frame.getByPlaceholder(/Ask something/).fill(text);
    await frame.getByPlaceholder(/Ask something/).press('Enter');
  };
  const answered = async (tab, n, what) => {
    if (!(await waitFor(async () => (await answers(tab)) >= n, T.turn))) errors.push(`sticky: no answer ${what} (${(await textOf(tab)).replace(/\s+/g, ' ').slice(-200)})`);
  };
  const PIN = 'Pin this conversation';
  const pinOn = async (tab) => {
    const w = await widgetNode(tab, PIN).catch(() => undefined);
    if (!w) return undefined;
    await w.cdp.detach();
    return (w.node.attributes ?? []).join(' ').includes('aria-pressed true');
  };
  const pinAttr = async (tab) => { const w = await widgetNode(tab, PIN); await w.cdp.detach(); const a = w.node.attributes ?? []; return { pressed: a[a.indexOf('aria-pressed') + 1], disabled: a.includes('disabled') }; };
  const pinned = async () => (await page.evaluate(() => chrome.storage.session.get('stickyChat'))).stickyChat?.conversationId;
  const article = await ctx.newPage();
  await article.goto(`http://localhost:${PORT}/article`);
  // The article's tab has a conversation of its own first.
  const articleChat = await floatOn(article);
  await say(articleChat, 'article own');
  await answered(article, 1, 'on the article');
  // The shop's: not pinned before it has a saved turn; then pinned, the pin shown on.
  await shop.bringToFront();
  const shopChat = await floatOn(shop);
  if (!(await pinAttr(shop)).disabled) errors.push('sticky: the pin works on an empty chat');
  await say(shopChat, 'pin me');
  await answered(shop, 1, 'on the shop');
  if (!(await waitFor(async () => !(await pinAttr(shop)).disabled, T.short))) errors.push('sticky: the pin stays off after a turn');
  await widgetClick(shop, PIN).catch((e) => errors.push(`widget: ${e.message}`));
  if (!(await waitFor(async () => !!(await pinned()), T.short))) errors.push('sticky: nothing pinned');
  if (!(await waitFor(async () => (await pinAttr(shop)).pressed === 'true', T.short))) errors.push('sticky: the pin is not shown on');
  // The article's open chat follows it, the pin shown on there too.
  await article.bringToFront();
  if (!(await waitFor(async () => { const t = await textOf(article); return t.includes('pin me') && !t.includes('article own'); }))) errors.push(`sticky: the other tab does not follow the pin (${(await textOf(article)).slice(0, 200)})`);
  if (!(await waitFor(async () => (await pinAttr(article)).pressed === 'true', T.short))) errors.push('sticky: the pin is not shown on in the other tab');
  // A turn running on the shop's tab: the article's waits, sends nothing (a message, nor Regenerate).
  await say(shopChat, 'long turn');
  if (!(await waitFor(async () => (await textOf(article)).includes('This conversation is answering in another tab'), T.medium))) errors.push('sticky: not shown as busy elsewhere');
  const before = await answers(article);
  await articleChat.getByPlaceholder(/Ask something/).fill('too soon');
  if (!(await articleChat.getByRole('button', { name: 'Send', exact: true }).isDisabled())) errors.push('sticky: Send works while it answers elsewhere');
  await articleChat.getByPlaceholder(/Ask something/).press('Enter');
  if (!(await waitFor(async () => (await textOf(article)).includes('Not sent: this conversation is answering in another tab'), T.short))) errors.push('sticky: no note on sending while it answers elsewhere');
  await articleChat.getByRole('button', { name: /^Regenerate: / }).first().dispatchEvent('click');
  await article.waitForTimeout(QUIET_MS);
  const runs = Object.values((await page.evaluate(() => chrome.storage.session.get('runningChats'))).runningChats ?? {});
  if ((await answers(article)) !== before || runs.length > 1) errors.push(`sticky: ran while it answers elsewhere (${runs})`);
  // That turn ended: shown here, with what the shop asked.
  await answered(shop, 2, 'to the long turn');
  if (!(await waitFor(async () => (await textOf(article)).includes('long turn') && (await answers(article)) >= 2, T.medium))) errors.push(`sticky: the article does not show the turn run on the shop (${(await textOf(article)).replace(/\s+/g, ' ').slice(-200)})`);
  // Sent from the article's tab (the text kept in the box), seen on the shop's once shown.
  const box = articleChat.getByPlaceholder(/Ask something/);
  if (!(await box.inputValue().catch(() => box.innerText())).includes('too soon')) errors.push('sticky: the message not sent left the box');
  await say(articleChat, 'from the article');
  await answered(article, 3, 'from the article');
  // A message queued during its turn goes once that turn ends (the chat's own run lock kept for it).
  await say(articleChat, 'queue one');
  await waitFor(async () => (await articleChat.getByRole('button', { name: 'Stop', exact: true }).count()) > 0, T.short);
  await say(articleChat, 'queued two');
  await answered(article, 5, 'to the queued message');
  if ((await textOf(article)).includes('Not sent')) errors.push(`sticky: the queued message was not sent (${(await textOf(article)).replace(/\s+/g, ' ').slice(-200)})`);
  await shop.bringToFront();
  if (!(await waitFor(async () => (await textOf(shop)).includes('queued two') && (await answers(shop)) >= 5))) errors.push(`sticky: the shop does not show the turn sent elsewhere (${(await textOf(shop)).slice(-200)})`);
  // Unpinned from the article: its own back there; the shop keeps the one it pinned.
  await article.bringToFront();
  await widgetClick(article, PIN).catch((e) => errors.push(`widget: ${e.message}`));
  if (!(await waitFor(async () => !(await pinned()), T.short))) errors.push('sticky: still pinned');
  if (!(await waitFor(async () => { const t = await textOf(article); return t.includes('article own') && !t.includes('pin me'); }))) errors.push(`sticky: the article's own conversation not back (${(await textOf(article)).slice(0, 200)})`);
  if (!(await textOf(shop)).includes('from the article')) errors.push('sticky: the shop lost its conversation once unpinned');
  if ((await page.locator('#root').innerText()).includes('pin me')) errors.push('sticky: the side panel shows it');
  // Pinned again, then moved to the side panel (◨): no longer pinned, the article back to its own.
  await shop.bringToFront();
  await widgetClick(shop, PIN).catch((e) => errors.push(`widget: ${e.message}`));
  if (!(await waitFor(async () => !!(await pinned()), T.short))) errors.push('sticky: not pinned again');
  await article.bringToFront();
  if (!(await waitFor(async () => (await textOf(article)).includes('pin me')))) errors.push('sticky: the article does not follow the pin again');
  // An action that opens the chat with its message (another agent's), on a tab showing the pinned one:
  // its own new conversation there, its message sent. Folded first: the chat may cover the bubble.
  await widgetClick(article, 'Fold it (the bubble brings it back)').catch((e) => errors.push(`widget: ${e.message}`));
  await widgetHover(article, 'Agent').catch((e) => errors.push(`widget: ${e.message}`));
  await waitFor(async () => !(await widgetHidden(article, 'menu')));
  await widgetClick(article, 'Ask about it').catch((e) => errors.push(`widget: ${e.message}`));
  if (!(await waitFor(async () => { const t = await textOf(article); return t.includes('Explain this page') && !t.includes('pin me') && (await answers(article)) >= 1; }, T.turn))) errors.push(`sticky: the action's message not sent on a tab showing the pinned one (${(await textOf(article)).replace(/\s+/g, ' ').slice(0, 200)})`);
  await shop.bringToFront();
  await widgetClick(shop, 'Open in the side panel').catch((e) => errors.push(`widget: ${e.message}`));
  if (!(await waitFor(async () => (await page.locator('#root').innerText()).includes('pin me')))) errors.push('sticky: not moved to the side panel');
  if (!(await waitFor(async () => !(await pinned()), T.short))) errors.push('sticky: still pinned once in the side panel');
  if (!(await waitFor(async () => !(await textOf(article)).includes('pin me')))) errors.push('sticky: the article still shows the conversation now in the side panel');
  // The article's own pinned, then deleted from the history: unpinned, a new one there, and saved.
  await widgetClick(article, PIN).catch((e) => errors.push(`widget: ${e.message}`));
  const ownId = await waitFor(pinned, T.short) && (await pinned());
  if (!ownId) errors.push("sticky: the article's own not pinned");
  await page.evaluate(async (id) => {
    const { convIndex = [] } = await chrome.storage.local.get('convIndex');
    await chrome.storage.local.remove(`conv:${id}`);
    await chrome.storage.local.set({ convIndex: convIndex.filter((c) => c.id !== id) });
  }, ownId);
  if (!(await waitFor(async () => !(await pinned()), T.short))) errors.push('sticky: a deleted conversation stays pinned');
  if (!(await waitFor(async () => !(await textOf(article)).includes('Explain this page')))) errors.push('sticky: the deleted conversation still shown');
  const afterDelete = await answers(article);
  await say(articleChat, 'after delete');
  await answered(article, afterDelete + 1, 'after the delete');
  const titles = async () => (await page.evaluate(() => chrome.storage.local.get('convIndex'))).convIndex.map((c) => c.title);
  if (!(await waitFor(async () => (await titles()).some((t) => t.startsWith('after delete')), T.short))) errors.push(`sticky: the conversation after the delete is not saved (${(await titles()).join(' | ')})`);
  // Pinned, an action that opens the chat with its message on a tab without it: its own new conversation.
  await widgetClick(article, PIN).catch((e) => errors.push(`widget: ${e.message}`));
  if (!(await waitFor(async () => !!(await pinned()), T.short))) errors.push('sticky: not pinned for the action');
  const third = await ctx.newPage();
  await third.goto(`http://localhost:${PORT}/shop.html`);
  await waitFor(async () => (await widgetText(third)).trim().length > 0, T.medium);
  await widgetHover(third, 'Agent').catch((e) => errors.push(`widget: ${e.message}`));
  await waitFor(async () => !(await widgetHidden(third, 'menu')));
  await widgetClick(third, 'Ask about it').catch((e) => errors.push(`widget: ${e.message}`));
  if (!(await waitFor(async () => (await textOf(third)).includes('Explain this page') && (await answers(third)) >= 1, T.turn))) errors.push(`sticky: the action's message not sent (${(await textOf(third)).slice(0, 200)})`);
  if ((await textOf(third)).includes('after delete')) errors.push('sticky: the action went into the pinned conversation');
  await third.close();
  await article.close();
};

RUN['widget-load'] = async ({ page, errors, ctx }) => {
  const article = await ctx.newPage();
  const before = apiCalls.length;
  await article.goto(`http://localhost:${PORT}/article`);
  // Run once the page settles: the bubble counts what it found, without a click.
  const badge = () => widgetNodes(article).then(async (w) => { await w.cdp.detach(); return w.inside.some((n) => n.nodeName === 'SPAN' && w.text(n).trim() === '1'); });
  if (!(await waitFor(badge))) errors.push(`widget load: no badge (${(await widgetText(article)).slice(-120)})`);
  if (!apiCalls.slice(before).some((u) => u.includes('q=Platypus'))) errors.push(`widget load: the page's value was not used (${apiCalls.slice(before)})`);
  // Its card opens at once with what it found, without another request.
  const calls = apiCalls.length;
  await widgetHover(article, 'Agent').catch((e) => errors.push(`widget: ${e.message}`));
  await waitFor(async () => !(await widgetHidden(article, 'menu')));
  await widgetClick(article, 'Related items').catch((e) => errors.push(`widget: ${e.message}`));
  if (!(await waitFor(async () => (await widgetText(article)).includes('Echidna')))) errors.push('widget load: no card');
  // Loaded again: the same value, from the cache.
  await article.reload();
  if (!(await waitFor(badge))) errors.push('widget load: no badge after a reload');
  if (apiCalls.length !== calls) errors.push(`widget load: not cached (${apiCalls.length - calls} more requests)`);
  await article.close();
};

RUN['widget-write'] = async ({ errors, ctx, sw, action }) => {
  const article = await ctx.newPage();
  await article.goto(`http://localhost:${PORT}/article`);
  if (!(await waitFor(async () => (await widgetText(article)).includes('✦')))) errors.push('widget: no bubble on the article');
  const press = async () => {
    await widgetHover(article, 'Agent').catch((e) => errors.push(`widget: ${e.message}`));
    await waitFor(async () => !(await widgetHidden(article, 'menu')));
    await widgetClick(article, 'Add item').catch((e) => errors.push(`widget: ${e.message}`));
  };
  // Done: the mock got the action's POST (the card shows "Echidna" before it is allowed, as what it adds).
  const posts = () => apiCalls.filter((u) => u === '/api/items').length;
  const done = async (before) => (await waitFor(async () => posts() > before)) && (await waitFor(async () => (await widgetText(article)).includes('Created')));
  // Asked first, in the card: denied, nothing is done.
  await press();
  if (!(await waitFor(async () => (await widgetText(article)).includes('On localhost')))) errors.push(`widget write: not asked (${(await widgetText(article)).slice(-200)})`);
  if ((await widgetText(article)).includes('Always on')) errors.push('widget write: the card in the page offers Always');
  await widgetClick(article, 'Deny').catch((e) => errors.push(`widget: ${e.message}`));
  if (!(await waitFor(async () => (await widgetText(article)).includes('Not done: you denied it.')))) errors.push(`widget write: deny (${(await widgetText(article)).slice(-200)})`);
  if (posts()) errors.push('widget write: sent although denied');
  // Allowed: done, once; no site policy saved from the page.
  await press();
  await waitFor(async () => (await widgetText(article)).includes('On localhost'));
  if (!(await waitFor(() => widgetEnabled(article, 'Allow')))) errors.push('widget write: Allow never enabled (the card is not seen)');
  await widgetClick(article, 'Allow').catch((e) => errors.push(`widget: ${e.message}`));
  if (!(await done(0))) errors.push(`widget write: not done (${posts()} requests; ${(await widgetText(article)).slice(-200)})`);
  const policy = (await storedSecret(sw, 'sitePolicies'))?.widget?.localhost;
  if (policy !== undefined) errors.push(`widget write: the site policy is ${policy}`);
  // Asked again the next time.
  await article.keyboard.press('Escape');
  await press();
  if (!(await waitFor(async () => (await widgetText(article)).includes('On localhost')))) errors.push('widget write: not asked again');
  await waitFor(() => widgetEnabled(article, 'Allow'));
  await widgetClick(article, 'Allow').catch((e) => errors.push(`widget: ${e.message}`));
  if (!(await done(1))) errors.push(`widget write: not done the third time (${posts()} requests)`);
  // In the action log: denied, then allowed twice.
  const widgetLog = await waitFor(async () => {
    const { actionLog = [] } = await sw.evaluate(() => chrome.storage.session.get('actionLog'));
    const brief = actionLog.filter((e) => e.source === 'widget').map((e) => e.decision).reverse().join();
    return brief === 'deny,allow,allow' && brief;
  });
  if (!widgetLog) errors.push(`widget write: action log ${JSON.stringify((await sw.evaluate(() => chrome.storage.session.get('actionLog'))).actionLog?.map((e) => [e.source, e.tool, e.decision]))}`);
  await article.close();
};

RUN['widget-prompt'] = async ({ page, errors, ctx, sw, model }) => {
  const article = await ctx.newPage();
  await article.goto(`http://localhost:${PORT}/article`);
  if (!(await waitFor(async () => (await widgetText(article)).includes('✦')))) errors.push('widget: no bubble on the article');
  const select = () => article.evaluate(() => {
    const p = document.querySelector('p');
    const range = document.createRange();
    range.setStart(p.firstChild, p.textContent.indexOf('PLATYPUS'));
    range.setEnd(p.firstChild, p.textContent.length);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await select();
  await widgetHover(article, 'Agent').catch((e) => errors.push(`widget: ${e.message}`));
  await waitFor(async () => !(await widgetHidden(article, 'menu')));
  // Only the model: its answer in the card, its reasoning folded.
  await widgetClick(article, 'Translate').catch((e) => errors.push(`widget: ${e.message}`));
  if (!(await waitFor(async () => (await widgetText(article)).includes('Hecho del ORNITORRINCO.')))) errors.push(`widget prompt: ${await widgetText(article)}`);
  if (!(await widgetText(article)).includes('Reasoning')) errors.push('widget prompt: no folded reasoning');
  // As Markdown, like the chat: the bold is an element, not asterisks.
  const bold = await widgetNodes(article).then(async (w) => { await w.cdp.detach(); return w.inside.some((n) => n.nodeName === 'STRONG'); });
  if (!bold || (await widgetText(article)).includes('**')) errors.push('widget prompt: the answer is not shown as Markdown');
  // Resized from its left edge (any edge or corner works): wider, and kept for the site.
  const [ex, ey] = await widgetCenter(article, 'w').catch((e) => (errors.push(`widget: ${e.message}`), [0, 0]));
  await article.mouse.move(ex, ey);
  await article.mouse.down();
  await article.mouse.move(ex - 120, ey, { steps: 5 });
  await article.mouse.up();
  const savedWidth = async () => (await stored(sw, 'pageWidgetPlaces'))?.[HOST]?.width;
  if (!(await waitFor(async () => (await savedWidth()) > 380))) errors.push(`widget: not resized from its edge (${await savedWidth()})`);
  // Going on with it in the chat: the panel (a tab here) opens it as a new conversation. Its
  // button is a button's size (the floating chat's own styles once stretched it over the card).
  const [, , chatW, chatH] = await widgetBox(article, 'chat').catch(() => [0, 0, 0, 0]);
  if (!chatW || chatW > 200 || chatH > 50) errors.push(`widget: "Open in the chat" is ${chatW}×${chatH}`);
  await widgetClick(article, 'Open in the chat').catch((e) => errors.push(`widget: ${e.message}`));
  const inChat = await waitFor(async () => {
    const shown = await page.locator('#root').innerText();
    return shown.includes('Translate to Spanish: PLATYPUS FACT.') && shown.includes('Hecho del ORNITORRINCO.');
  });
  if (!inChat) errors.push(`widget: not opened in the chat (${(await page.locator('#root').innerText()).slice(0, 200)})`);
  // The tool, then the model: two boxes from its JSON (at once, with the selection).
  await widgetClick(article, 'Summarize items').catch((e) => errors.push(`widget: ${e.message}`));
  if (!(await waitFor(async () => (await widgetText(article)).includes('JSON OK: two animals')))) errors.push(`widget json: ${await widgetText(article)}`);
  const card = await widgetText(article);
  if (!card.includes('Summary') || !card.includes('First') || !card.includes('Echidna')) errors.push(`widget json card: ${card}`);
  // Each box a section of its own, with a Copy that puts its Markdown in the clipboard.
  const sections = await widgetNodes(article).then(async (w) => { await w.cdp.detach(); return w.inside.filter((n) => n.nodeName === 'SECTION').length; });
  if (sections !== 2) errors.push(`widget json: ${sections} sections, not 2`);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://localhost:${PORT}` });
  await widgetClick(article, 'Copy First').catch((e) => errors.push(`widget: ${e.message}`));
  const copied = await waitFor(async () => (await article.evaluate(() => navigator.clipboard.readText()).catch(() => '')) === 'Echidna');
  if (!copied) errors.push(`widget: Copy did not copy the box (${await article.evaluate(() => navigator.clipboard.readText()).catch((e) => e.message)})`);
  await article.close();
};

// A heading of the card folded while the answer streams: the card, rebuilt as it comes and at its
// end, keeps it folded.
RUN['widget-fold'] = async ({ errors, ctx }) => {
  const article = await ctx.newPage();
  await article.goto(`http://localhost:${PORT}/article`);
  if (!(await waitFor(async () => (await widgetText(article)).includes('✦')))) errors.push('widget: no bubble on the article');
  await widgetHover(article, 'Agent').catch((e) => errors.push(`widget: ${e.message}`));
  await waitFor(async () => !(await widgetHidden(article, 'menu')));
  await widgetClick(article, 'Report').catch((e) => errors.push(`widget: ${e.message}`));
  const named = (name) => widgetNode(article, name).then(({ cdp }) => (cdp.detach(), true), () => false);
  if (!(await waitFor(() => named('Fold Alpha'), T.medium))) errors.push(`widget fold: no button (${await widgetText(article)})`);
  await widgetClick(article, 'Fold Alpha').catch((e) => errors.push(`widget: ${e.message}`));
  if (!(await waitFor(() => named('Unfold Alpha'), T.short))) errors.push('widget fold: the click did not fold it');
  // Out of the layout: no box to measure.
  const hasBox = async (tag, wanted) => {
    const { cdp, inside, text } = await widgetNodes(article);
    const node = inside.find((n) => n.nodeName === tag && text(n).includes(wanted));
    const box = await cdp.send('DOM.getBoxModel', { backendNodeId: node.backendNodeId }).then(() => true, () => false);
    await cdp.detach();
    return box;
  };
  if (await hasBox('P', 'ALPHA-BODY')) errors.push('widget fold: its text still shows');
  if (await hasBox('H3', 'Beta')) errors.push('widget fold: its subheading still shows');
  if (!(await waitFor(async () => (await widgetText(article)).includes('FOLD-END'), T.turn))) errors.push('widget fold: the answer did not end');
  if (!(await waitFor(() => named('copy'), T.long))) errors.push('widget fold: no final card');
  if (!(await named('Unfold Alpha'))) errors.push('widget fold: unfolded when the card was built again');
  if (await hasBox('P', 'ALPHA-BODY')) errors.push('widget fold: its text shows in the final card');
  if (!(await hasBox('P', 'GAMMA-BODY'))) errors.push('widget fold: the next section was hidden too');
  await article.close();
};

RUN['widget-agent'] = async ({ errors, ctx, action }) => {
  const article = await ctx.newPage();
  await article.goto(`http://localhost:${PORT}/article`);
  if (!(await waitFor(async () => (await widgetText(article)).includes('✦')))) errors.push('widget: no bubble on the article');
  await widgetHover(article, 'Agent').catch((e) => errors.push(`widget: ${e.message}`));
  if (!(await waitFor(async () => !(await widgetHidden(article, 'menu'))))) errors.push('widget: the actions did not unfold');
  await widgetNode(article, 'Far away').then(({ cdp }) => { cdp.detach(); errors.push("widget: shows an agent's action off its sites"); }, () => undefined);
  await widgetClick(article, 'Search items').catch((e) => errors.push(`widget: ${e.message}`));
  await article.keyboard.type('platypus');
  await widgetClick(article, 'Go').catch((e) => errors.push(`widget: ${e.message}`));
  if (!(await waitFor(async () => (await widgetText(article)).includes('Echidna')))) errors.push(`widget: the agent's action did not run (${await widgetText(article)})`);
  await article.close();
};

RUN['page-widget'] = async ({ page, errors, ctx, extId, sw, action }) => {
  // Registered by the background once the action is saved; a page loaded after that shows it.
  const registered = await waitFor(() => sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).some((c) => c.id === 'page-widget' && c.matches.includes('http://localhost/article'))));
  if (!registered) errors.push('widget: content script not registered');
  const article = await ctx.newPage();
  await article.goto(`http://localhost:${PORT}/article`);
  if (!(await waitFor(async () => (await widgetText(article)).includes('✦')))) errors.push('widget: no bubble on the article');
  // The page cannot reach into it.
  const reachable = await article.evaluate(() => [...document.documentElement.children].some((c) => c.shadowRoot));
  if (reachable) errors.push('widget: its shadow root is open to the page');
  // A page built of web components hides the custom elements it has not defined yet (the widget's
  // host is one, never defined): the bubble still shows and takes the pointer.
  const onTop = await article.evaluate(() => {
    document.head.append(Object.assign(document.createElement('style'), { textContent: ':not(:defined) { visibility: hidden !important; opacity: 0 !important; }' }));
    const host = document.querySelector('ba-widget');
    const r = host.getBoundingClientRect();
    return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === host;
  });
  if (!onTop) errors.push('widget: hidden by the page\'s rule for undefined custom elements');
  // The pointer on the bubble unfolds the actions, and takes the page's selection.
  await article.evaluate(() => {
    const p = document.querySelector('p');
    const range = document.createRange();
    range.setStart(p.firstChild, p.textContent.indexOf('PLATYPUS'));
    range.setEnd(p.firstChild, p.textContent.length);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await widgetHover(article, 'Agent').catch((e) => errors.push(`widget: ${e.message}`));
  if (!(await waitFor(async () => !(await widgetHidden(article, 'menu'))))) errors.push('widget: the actions did not unfold');
  // A button that takes a text runs at once with the selection, kept editable in its card.
  await widgetClick(article, 'Search items').catch((e) => errors.push(`widget: ${e.message}`));
  if (!(await waitFor(async () => (await widgetText(article)).includes('Platypus fact')))) errors.push(`widget: no card (${await widgetText(article)})`);
  const card = await widgetText(article);
  if (!card.includes('Items') || !card.includes('Echidna')) errors.push(`widget card: ${card}`);
  const value = await widgetInputValue(article, 'Search items').catch(() => '');
  if (value !== 'PLATYPUS FACT.') errors.push(`widget: the card's field lacks the selection (${JSON.stringify(value)})`);
  // What is typed in it stays in it: a page's one-letter shortcut (here "e", skipped in its own
  // fields as such shortcuts are) neither fires nor eats the letter.
  await article.evaluate(() => {
    window.shortcuts = 0;
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'e' || ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      e.preventDefault();
      window.shortcuts++;
    });
  });
  await widgetFocusInput(article, 'Search items').catch((e) => errors.push(`widget: ${e.message}`));
  await article.keyboard.press('ControlOrMeta+a');
  await article.keyboard.type('Dedo');
  const typed = await widgetInputValue(article, 'Search items').catch(() => '');
  const fired = await article.evaluate(() => window.shortcuts);
  if (typed !== 'Dedo' || fired) errors.push(`widget: typing reached the page's shortcuts (${JSON.stringify(typed)}, ${fired} fired)`);
  if (process.env.E2E_SHOTS) await article.screenshot({ path: `${process.env.E2E_SHOTS}/page-widget-card.png` });
  // A click the page makes up does nothing.
  const before = await widgetText(article);
  await article.evaluate(() => document.documentElement.lastElementChild.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })));
  if ((await widgetText(article)) !== before) errors.push('widget: reacted to a synthetic click');
  // A click elsewhere on the page leaves it; its head moves it, and Escape (in it) closes it.
  await article.mouse.click(5, 5);
  if (await widgetHidden(article, 'pop')) errors.push('widget: a click on the page closed the card');
  else {
    const [left, top] = await widgetBox(article, 'pop');
    const [hx, hy] = await widgetBox(article, 'pop-head');
    await article.mouse.move(hx + 20, hy + 8);
    await article.mouse.down();
    await article.mouse.move(hx - 40, hy - 22, { steps: 4 });
    await article.mouse.up();
    const [movedLeft, movedTop] = await widgetBox(article, 'pop');
    if (Math.round(left - movedLeft) !== 60 || Math.round(top - movedTop) !== 30) errors.push(`widget: the card did not move by its head (${left},${top} → ${movedLeft},${movedTop})`);
    await article.keyboard.press('Escape');
  }
  if (!(await waitFor(() => widgetHidden(article, 'pop')))) errors.push('widget: Escape did not close the card');
  // From the keyboard: Shift+Tab from the page reaches the bubble (the last thing on it), which
  // unfolds the actions; Tab goes to the first one, Enter presses it.
  await article.mouse.move(1, 1);
  await waitFor(() => widgetHidden(article, 'menu'));
  await article.evaluate(() => document.activeElement?.blur());
  await article.keyboard.press('Shift+Tab');
  if (!(await waitFor(async () => !(await widgetHidden(article, 'menu'))))) errors.push('widget: the keyboard focus did not unfold the actions');
  await article.keyboard.press('Tab');
  await article.keyboard.press('Enter');
  if (!(await waitFor(async () => !(await widgetHidden(article, 'pop'))))) errors.push('widget: Enter on an action did not open its card');
  await article.keyboard.press('Escape');
  await waitFor(() => widgetHidden(article, 'pop'));
  // Hidden on this site from its ✕.
  await widgetHover(article, 'Agent').catch(() => undefined);
  await waitFor(async () => !(await widgetHidden(article, 'menu')));
  await widgetClick(article, 'Hide on this site').catch((e) => errors.push(`widget: ${e.message}`));
  const hidden = await waitFor(async () => (await stored(sw, 'pageWidgetPlaces'))?.[HOST]?.hidden === true);
  if (!hidden) errors.push('widget: not hidden on the site');
  await sw.evaluate(() => chrome.storage.local.set({ pageWidgetPlaces: {} }));
  // The page moves to a URL the action does not match (an SPA): the widget goes, unless it is
  // shown on every site, where the bubble alone stays (it opens the chat).
  await article.evaluate(() => history.pushState({}, '', '/deals'));
  if (!(await waitFor(async () => !(await widgetText(article)).includes('✦')))) errors.push('widget: still shown after leaving the matching URL');
  await sw.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, pageWidget: { everywhere: true } } });
  });
  if (!(await waitFor(async () => (await widgetText(article)).includes('✦')))) errors.push('widget: no bubble without actions while shown on every site');
  if ((await widgetText(article)).includes('Search items')) errors.push('widget: an action shown off its URL');
  await article.close();
  // An open tab the action now reaches gets the widget without reloading.
  const deals = await ctx.newPage();
  await deals.goto(`http://localhost:${PORT}/deals`);
  // Saved as the extension saves it (widget/store): its reach kept apart, then the copy in storage.local.
  const pageActions = await stored(sw, 'pageActions');
  pageActions.user[0].where.push('http://localhost/deals');
  await setSecret(sw, 'widgetActions', { ...(await storedSecret(sw, 'widgetActions')), [pageActions.user[0].id]: actionPart(pageActions.user[0]) });
  await sw.evaluate((p) => chrome.storage.local.set({ pageActions: p }), pageActions);
  if (!(await waitFor(async () => (await widgetText(deals)).includes('✦')))) errors.push('widget: not put into an open tab');
  await deals.close();
  // Settings → Actions: listed, and Try runs it unsaved.
  const options = await ctx.newPage();
  await options.goto(`chrome-extension://${extId}/options.html#actions`);
  await options.getByRole('button', { name: /Search items/ }).click();
  // The editor is a guide: an action that exists opens folded, Try it one of its steps.
  await options.getByRole('button', { name: 'Change: Try it' }).click();
  await options.getByLabel('Input to try').fill('platypus');
  await options.getByRole('button', { name: 'Try', exact: true }).click();
  await options.getByRole('link', { name: 'Echidna' }).waitFor({ timeout: T.long }).catch(() => errors.push('actions: Try shows no lines'));
  if ((await options.getByRole('link', { name: 'Echidna' }).getAttribute('href').catch(() => '')) !== 'http://localhost/items/Echidna') errors.push('actions: Try link');
  // A new action starts with what it does; "Show beside selected text" is a checkbox on one line with its text.
  await options.getByRole('button', { name: 'Cancel' }).click();
  await options.getByRole('button', { name: '＋ New action' }).click();
  await options.getByRole('radio', { name: /^Answer about the selection/ }).click();
  await options.getByRole('button', { name: 'Next', exact: true }).click();
  const check = await options.getByRole('checkbox', { name: 'Show beside selected text' }).boundingBox().catch(() => null);
  const said = await options.getByText('Show beside selected text', { exact: true }).boundingBox().catch(() => null);
  const middle = (b) => b.y + b.height / 2;
  if (!check || !said || Math.abs(middle(check) - middle(said)) > 6 || said.x < check.x + check.width) errors.push(`actions: the beside checkbox is not on one line with its text (${JSON.stringify({ check, said })})`);
  // Saved through the guide: the prompt, then its name from the one suggested.
  await options.getByRole('button', { name: 'Next', exact: true }).click();
  await options.getByLabel('Prompt', { exact: true }).fill('Explain in plain words: {input}');
  await options.getByRole('button', { name: 'Open: Name and icon' }).click();
  await options.getByRole('button', { name: 'Explain in plain words', exact: true }).click();
  await options.getByRole('button', { name: 'Save', exact: true }).click();
  const made = await waitFor(async () => (await stored(options, 'pageActions'))?.user?.find((a) => a.name === 'Explain in plain words'));
  if (!made) errors.push('actions: a new action not saved through the guide');
  else {
    const savedNew = (await stored(options, 'pageActions')).user.find((a) => a.name === 'Explain in plain words');
    if (savedNew.prompt !== 'Explain in plain words: {input}' || savedNew.input !== 'selection' || !savedNew.besideSelection || savedNew.tool !== '') errors.push(`actions: saved through the guide as ${JSON.stringify(savedNew)}`);
  }
  await options.close();
};
