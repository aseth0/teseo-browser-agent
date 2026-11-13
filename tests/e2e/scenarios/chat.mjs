// Site mentions, compaction, images, the tools menu, memory, the chat's views, message actions, scrolling, stopping, Markdown.
import { HELLO, HOST, PORT, QUIET_MS, stored, T, waitFor } from '../lib.mjs';
import { mock } from '../mock/state.mjs';
import { recordClipboard, toolCount } from './helpers.mjs';
import { SCANNED_PDF, TEXT_PDF } from '../pdf-fixtures.mjs';
import { ACTIONS, AFTER, BEFORE, BETWEEN, CHAT_VIEW, CHECK, EXPECT, MESSAGES, MID_TURN, MODEL_OF, TEMPLATES } from './tables.mjs';

// User page templates present in storage for a scenario.
Object.assign(TEMPLATES, {
  'web-read': [{ id: 'af', name: 'article-facts', description: '', matches: ['*://localhost/*'], enabled: true, webRead: true,
    views: [{ name: 'main', paths: ['/article'], replacePage: false, body: 'Fact: {{ page | one: "h1" }}' }] }],
  'page-template': [{ id: 'pt', name: 'test-template', description: '', matches: ['*://localhost/*'], enabled: true, views: [{ name: 'main', paths: ['*'], replacePage: true,
    body: 'Product: {{ page | one: "h1" }}\n{%- assign links = page | select: "nav a" %}\n{%- for l in links %}\n- {{ l }} · {{ l | attr: "href" }}\n{%- endfor %}' }] }],
});
// UI steps to run after the conversation, before reading the UI.
Object.assign(AFTER, {
  // The turn stops at the step limit, says so, and Continue picks it up without a new message.
  'step-limit': async (page) => {
    const notice = page.locator('.step-limit');
    await notice.waitFor({ timeout: T.max });
    if (!(await notice.innerText()).includes('Stopped after 15 rounds of tool calls')) throw new Error(`notice: ${await notice.innerText()}`);
    await notice.getByRole('button', { name: 'Continue' }).click();
    await page.getByText('CONTINUED OK').waitFor({ timeout: T.max });
    if (await page.locator('.msg.user').count() !== 1) throw new Error('Continue added a user message');
  },
  // The chip opens what the template sends and how each variable did.
  'page-template': async (page) => {
    await page.getByRole('button', { name: /^Site template "test-template"/ }).click();
    // Opening it reads the page again: the details are there once read.
    await page.locator('.template-details').getByText('Sent with your next message').waitFor({ timeout: T.medium });
    // What it sends first; the diagnosis folded under its line (everything found), open on a click.
    const details = page.locator('.template-details');
    const shown = await details.innerText();
    if (shown.indexOf('Sent with your next message') > shown.indexOf('Diagnosis') || !/Diagnosis · \d+ lookups?, all found/.test(shown) || shown.includes('main:2 select')) throw new Error(`chip details: ${shown.slice(0, 300)}`);
    await details.getByText('Diagnosis').click();
    await details.getByText('main:2 select "nav a": 3 elements').waitFor({ timeout: T.short });
    // With the page not sent ("Page" off here; an agent not given the site too), the chip says so.
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^Attach the active page to each message: on/ }).click();
    const withheld = page.getByRole('button', { name: /^Not sent: "Page" is off\. Site template "test-template"/ });
    await withheld.waitFor({ timeout: T.short });
    if (!(await withheld.innerText()).includes('test-template')) throw new Error(`withheld chip: ${await withheld.innerText()}`);
    await page.getByRole('button', { name: /^Attach the active page to each message: off/ }).click();
  },
  // The model's template is stored as the model's.
  'template-save': async (page) => {
    const templates = await stored(page, 'templates');
    const saved = templates?.user.find((t) => t.name === 'shop-product');
    if (saved?.createdBy !== 'model' || saved.views[0]?.body !== 'Product: {{ page | one: "h1" }}' || saved.views[0].replacePage) throw new Error(`saved template: ${JSON.stringify(saved)}`);
  },
  // The saved skill is stored as the model's, and the card showed it whole without "always".
  'skill-save': async (page) => {
    const skills = await stored(page, 'skills');
    const saved = skills.user.find((s) => s.name === 'shop-buy');
    if (saved?.createdBy !== 'model' || !saved.body.includes('{{selector:#cart}}')) throw new Error(`saved skill: ${JSON.stringify(saved)}`);
  },
  // Layers: Sent under your message and under each answer whose tools ran, Received under each answer.
  'tech-view': async (page) => {
    await page.getByRole('button', { name: 'Show the chat as: Markdown' }).click();
    await page.getByRole('menuitemradio', { name: 'Layers' }).click();
    // A message's layers open from its chip, at the end of its last line.
    for (const chip of await page.locator('.messages .layer-chip').all()) await chip.click();
    const lines = await page.locator('.messages details.layer.sent > summary .prompt-section-title').allInnerTexts().then((all) => all.map((t) => t.trim()));
    const want = ['Sent · Call 1 · your message', 'Sent · Call 2 · after the tools ran', 'Sent · Call 3 · after the tools ran'];
    if (lines.join('|') !== want.join('|')) throw new Error(`call lines: ${lines.join('|')}`);
    const received = await page.locator('.messages details.layer.received').first().innerText();
    if (!received.includes('Received') || !received.includes('Tool call · ')) throw new Error(`received layer: ${received}`);
    const third = page.locator('.messages details.layer.sent').nth(2);
    // The system message and the resent ones, folded together; each opens.
    await third.locator('details.conv-before > summary').click();
    const firstMsg = third.locator('details.conv-before details.conv-msg').nth(1);
    await firstMsg.locator('> summary').click();
    await waitFor(async () => (await firstMsg.getAttribute('open')) !== null, T.short);
    if ((await firstMsg.getAttribute('open')) === null) throw new Error(`a resent message of the call does not open (${await firstMsg.locator('> summary').innerText()})`);
    // Your message piece by piece: what you typed, then the page block.
    const pieces = (await firstMsg.locator('.conv-piece-head > span:first-child').allInnerTexts()).join('|');
    if (pieces !== 'Your message|Page block') throw new Error(`message pieces: ${pieces}`);
    // The tool definitions, folded: what each group weighs.
    const toolsLine = third.locator('details.conv-tools');
    await toolsLine.locator('> summary').click();
    const groups = await toolsLine.locator('.conv-tool-groups').innerText();
    if (!groups.includes('Browser') || !/~[\d,]+ tokens/.test(groups)) throw new Error(`tool groups: ${groups}`);
    const tags = (await third.locator('.conv-tag').allInnerTexts()).join(',');
    if (tags !== 'New,New,resent,resent,resent,resent') throw new Error(`call 3 tags: ${tags}`);
    // Colored by origin like the prompt preview: the page block, your message and the click's reply (a page tool result).
    const counts = {};
    for (const origin of ['page', 'message', 'tool']) counts[origin] = await third.locator(`mark.origin-${origin}`).count();
    if (Object.values(counts).some((n) => !n)) throw new Error(`origin marks: ${JSON.stringify(counts)}`);
    // The legend lists the origins present.
    const legend = await third.locator('.origin-legend').innerText();
    if (!['Page block', 'Your message', 'Page tool results'].every((l) => legend.includes(l))) throw new Error(`legend: ${legend}`);
    if (mock.markedRequests) throw new Error(`${mock.markedRequests} requests carried origin marks`);
    if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/tech-view-open.png`, fullPage: true });
    await page.getByRole('button', { name: 'Show the chat as: Layers' }).click();
    await page.getByRole('menuitemradio', { name: 'Markdown' }).click();
  },
  // The end of a long reply can be scrolled into view, and the composer stays inside the window.
  'long-reply': async (page) => {
    await page.setViewportSize({ width: 420, height: 600 });
    const r = await page.evaluate(async () => {
      const list = document.querySelector('.messages');
      list.scrollTop = list.scrollHeight;
      await new Promise((ok) => setTimeout(ok, 100));
      const last = [...document.querySelectorAll('.msg.assistant p')].at(-1).getBoundingClientRect();
      const box = list.getBoundingClientRect();
      const composer = document.querySelector('.composer-actions').getBoundingClientRect();
      return { lastBottom: last.bottom, listBottom: box.bottom, composerBottom: composer.bottom, height: innerHeight, docHeight: document.documentElement.scrollHeight };
    });
    if (r.lastBottom > r.listBottom + 1) throw new Error(`the end of the reply cannot be scrolled into view: ${JSON.stringify(r)}`);
    if (r.composerBottom > r.height + 1) throw new Error(`the composer is outside the window: ${JSON.stringify(r)}`);
  },
  'context-usage': (page) => page.getByTitle(/^Context:/).click(),
  // Page bar icons: the conversation JSON as sent (with the hidden page block), and raw replies.
  'chat-view': async (page) => {
    await page.getByRole('button', { name: 'Show the conversation as sent to the model (JSON)' }).click();
    const json = await page.locator('.chat-json pre').innerText();
    for (const want of ['"role": "system"', '"content": "hello 1\\n<untrusted_page_content', '"role": "assistant"']) {
      if (!json.includes(want)) throw new Error(`conversation JSON lacks ${want}`);
    }
    const summary = page.locator('.chat-json > summary > span').first();
    await summary.click();
    if ((await page.locator('.chat-json').getAttribute('open')) !== null) throw new Error('the conversation JSON does not collapse');
    await summary.click();
    // One selector for how replies are shown: Markdown (default) or plain text.
    await page.getByRole('button', { name: 'Show the chat as: Markdown' }).click();
    await page.getByRole('menuitemradio', { name: 'Plain text' }).click();
    if (!(await page.locator('.msg.assistant.raw').count())) throw new Error('the selector did not switch to plain text');
    await page.getByRole('button', { name: 'Show the chat as: Plain text' }).click();
    await page.getByRole('menuitemradio', { name: 'Markdown' }).click();
    if (!(await page.getByRole('button', { name: /^Attach the active page to each message: on/ }).getAttribute('aria-pressed'))) throw new Error('page toggle not pressed');
  },
});
// A site on a host the shop is not on, read through mentions.
const DEALS_VIEW = { name: 'main', paths: ['*'], replacePage: false, body: 'Deals: {{ page | one: "h1" }}' };
TEMPLATES['mention-open'] = [{ id: 'mo', name: 'other', description: '', matches: ['*://127.0.0.1/*'], enabled: true, views: [DEALS_VIEW] }];
TEMPLATES['mention-background'] = [{ id: 'mb', name: 'deals', description: '', matches: ['http://localhost/*'], enabled: true, views: [{ ...DEALS_VIEW, name: 'list', paths: ['/deals*'] }] }];
TEMPLATES['mention-failed'] = TEMPLATES['mention-background'];
EXPECT['mention-open'] = ['MENTION OK', 'other/main'];
EXPECT['mention-background'] = ['MENTION OK', 'deals/list'];
EXPECT['mention-failed'] = 'MENTION OK';
// The message a scenario sends (default: "hello N"); null: BEFORE leaves it typed in the box.
Object.assign(MESSAGES, { 'image-upload': 'what is this?', 'mention-open': 'Any deals? ::other/main', 'mention-background': null, 'mention-failed': 'And ::deals/nope?' });
let dealsTab;
BEFORE['mention-open'] = async (page) => {
  dealsTab = await page.context().newPage();
  await dealsTab.goto(`http://127.0.0.1:${PORT}/deals`);
  // The shop stays the panel's page: the deals are only in another open tab.
  await page.context().pages().find((p) => p.url().includes('/shop.html'))?.bringToFront();
  await page.bringToFront();
};
// The meter takes the window the error named; set by hand for the model, it says so and keeps it.
AFTER['context-learned'] = async (page) => {
  await page.getByTitle(/^Context:/).click();
  const details = page.locator('.context-details');
  await details.getByText('Context window: 16,000 tokens, learned from the server').waitFor({ timeout: T.short });
  await details.getByRole('button', { name: 'Change' }).click();
  await details.getByLabel(/^Context window of this model/).fill('32000');
  await details.getByRole('button', { name: 'Save' }).click();
  await details.getByText('Context window: 32,000 tokens, set by you for this model').waitFor({ timeout: T.short });
  // Stored a moment after it shows: a save reads the stored settings first, in its turn (storage/settings).
  const windows = async () => (await stored(page, 'settings')).contextWindows;
  if (!(await waitFor(async () => (await windows())?.['env|context-learned'] === 32000, T.short))) throw new Error(`stored: ${JSON.stringify(await windows())}`);
};
// Compacted from the meter: a line says it is summarizing; then a divider where the turns it kept
// start, with the summary, and a mark at the bottom whose link opens it; the next message goes with
// it, and its layer says so.
// Compacted from the meter without a summary: the next message goes with the first turn trimmed.
AFTER['compaction-trim'] = async (page) => {
  await page.getByTitle(/^Context:/).click();
  await page.getByRole('button', { name: 'Compact now' }).click();
  await page.locator('.compaction-mark').waitFor({ timeout: T.long });
  await page.keyboard.press('Escape');
  await page.getByPlaceholder(/Ask something/).fill('hello 3');
  await page.getByPlaceholder(/Ask something/).press('Enter');
  await page.getByText(/TRIMMED (OK|SEES)/).waitFor({ timeout: T.long });
  const sees = await page.getByText(/TRIMMED SEES/).innerText().catch(() => '');
  if (sees) throw new Error(sees.slice(0, 300));
};
// The model called chat.compact with instructions in the third turn: compacted once it ended, the
// summary written with them, and the mark says so; the next message goes with the summary.
AFTER['compaction-tool'] = async (page) => {
  const mark = page.locator('.compaction-mark');
  await mark.waitFor({ timeout: T.long });
  if ((await mark.getAttribute('title')) !== 'Instructions: "keep FOCUS-7"') throw new Error(`mark title: ${await mark.getAttribute('title')}`);
  if (await page.getByText(/SUMMARY SEES/).count()) throw new Error('the summary request lacked the instructions');
  await page.getByPlaceholder(/Ask something/).fill('hello 4');
  await page.getByPlaceholder(/Ask something/).press('Enter');
  await page.getByText(/TOOL COMPACTED (OK|SEES)/).waitFor({ timeout: T.long });
  if (await page.locator('.compaction-mark').count() !== 1) throw new Error('compacted more than once');
};
AFTER.compaction = async (page) => {
  await page.getByTitle(/^Context:/).click();
  await page.getByRole('button', { name: 'Compact now' }).click();
  await page.locator('.compaction-status').getByText('Compacting 2 earlier turns: summarizing with').waitFor({ timeout: T.medium });
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/compaction-running.png` });
  await page.locator('.compaction-divider').waitFor({ timeout: T.long });
  if (await page.locator('.compaction-status').count()) throw new Error('the line stayed after compacting');
  await page.keyboard.press('Escape');
  const mark = page.locator('.compaction-mark');
  if (!(await mark.innerText()).includes('Compacted here · 2 turns')) throw new Error(`mark: ${await mark.innerText()}`);
  await mark.getByRole('button', { name: '↑ Show where' }).click();
  if (!(await page.locator('.compaction-divider').evaluate((d) => d.open))) throw new Error('the link did not open the divider');
  if (!(await page.locator('.compaction-body').innerText()).includes('SUMMARY-OK')) throw new Error('the divider lacks the summary');
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/compaction-done.png` });
  const convIndex = await stored(page, 'convIndex');
  const saved = await stored(page, `conv:${convIndex[0].id}`);
  if (!saved.history.some((m) => m.compaction?.summary === 'SUMMARY-OK')) throw new Error('the compaction was not saved');
  await page.getByPlaceholder(/Ask something/).fill('hello 4');
  await page.getByPlaceholder(/Ask something/).press('Enter');
  await page.getByText(/COMPACTED (OK|SEES)/).waitFor({ timeout: T.long });
  await page.getByRole('button', { name: 'Show the chat as: Markdown' }).click();
  await page.getByRole('menuitemradio', { name: 'Layers' }).click();
  for (const chip of await page.locator('.messages .layer-chip').all()) await chip.click();
  const last = page.locator('.messages details.layer.sent').last();
  const title = await last.locator('> summary .prompt-section-title').innerText();
  const note = await last.locator('.conv-compacted').innerText().catch(() => '');
  if (!title.endsWith('· compacted') || !note.includes('Earlier turns went compacted: 2 turns')) throw new Error(`layer: ${title} / ${note}`);
  // Each message's pieces as it went: the summary first, in the message of the first turn kept; all
  // new, since the call before went uncompacted. The site skill's block went with a turn the summary
  // replaced: your message carries it whole again, not its reminder.
  const pieces = (await last.locator('details.conv-msg.new .conv-piece-head > span:first-child').allInnerTexts()).join('|');
  if (!pieces.startsWith('Summary of the earlier turns|Your message|Site skill reminder|Page block|Your message|Site skill "test-site"|Page block')) throw new Error(`compacted pieces: ${pieces}`);
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/compaction-layers.png` });
  await page.getByRole('button', { name: 'Show the chat as: Layers' }).click();
  await page.getByRole('menuitemradio', { name: 'Markdown' }).click();
};
// A small picture to attach (a 4×4 red PNG).
const RED_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGP4z8AARwzEcQCukw/x0F8jngAAAABJRU5ErkJggg==', 'base64');
// Attached from the paperclip: a thumbnail above the box, with its remove button, before it goes.
BEFORE['image-upload'] = async (page) => {
  await page.getByLabel('Files to attach').setInputFiles({ name: 'red.png', mimeType: 'image/png', buffer: RED_PNG });
  await page.locator('.attachment img').waitFor({ timeout: T.short });
  await page.getByRole('button', { name: 'Remove image 1' }).waitFor();
  // A text file: its chip, by its name; taken out again, so only the picture goes.
  await page.getByLabel('Files to attach').setInputFiles({ name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Notes') });
  await page.getByRole('button', { name: 'Remove file notes.md' }).click({ timeout: T.short });
  // Attach → Web Screenshot → Take a section screenshot: dragged over the shop's page, a second one.
  await page.getByRole('button', { name: 'Attach', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Web Screenshot' }).click();
  // The panel is a tab here: the page is shown first, as it is beside the real side panel.
  const shop = page.context().pages().find((p) => p.url().includes('/shop.html'));
  await shop.bringToFront();
  await page.getByRole('menuitem', { name: 'Take a section screenshot' }).click();
  // The veil's hint is in its closed shadow root, out of the locators' reach: its host stands for it.
  await shop.locator('ba-veil').waitFor({ timeout: T.short });
  await shop.mouse.move(20, 20);
  await shop.mouse.down();
  await shop.mouse.move(220, 140, { steps: 5 });
  await shop.mouse.up();
  if (await shop.locator('ba-veil').count()) throw new Error('the veil stayed on the page');
  // Capturing a tab needs every site or activeTab (the toolbar icon), which the e2e cannot grant: there,
  // the panel says so; with it, the section is a second image.
  const second = page.getByRole('button', { name: 'Remove image 2' });
  const refused = page.getByText(/Could not capture the page \(Either the '<all_urls>' or 'activeTab' permission is required/);
  await second.or(refused).waitFor({ timeout: T.medium });
  if (await second.count()) await second.click(); // only the red one goes
};
// Shown in your message; the saved conversation keeps it without its data.
AFTER['image-upload'] = async (page) => {
  await page.locator('.msg-image img').waitFor({ timeout: T.short });
  if (await page.locator('.attachment').count()) throw new Error('the attachment stayed after sending');
  const convIndex = await stored(page, 'convIndex');
  const saved = await stored(page, `conv:${convIndex[0].id}`);
  const image = saved.history[0].parts.find((p) => p.type === 'image');
  if (!image || image.data !== '') throw new Error(`saved image: ${JSON.stringify(image).slice(0, 100)}`);
};
// A PDF with text and one without (a scan), from the paperclip: the first goes as its pages' text,
// the second as an image of its page, each with its chip; the saved conversation keeps their names only.
EXPECT['pdf-attach'] = 'PDF OK';
MESSAGES['pdf-attach'] = 'read these';
BEFORE['pdf-attach'] = async (page) => {
  await page.getByLabel('Files to attach').setInputFiles([
    { name: 'report.pdf', mimeType: 'application/pdf', buffer: TEXT_PDF },
    { name: 'scan.pdf', mimeType: 'application/pdf', buffer: SCANNED_PDF },
  ]);
  await page.getByRole('button', { name: 'Remove file report.pdf' }).waitFor({ timeout: T.medium });
  await page.getByRole('button', { name: 'Remove file scan.pdf' }).waitFor({ timeout: T.short });
  await page.getByRole('button', { name: 'Remove image 1' }).waitFor({ timeout: T.short });
  const titles = await page.locator('.attachments [title^="PDF"]').evaluateAll((els) => els.map((e) => e.getAttribute('title')));
  if (titles.join('|') !== 'PDF, 2 pages, 63 characters, sent as text|PDF without text: 1 page sent as images') throw new Error(`PDF chips: ${titles.join('|')}`);
};
AFTER['pdf-attach'] = async (page) => {
  const convIndex = await stored(page, 'convIndex');
  const saved = await stored(page, `conv:${convIndex[0].id}`);
  const parts = saved.history[0].parts;
  const pdf = parts.find((p) => p.source === 'pdf:report.pdf');
  if (!pdf?.text.includes('PDF not kept in the saved conversation') || pdf.text.includes('example.com')) throw new Error(`saved PDF: ${JSON.stringify(pdf).slice(0, 200)}`);
  if (parts.some((p) => p.type === 'image' && p.data)) throw new Error('the saved conversation kept a page image');
};
// The turn lasts while the user signs in: until its answer.
AFTER['web-sign-in'] = (page) => page.getByText(/SIGN IN (OK|READ)/).waitFor({ timeout: 30000 });
// The tool switched off in Settings is not offered: one less than all.
AFTER['tools-offered'] = async (page) => {
  const [shown, total] = await toolCount(page);
  if (shown !== total - 1) throw new Error(`tools offered: ${shown}/${total}`);
};
// The memory panel (next to the history): what goes with the next message first, then the rest; pin and delete
// (asked first, inside the panel) change what is stored.
const storedMemory = async (page) => (await stored(page, 'memory'))?.user ?? [];
const openMemory = async (page) => {
  await page.getByRole('button', { name: 'Memory', exact: true }).click();
  await page.locator('.memory-panel .history-item').first().waitFor({ timeout: T.short });
  return page.locator('.memory-panel');
};
// After the first turn, cut as it looped: the chat says so (the notice goes with the next message).
BETWEEN['repetition-loop'] = (page) => page.getByText('Reply cut: it kept repeating "^*".').waitFor({ timeout: T.short });
// Between the turns: the pinned item edited, one deleted, one added.
BETWEEN['memory-stable'] = (page) => page.evaluate(async () => {
  const { memory } = await chrome.storage.local.get('memory');
  const user = memory.user.filter((m) => m.id !== 'm-gone').map((m) => (m.id === 'm-pin' ? { ...m, text: 'PIN-B', updatedAt: 9 } : m));
  user.push({ ...user[0], id: 'm-new', text: 'New rule\ndetail', pinned: false, updatedAt: 10 });
  await chrome.storage.local.set({ memory: { ...memory, user } });
});
AFTER['memory-prompt'] = async (page) => {
  // The pill of the site's memory says what went; a click lists it, and that opens the panel.
  const chip = page.locator('.msg-auto-pill', { hasText: '1' }).first();
  const title = await chip.getAttribute('title');
  if (!title.includes(`Memory for ${HOST}`) || !title.includes('• SITE-RULE-9')) throw new Error(`pill title: ${title}`);
  await chip.click();
  await page.locator('.msg-auto-list', { hasText: 'SITE-RULE-9' }).waitFor({ timeout: T.short });
  await page.getByRole('button', { name: 'Open the memory' }).click();
  await page.locator('.memory-panel').waitFor({ timeout: T.short });
  await page.locator('.memory-panel').getByRole('button', { name: 'Close' }).click();
  const panel = await openMemory(page);
  const titles = (await panel.locator('.history-title').allInnerTexts()).map((t) => t.trim()).join('|');
  if (titles !== 'PIN-RULE-7|SITE-RULE-9|Site title rule|Index rule title|OFF-RULE|NOBODY-RULE' || (await panel.locator('.history-title .chat-icon').count()) !== 4) throw new Error(`panel order: ${titles}`);
  if ((await panel.locator('.history-item').nth(1).getAttribute('title')) !== 'SITE-RULE-9') throw new Error('no whole text on hover');
  await panel.getByRole('button', { name: 'Pin Index rule title' }).click();
  await panel.getByRole('button', { name: 'Unpin Index rule title' }).waitFor({ timeout: T.short });
  if (!(await storedMemory(page)).find((m) => m.id === 'm-idx')?.pinned) throw new Error('pinning was not stored');
  await panel.getByRole('button', { name: 'Delete NOBODY-RULE' }).click();
  await panel.getByRole('button', { name: 'Confirm: delete NOBODY-RULE' }).click();
  await panel.getByText('NOBODY-RULE').waitFor({ state: 'detached', timeout: T.short });
  if ((await storedMemory(page)).some((m) => m.id === 'm-nobody')) throw new Error('deleting was not stored');
  await panel.getByRole('button', { name: 'Close' }).click();
};
// The model's item is stored as the model's, with the site as a host, and listed in the panel.
AFTER['memory-save'] = async (page) => {
  const [saved] = await storedMemory(page);
  if (saved?.source !== 'model' || !saved.pinned || saved.domains.join() !== 'localhost' || saved.title !== 'Prices' || saved.text !== 'Prices in euros.\nAlways with VAT.') throw new Error(`saved item: ${JSON.stringify(saved)}`);
  const panel = await openMemory(page);
  if ((await panel.locator('.history-title').first().innerText()).trim() !== 'Prices' || !(await panel.locator('.history-title').first().locator('.chat-icon').count())) throw new Error('not listed in the panel');
};
AFTER['memory-delete'] = async (page) => {
  if ((await storedMemory(page)).length) throw new Error('the item is still stored');
};
// Settings → Memory: an item written in its editor and one pasted as JSON, before the message.
BEFORE['memory-settings'] = async (page) => {
  const options = await page.context().newPage();
  await options.goto(page.url().replace('sidepanel.html', 'options.html#memory'));
  await options.getByRole('button', { name: '＋ New item' }).click();
  await options.getByLabel(/^Text/).fill('WRITTEN-RULE-3');
  await options.getByLabel(/^Pinned/).check();
  await options.getByRole('button', { name: 'Save', exact: true }).click();
  await options.getByText('WRITTEN-RULE-3', { exact: true }).waitFor({ timeout: T.short });
  await options.getByRole('button', { name: 'Import ▾' }).click();
  await options.getByRole('menuitem', { name: 'Paste JSON…' }).click();
  await options.getByLabel(/^Memory JSON/).fill(JSON.stringify({ memory: [{ id: 'm-imp', text: 'IMPORTED-RULE-4', pinned: true, agents: ['Default'] }] }));
  await options.locator('.paste-json').getByRole('button', { name: 'Import', exact: true }).click();
  await options.locator('.import-preview').getByRole('button', { name: /^Import \d/ }).click();
  await options.getByText('IMPORTED-RULE-4', { exact: true }).waitFor({ timeout: T.short });
  // Imported items start off: switched on here.
  const imported = options.getByLabel('IMPORTED-RULE-4: on');
  if (await imported.isChecked()) throw new Error('the imported item came in switched on');
  await imported.click(); // saved, then shown checked once the store says so
  await waitFor(() => imported.isChecked(), T.short);
  if (!(await imported.isChecked())) throw new Error('the imported item could not be switched on');
  const listed = await options.locator('.memory-settings').innerText();
  if (!listed.includes('📌 Always') || !listed.includes('Every site · for Browser')) throw new Error(`imported item scope: ${listed.slice(0, 300)}`);
  await options.close();
  await page.bringToFront();
};
AFTER['mention-open'] = async () => dealsTab?.close();
// Typed with the suggestions: "::" lists the sites, Enter completes (and does not send), then the views.
BEFORE['mention-background'] = async (page) => {
  const box = page.getByPlaceholder(/Ask something/);
  await box.click();
  await page.keyboard.type('Any deals? ::de');
  const list = page.getByRole('listbox', { name: 'Site mentions' });
  await list.getByRole('option', { name: /^deals/ }).waitFor({ timeout: T.short });
  // Screen readers hear it as a combobox: open, and on the option ↑ ↓ point at.
  const active = await box.getAttribute('aria-activedescendant');
  if ((await box.getAttribute('aria-expanded')) !== 'true' || !active || (await list.getByRole('option', { selected: true }).getAttribute('id')) !== active) {
    throw new Error(`combobox: expanded ${await box.getAttribute('aria-expanded')}, active ${active}`);
  }
  await page.keyboard.press('Enter');
  if ((await box.inputValue()) !== 'Any deals? ::deals/') throw new Error(`completed to: ${await box.inputValue()}`);
  await list.getByRole('option', { name: /^list/ }).waitFor({ timeout: T.short });
  await page.keyboard.press('Enter');
  if ((await box.inputValue()) !== 'Any deals? ::deals/list ') throw new Error(`completed to: ${await box.inputValue()}`);
  if (await page.locator('.msg.user').count()) throw new Error('Enter sent the message while completing');
  await page.locator('.mention-chips').getByText('deals/list').waitFor({ timeout: T.short });
};
AFTER['mention-background'] = async (page) => {
  await page.getByText(/^MENTION /).waitFor({ timeout: 20000 });
  const open = page.context().pages().filter((p) => p.url().startsWith('http://localhost/deals')).length;
  if (open) throw new Error('the background tab was not closed');
};

// Settings → Appearance: scenarios that reuse a model with other display options.
Object.assign(MODEL_OF, { 'no-provider': 'basic', agent: 'basic', 'sub-agent': 'basic', 'view-compact-tools': 'tool-find', 'view-hidden-reasoning': 'reasoning-field', 'view-grouped-steps': 'tool-find', 'view-turn-diagrams': 'tool-find' });
// The other scenarios read tool calls and replies as they come (steps inline).
Object.assign(CHAT_VIEW, { 'tool-groups': { steps: 'inline', hiddenToolGroups: ['browser'], hiddenTools: ['skills.load'] }, 'view-compact-tools': { steps: 'inline', toolCalls: 'compact' }, 'view-hidden-reasoning': { steps: 'inline', reasoning: 'hidden' }, 'view-grouped-steps': {}, 'view-turn-diagrams': {} });
EXPECT['view-compact-tools'] = ['browser__find', 'FOUND'];
EXPECT['view-hidden-reasoning'] = HELLO;
// Tool groups: the page's WebMCP tools are a group of their own, remembered once seen; hidden
// groups and tools are left out of the tools menu (their tools are still offered), and the eye in
// Settings → Tools hides or shows them.
AFTER['tool-groups'] = async (page) => {
  await page.getByTitle(/^Tools offered to the model · \d+ hidden from this menu/).click();
  const list = page.locator('.tools-list');
  // Groups come folded: their tools show once a group is opened.
  if (await list.locator('.tool-row').count()) throw new Error('the tool groups are not folded');
  await list.getByRole('button', { name: /Skills$/ }).click();
  const menu = await list.innerText();
  if (menu.includes('Browser') || menu.includes('skills.load') || !menu.includes('skills.save') || !menu.includes(`WebMCP · ${HOST}`) || !menu.includes('on demand')) {
    throw new Error(`tools menu: ${menu.slice(0, 300)}`);
  }
  // A group's effect filter: only its write tools, and its checkbox acts on those alone.
  const skills = list.locator('.tools-group', { has: page.getByRole('button', { name: /Skills$/ }) });
  await skills.getByRole('button', { name: 'write', exact: true }).click();
  const rows = await skills.locator('.tool-row .badge').allInnerTexts();
  if (!rows.length || rows.some((e) => e !== 'write')) throw new Error(`filtered rows: ${rows}`);
  await skills.getByLabel('Offer the write tools of Skills').uncheck();
  // Stored a moment after it shows (as above).
  const disabled = async () => (await stored(page, 'settings')).disabledTools ?? [];
  await waitFor(async () => (await disabled()).includes('skills.save'), T.short);
  const off = await disabled();
  if (!off.includes('skills.save') || off.includes('skills.read_reference')) throw new Error(`disabled: ${off}`);
  const chatView = async () => (await stored(page, 'settings')).chatView;
  if (!(await chatView()).seenToolGroups?.includes(`webmcp:${HOST}`)) throw new Error(`seen groups: ${JSON.stringify(await chatView())}`);
  const options = await page.context().newPage();
  await options.goto(page.url().replace('sidepanel.html', 'options.html#tools'));
  // The group seen on the page is listed even here, where its tools are not.
  await options.locator('.tool-groups').getByText(`WebMCP · ${HOST}`).waitFor({ timeout: T.short });
  // The chips show only the tools of an effect, in every group.
  const toolbar = options.locator('.tools-toolbar');
  await toolbar.getByRole('button', { name: /^Write ·/ }).click();
  const effects = await options.locator('.tool-line .badge.read, .tool-line .badge.write, .tool-line .badge.interact').allInnerTexts();
  if (!effects.length || effects.some((e) => e !== 'write')) throw new Error(`Settings filter: ${effects}`);
  await toolbar.getByRole('button', { name: /^Read ·/ }).click(); // browser.find is a read tool
  await options.getByRole('button', { name: /^browser__find: shown on the chat menu/ }).click();
  await options.getByRole('button', { name: /^browser__find: hidden from the chat menu/ }).waitFor({ timeout: T.short });
  await options.close();
  if (!(await waitFor(async () => (await chatView()).hiddenTools?.includes('browser.find'), T.short))) throw new Error(`hidden tools: ${JSON.stringify(await chatView())}`);
};
// Grouped (the default): the tool call goes in one collapsed block, the answer stays in view.
EXPECT['view-grouped-steps'] = ['1 tool', 'FOUND'];
AFTER['view-grouped-steps'] = async (page) => {
  const steps = page.locator('details.steps');
  if ((await steps.count()) !== 1 || (await steps.getAttribute('open')) !== null) throw new Error('the steps are not one collapsed block');
  if (!(await steps.locator('details.tool').count())) throw new Error('the tool call is not inside the steps');
  if (await page.locator('.messages > .msg.assistant', { hasText: 'FOUND' }).count() !== 1) throw new Error('the answer is not outside the steps');
  // The call's switches: its result alone, then the arguments too.
  await steps.locator('summary').first().click();
  const call = steps.locator('details.tool').first();
  await call.locator('.tool-switch[data-part="result"]').click();
  await call.locator('details.tool-result[open] pre').first().waitFor({ timeout: T.short });
  if (await call.locator('pre.tool-args').count()) throw new Error('the result switch shows the arguments too');
  await call.locator('.tool-switch[data-part="args"]').click();
  await call.locator('pre.tool-args').waitFor({ timeout: T.short });
  if ((await call.locator('.tool-switch[data-part="result"]').getAttribute('aria-pressed')) !== 'true') throw new Error('the result switch is not lit');
};
// The Diagrams view (Show the chat as): the turn's steps drawn above the answer, the steps folded
// under the drawing.
EXPECT['view-turn-diagrams'] = ['1 tool', 'FOUND'];
AFTER['view-turn-diagrams'] = async (page) => {
  const showAs = async (from, to) => {
    await page.getByRole('button', { name: `Show the chat as: ${from}` }).click();
    await page.getByRole('menuitemradio', { name: to }).click();
    if (!(await waitFor(async () => (await page.locator('details.turn-diagram').count()) === (to === 'Diagrams' ? 1 : 0), T.short))) throw new Error(`the chat is not shown as ${to}`);
  };
  if (await page.locator('details.turn-diagram').count()) throw new Error('a diagram is drawn in the Markdown view');
  await showAs('Markdown', 'Diagrams');
  if ((await stored(page, 'settings')).chatRender !== 'diagrams') throw new Error('the Diagrams view is not kept');
  const diagram = page.locator('details.turn-diagram');
  if ((await diagram.count()) !== 1 || (await diagram.getAttribute('open')) === null) throw new Error('the turn is not one open diagram');
  const svg = diagram.locator('.turn-diagram-svg[role="img"] svg');
  if (!(await svg.count()) || !(await svg.textContent())?.includes('browser')) throw new Error('the diagram does not draw the tool call');
  if ((await diagram.locator('details.turn-diagram-steps').getAttribute('open')) !== null) throw new Error('the steps are not folded under the diagram');
  if (!(await diagram.locator('details.turn-diagram-steps details.tool').count())) throw new Error('the tool call is not in the folded steps');
  if (await page.locator('.messages > .msg.assistant', { hasText: 'FOUND' }).count() !== 1) throw new Error('the answer is not outside the diagram');
  // The other kinds, each loaded on picking it; the last one picked is remembered for the next turns.
  const picker = diagram.getByRole('group', { name: 'Draw this turn as' });
  const shots = process.env.E2E_SHOTS;
  for (const [kind, button] of [['flowchart', 'Flow'], ['mindmap', 'Mind map'], ['gantt', 'Timeline'], ['pie', 'Tokens']]) {
    await picker.getByRole('button', { name: button, exact: true }).click();
    if ((await picker.getByRole('button', { name: button, exact: true }).getAttribute('aria-pressed')) !== 'true') throw new Error(`${button} is not shown pressed`);
    await diagram.locator(`.turn-diagram-svg svg.pele-${kind}, .turn-diagram-none`).first().waitFor({ timeout: T.short });
    if (await diagram.locator('.turn-diagram-error').count()) throw new Error(`${kind}: ${await diagram.locator('.turn-diagram-error').innerText()}`);
    if (shots) await page.screenshot({ path: `${shots}/view-turn-diagrams-${kind}.png`, fullPage: true });
  }
  if (!(await diagram.locator('.turn-diagram-svg svg.pele-pie').count())) throw new Error('the pie is not drawn');
  const remembered = (await stored(page, 'settings')).chatView?.turnDiagram;
  if (remembered !== 'pie') throw new Error(`the kind picked is not remembered: ${remembered}`);
  // Back to Markdown: no diagrams, the answer still there.
  await showAs('Diagrams', 'Markdown');
  if (await page.locator('.messages > .msg.assistant', { hasText: 'FOUND' }).count() !== 1) throw new Error('the answer is gone without the diagrams');
};
AFTER['view-compact-tools'] = async (page) => {
  const compact = page.locator('details.tool-compact');
  if (!(await compact.count()) || (await page.locator('details.tool:not(.tool-compact)').count())) throw new Error('tool calls are not compact');
  // Still opens to the result.
  await compact.first().locator('summary').click();
  if (!(await compact.first().locator('.tool-result pre').innerText()).includes('Buy now')) throw new Error('the compact call does not show its result');
};
AFTER['view-hidden-reasoning'] = async (page) => {
  if (await page.locator('.reasoning').count()) throw new Error('the reasoning is shown');
};
// Under each message: its actions and stats; ↑ ↓ bring your messages back to the box (marking
// them), and regenerating sends one again with the page read afresh, dropping what came after.
EXPECT['message-actions'] = ['REPLY 3'];
AFTER['message-actions'] = async (page) => {
  if ((await page.locator('.msg-actions').count()) !== 4) throw new Error(`actions rows: ${await page.locator('.msg-actions').count()}`);
  if (!/↑ ~?[\d.k]+ · ↓ ~?\d+ · [\d.]+ s/.test(await page.locator('.msg-actions .msg-stats').first().innerText())) throw new Error('no answer stats');
  if (await page.locator('.msg-actions.user .msg-stats').count()) throw new Error('estimated tokens under your message');
  const box = page.getByPlaceholder(/Ask something/);
  await box.fill('draft');
  const recalled = () => page.locator('.msg.user.recalled').allInnerTexts();
  for (const [key, value, marked] of [['ArrowUp', 'hello 2', 'hello 2'], ['ArrowUp', 'hello 1', 'hello 1'], ['ArrowDown', 'hello 2', 'hello 2'], ['ArrowDown', 'draft', undefined]]) {
    await box.press(key);
    const now = [await box.inputValue(), (await recalled())[0]];
    if (now[0] !== value || now[1] !== marked) throw new Error(`after ${key}: ${JSON.stringify(now)}`);
  }
  await box.fill('');
  await page.locator('.msg-actions.user').first().getByRole('button', { name: /^Regenerate from here/ }).click();
  await page.getByText('REPLY 3').waitFor({ timeout: T.max });
  if ((await page.locator('.msg.user').count()) !== 1 || (await page.getByText('REPLY 2').count())) throw new Error('what came after was not dropped');
  const copied = await recordClipboard(page);
  await page.getByRole('button', { name: 'Copy the answer (Markdown)' }).click();
  const [answer] = await copied();
  if (answer?.plain !== 'REPLY 3') throw new Error(`copied answer: ${JSON.stringify(answer)}`);
};

// Auto-scroll "only when already at the end": scrolled up while the answer streams, the chat stays
// there, also during the first answer to your message.
CHAT_VIEW['scroll-reading'] = { steps: 'inline', autoScroll: 'at-bottom' };
EXPECT['scroll-reading'] = 'END-OF-STREAM';
AFTER['scroll-reading'] = async (page) => {
  await page.getByText('FIRST-PART-SHOWN').waitFor({ timeout: T.medium });
  const list = page.locator('.messages');
  await list.evaluate((el) => (el.scrollTop = 0));
  await page.getByText('END-OF-STREAM').waitFor({ timeout: T.max });
  const top = await list.evaluate((el) => el.scrollTop);
  if (top > 0) throw new Error(`scrolled back down while reading above: scrollTop ${top}`);
};

// A tool unfolded while the next thought streams: its card, once asked, can be scrolled into view
// whole, and a click on Allow reaches it (nothing drawn over it).
CHAT_VIEW['expand-mid-turn'] = {}; // steps grouped, as by default
EXPECT['expand-mid-turn'] = 'EXPAND OK';
MID_TURN['expand-mid-turn'] = true;
BEFORE['expand-mid-turn'] = (page) => page.setViewportSize({ width: 420, height: 560 });
AFTER['expand-mid-turn'] = async (page) => {
  await page.locator('details.steps.running').waitFor({ timeout: T.medium });
  await page.locator('details.steps > summary').first().click();
  const tools = page.locator('details.steps details > summary');
  for (let i = 0; i < (await tools.count()); i++) await tools.nth(i).click();
  const card = page.getByRole('alertdialog');
  await card.waitFor({ timeout: T.medium });
  const r = await page.locator('.messages').evaluate((list) => {
    list.scrollTop = list.scrollHeight;
    const box = list.getBoundingClientRect();
    const allow = [...list.querySelectorAll('.confirm button')].find((b) => b.textContent === 'Allow');
    const at = allow.getBoundingClientRect();
    const hit = document.elementFromPoint(at.x + at.width / 2, at.y + at.height / 2);
    return { cardBottom: list.querySelector('.confirm').getBoundingClientRect().bottom, listBottom: box.bottom, hit: hit === allow ? 'Allow' : `${hit?.tagName}.${hit?.className}` };
  });
  if (r.cardBottom > r.listBottom + 1 || r.hit !== 'Allow') throw new Error(`the card cannot be reached: ${JSON.stringify(r)}`);
  // A closed group's content is out of the layout (display: none, not the browser's
  // content-visibility: hidden), so that the list's height counts what is shown (style.css).
  const hidden = await page.locator('.messages details:not([open])').evaluateAll((all) => all.map((d) => getComputedStyle(d, '::details-content').display));
  if (!hidden.length || hidden.some((d) => d !== 'none')) throw new Error(`closed details in the chat: ${hidden.join(', ')}`);
  await card.getByRole('button', { name: 'Allow', exact: true }).click();
  await page.getByText('EXPAND OK').waitFor({ timeout: T.medium });
};

// Stop keeps what was streamed, says so, and the next message tells the model.
EXPECT['stop'] = ['Half a thought', 'PARTIAL ANSWER', 'Stopped by you', 'RESUMED OK'];
MID_TURN.stop = true;
AFTER['stop'] = async (page) => {
  await page.getByText('PARTIAL ANSWER').waitFor({ timeout: T.medium });
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByText('Stopped by you').waitFor({ timeout: T.short });
  await page.waitForTimeout(QUIET_MS); // nothing from the stopped run may arrive after
  if (!(await page.getByText('PARTIAL ANSWER').count())) throw new Error('the partial answer was dropped');
  await page.getByPlaceholder(/Ask something/).fill('go on');
  await page.keyboard.press('Enter');
  await page.getByText(/RESUMED OK|NOT TOLD/).waitFor({ timeout: T.max });
  // Layers shows the note as a piece of the next message.
  await page.getByRole('button', { name: 'Show the chat as: Markdown' }).click();
  await page.getByRole('menuitemradio', { name: 'Layers' }).click();
  for (const chip of await page.locator('.messages .layer-chip').all()) await chip.click();
  const second = page.locator('.messages details.layer.sent').last();
  const pieces = (await second.locator('details.conv-msg.new .conv-piece-head > span:first-child').allInnerTexts()).join('|');
  if (pieces !== 'Previous turn stopped|Your message|Page block') throw new Error(`message pieces: ${pieces}`);
  await page.getByRole('button', { name: 'Show the chat as: Layers' }).click();
  await page.getByRole('menuitemradio', { name: 'Markdown' }).click();
};


// A heading folded while the answer streams, by keyboard: what is under it, its subheading too, stays
// hidden as the text grows and once the answer is a message of the history; what follows does not.
EXPECT['fold-headings'] = ['INTRO-TEXT', 'Alpha', 'Gamma', 'GAMMA-BODY', 'BETA-MORE-20'];
MID_TURN['fold-headings'] = true;
AFTER['fold-headings'] = async (page) => {
  const fold = page.getByRole('button', { name: 'Fold Alpha' });
  await fold.waitFor({ timeout: T.medium });
  const visible = (text) => page.getByText(text).isVisible();
  await fold.focus();
  await page.keyboard.press('Enter');
  const unfold = page.getByRole('button', { name: 'Unfold Alpha' });
  await unfold.waitFor({ timeout: T.short });
  const check = async (when) => {
    if ((await unfold.getAttribute('aria-expanded')) !== 'false') throw new Error(`${when}: not marked folded`);
    if (!(await visible('INTRO-TEXT'))) throw new Error(`${when}: the text before the heading was hidden`);
    if (await visible('ALPHA-BODY')) throw new Error(`${when}: its text still shows`);
    if (await page.getByRole('heading', { name: 'Beta' }).isVisible()) throw new Error(`${when}: its subheading still shows`);
    if (await page.getByText('BETA-BODY').isVisible()) throw new Error(`${when}: its subsection still shows`);
  };
  await check('at once');
  if (!(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Unfold Alpha'))) throw new Error('the button lost the focus');
  await page.getByText('GAMMA-BODY').waitFor({ timeout: T.turn });
  await check('after streaming on');
  // Saved in the history, so shown anew by another component than the one that streamed it.
  await waitFor(async () => !(await page.getByRole('button', { name: 'Stop', exact: true }).count()), T.medium);
  await check('as a message of the history');
  if (!(await visible('GAMMA-BODY'))) throw new Error('the next section was hidden too');
  await unfold.focus();
  await page.keyboard.press('Space');
  await page.getByText('ALPHA-BODY').waitFor({ timeout: T.short });
  if (!(await page.getByRole('heading', { name: 'Beta' }).isVisible())) throw new Error('unfolded, its subheading stays hidden');
};

CHECK['markdown'] = async ({ page, errors }) => {
  if (await page.locator('.markdown strong', { hasText: 'Bold claim' }).count() !== 1) errors.push('bold not rendered');
  if (await page.locator('.markdown img').count()) errors.push('raw HTML rendered');
  // Code blocks get syntax colors.
  if (!(await page.locator('.markdown pre code.hljs .hljs-keyword', { hasText: 'const' }).count())) errors.push('code block without syntax colors');
  if ((await page.title()) === 'pwned') errors.push('HTML executed');
  // Code blocks and tables copy what they show; a table also as HTML.
  const copied = await recordClipboard(page);
  await page.getByRole('button', { name: 'Copy the code' }).click();
  await page.getByRole('button', { name: 'Copy the table' }).click();
  const [code, table] = await copied();
  if (code?.plain !== 'const total = 42; // sum') errors.push(`copied code: ${JSON.stringify(code)}`);
  if (table?.plain !== '| Name | Price |\n| --- | --- |\n| Cable | 9 |' || !table.html?.startsWith('<table')) errors.push(`copied table: ${JSON.stringify(table)}`);
  // A frame the page does not let write the clipboard (the chat floating there): the copy
  // command still copies, the HTML too.
  // The buttons say "Copied" for a moment, then their name again.
  for (const name of ['Copy the code', 'Copy the table']) await page.getByRole('button', { name, exact: true }).waitFor({ timeout: T.short });
  await page.evaluate(() => {
    window.__copied = [];
    navigator.clipboard.writeText = navigator.clipboard.write = async () => { throw new DOMException('blocked by permissions policy', 'NotAllowedError'); };
    window.addEventListener('copy', (e) => window.__copied.push({ plain: e.clipboardData.getData('text/plain'), html: e.clipboardData.getData('text/html') })); // after the button's own handler
  });
  await page.getByRole('button', { name: 'Copy the code' }).click();
  await page.getByRole('button', { name: 'Copy the table' }).click();
  const [code2, table2] = await copied();
  if (code2?.plain !== 'const total = 42; // sum') errors.push(`copied code without the clipboard API: ${JSON.stringify(code2)}`);
  if (!table2?.plain.startsWith('| Name | Price |') || !table2.html?.startsWith('<table')) errors.push(`copied table without the clipboard API: ${JSON.stringify(table2)}`);
  // As Jira markup: shown and copied as a Jira issue takes it.
  await page.getByRole('button', { name: 'Show the chat as: Markdown' }).click();
  await page.getByRole('menuitemradio', { name: 'Jira markup' }).click();
  const jira = await page.locator('.msg.assistant.raw').last().innerText().catch(() => '');
  const JIRA = '*Bold claim* with {{code}}\n\n* first item\n* second item\n\n{code:js}\nconst total = 42; // sum\n{code}\n\n||Name||Price||\n|Cable|9|';
  if (!jira.startsWith(JIRA)) errors.push(`Jira markup: ${JSON.stringify(jira.slice(0, 200))}`);
  const copiedJira = await recordClipboard(page);
  await page.getByRole('button', { name: 'Copy the answer (Jira markup)' }).last().click();
  if (!(await copiedJira()).at(-1)?.plain.startsWith(JIRA)) errors.push('the answer was not copied as Jira markup');
  await page.getByRole('button', { name: 'Show the chat as: Jira markup' }).click();
  await page.getByRole('menuitemradio', { name: 'Markdown' }).click();
};

// A narrow panel (Vivaldi's web panel can be made so): with the page bar full (a site template, a
// policy with its longest label, the conversation's own, a selection) and content wider than the
// panel in the messages, the page never gets wider than the panel, nor can it be scrolled sideways.
TEMPLATES['narrow-panel'] = TEMPLATES['page-template'];
ACTIONS['narrow-panel'] = { model: 'narrow-panel-with-a-rather-long-model-name', answer: [{ button: `Allow on ${HOST} ▾` }, { menuitem: 'In this conversation' }], expect: ['NARROW OK', 'this conversation'], policy: 'ask' };
MESSAGES['narrow-panel'] = `Buy it ${'Unbroken'.repeat(30)}`;
AFTER['narrow-panel'] = async (page) => {
  await page.locator('select[title*="may do on this site"]').selectOption('auto');
  const shop = page.context().pages().find((p) => p.url().includes('/shop.html'));
  await shop.evaluate(() => getSelection().selectAllChildren(document.querySelector('h1')));
  await page.locator('.selection-chip').waitFor({ timeout: T.medium });
};
CHECK['narrow-panel'] = async ({ page, errors }) => {
  for (const width of [320, 400, 480]) {
    await page.setViewportSize({ width, height: 700 });
    const seen = await page.evaluate(async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const root = document.documentElement;
      const inView = (r) => r.left >= -0.5 && r.right <= root.clientWidth + 0.5;
      // What sticks out of the panel without a box of its own that clips or scrolls it.
      const clipped = (el) => { for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return true; return false; };
      const out = [...document.querySelectorAll('#root *')].filter((el) => el.getBoundingClientRect().width && !inView(el.getBoundingClientRect()) && inView(el.parentElement.getBoundingClientRect()) && !clipped(el))
        .map((el) => `${el.tagName.toLowerCase()}${[...el.classList].map((c) => `.${c}`).join('')} (${Math.round(el.getBoundingClientRect().width)}px)`);
      root.scrollLeft = 100;
      document.body.scrollLeft = 100;
      const scrolled = root.scrollLeft || document.body.scrollLeft;
      root.scrollLeft = 0;
      const list = document.querySelector('.messages');
      return { wide: root.scrollWidth - root.clientWidth, scrolled, out, list: list.scrollWidth - list.clientWidth };
    });
    if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/narrow-panel-${width}.png` });
    if (seen.wide > 0 || seen.scrolled) errors.push(`${width}px: the page is ${seen.wide}px wider than the panel and scrolls sideways by ${seen.scrolled}px; out of it: ${seen.out.slice(0, 8).join(', ')}`);
    if (seen.list > 0) errors.push(`${width}px: the messages scroll sideways (${seen.list}px)`);
  }
  // Whatever might still stick out one day: clipped, and the focus going to it scrolls nothing.
  const guarded = await page.evaluate(() => {
    const wide = Object.assign(document.createElement('div'), { style: 'width: 2000px; text-align: right' });
    const far = wide.appendChild(document.createElement('button'));
    document.querySelector('.app').append(wide);
    far.focus();
    const root = document.documentElement;
    const seen = { wide: root.scrollWidth - root.clientWidth, scrolled: root.scrollLeft + document.body.scrollLeft };
    wide.remove();
    return seen;
  });
  if (guarded.wide > 0 || guarded.scrolled) errors.push(`something wider than the panel widens the page by ${guarded.wide}px and its button's focus scrolls it by ${guarded.scrolled}px`);
};
