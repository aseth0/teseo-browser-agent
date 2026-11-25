// The options page: the skill and template editors, settings kept in sync.
import { HOST, PORT, QUIET_MS, T, stored, waitFor } from '../lib.mjs';
import { recordClipboard, toolCount, unfoldPreview } from './helpers.mjs';
import { BETWEEN, REJECT, RUN } from './tables.mjs';

RUN['skill-editor'] = async ({ page, errors, ctx, extId, shop, action, model }) => {
  // Create a general skill from the options page; the model must see it in the catalog.
  const options = await ctx.newPage();
  await options.goto(`chrome-extension://${extId}/options.html#skills`);
  await options.getByRole('button', { name: '＋ New skill' }).click();
  await options.getByLabel('Name').fill('my-skill');
  await options.getByLabel(/^Description/).fill('Created from the options page.');
  await options.getByLabel(/^Instructions/).fill('Say hello politely.');
  await options.getByRole('button', { name: 'Save', exact: true }).click();
  await options.getByText('my-skill', { exact: true }).waitFor({ timeout: T.short }).catch(() => errors.push('skill not listed after saving'));
  // Listed in a table, the buttons above it.
  const headers = (await options.locator('.skills-table th').allInnerTexts()).join('|');
  if (headers !== 'On|Skill|Tags|Agents|Description') errors.push(`skills table: ${headers}`);
  if (process.env.E2E_SHOTS) await options.screenshot({ path: `${process.env.E2E_SHOTS}/skills-table.png` });
  // Prompt preview, Templates: every fixed text, editable.
  await options.getByRole('navigation').getByRole('link', { name: 'Prompt preview', exact: true }).click();
  const preview = await unfoldPreview(options); // its sections start folded, as sent
  const templates = await preview.innerText().catch(() => '');
  for (const want of ['Current web page', '{visible_elements}', 'browser__click', 'Visible page (refs from before may have changed)', 'Not executed: {reason}.']) {
    if (!templates.includes(want)) errors.push(`prompt templates lack: ${want}`);
  }
  // Section toolbar: the JSON sent to the model, and collapsing.
  const systemSection = preview.locator('details.prompt-section').filter({ hasText: 'System message' }).first();
  await systemSection.getByRole('button', { name: 'Show the JSON sent to the model' }).click();
  if (!(await systemSection.innerText()).includes('"role": "system"')) errors.push('section JSON view lacks the system message');
  await systemSection.getByRole('button', { name: 'Show the JSON sent to the model' }).click();
  await systemSection.locator(':scope > summary .prompt-section-title').click();
  if (await systemSection.getByText('Page instructions').isVisible()) errors.push('section did not collapse');
  await systemSection.locator(':scope > summary .prompt-section-title').click();
  // Edit the catalog line; the request below must use it (the mock checks).
  await unfoldPreview(options); // the JSON view left its page groups folded again
  const line = preview.locator('.text-block').filter({ hasText: 'Skills: catalog line' });
  await line.getByRole('button', { name: 'Edit' }).click();
  await line.locator('textarea').fill('* {skill_name} — {skill_description}');
  await line.getByRole('button', { name: 'Save' }).click();
  // A template without its placeholders cannot be saved.
  await line.getByRole('button', { name: 'Edit' }).click();
  await line.locator('textarea').fill('no placeholders');
  if (!(await line.getByRole('button', { name: 'Save' }).isDisabled())) errors.push('saved a template without its placeholders');
  await line.getByRole('button', { name: 'Cancel' }).click();
  // Tool texts are edited in Tools: the preview links to the tool, opened in its side panel.
  await preview.locator('.reply-owner').filter({ hasText: 'browser__click' }).getByRole('link', { name: 'Tools →' }).first().click();
  const card = options.locator('.tool-drawer');
  await card.waitFor({ timeout: T.short }).catch(() => errors.push('the Tools link did not open the tool'));
  for (const want of ['Description', 'Action note', 'clicked', 'replies shared by every page action']) {
    if (!(await card.innerText().catch(() => '')).includes(want)) errors.push(`tool lacks: ${want}`);
  }
  await options.getByRole('navigation').getByRole('link', { name: 'Prompt preview', exact: true }).click();
  // Preview single call: the request with invented data, then with a real URL.
  await preview.getByRole('button', { name: 'Preview single call', exact: true }).click();
  await preview.getByText('my-skill — Created', { exact: false }).waitFor({ timeout: T.short }).catch(() => {}); // skills load async
  await unfoldPreview(options);
  const example = await preview.innerText().catch(() => '');
  for (const want of ['my-skill — Created from the options page.', 'Add the white ones to the cart', 'url: https://shop.example.com/headphones/aurora-x2']) {
    if (!example.includes(want)) errors.push(`prompt example lacks: ${want}`);
  }
  await preview.getByPlaceholder(/^https:/).fill(`http://localhost:${PORT}/shop.html`);
  await preview.getByRole('button', { name: 'Load' }).click();
  await preview.getByText(`loaded from ${HOST}`).waitFor({ timeout: T.max }).catch(() => errors.push('prompt example did not load the URL'));
  await unfoldPreview(options);
  // The text taken from the page is highlighted where it reaches the model.
  const marked = await preview.locator('details.prompt-section').filter({ hasText: '3 · Your message' }).locator('mark.origin-page').allInnerTexts();
  if (!marked.includes('Demo Shop · X1 Headphones')) errors.push(`page title not highlighted in the message: ${marked.slice(0, 3)}`);
  const filled = await preview.locator('details.prompt-section').filter({ hasText: '3 · Your message' }).locator('mark.origin-message').allInnerTexts();
  if (!filled.includes('Add the white ones to the cart')) errors.push(`your message not highlighted as yours: ${filled.slice(0, 3)}`);
  // Preview conversation: three calls; each resends the previous messages and adds new ones.
  await preview.getByRole('button', { name: 'Preview conversation', exact: true }).click();
  // As chat (default): the panel's bubbles, steps grouped; each message's layers open from its chip.
  const chat = preview.locator('.chat-preview');
  const bubbles = await chat.locator('.msg.user').allInnerTexts();
  if (bubbles.join('|') !== 'Add the white ones to the cart|How much is shipping?') errors.push(`chat bubbles: ${bubbles.join('|')}`);
  for (const steps of await chat.locator('details.steps:not([open]) > summary').all()) await steps.click();
  if (!(await chat.locator('.tool').first().innerText()).includes('browser__click')) errors.push('chat lacks the tool call bubble');
  for (const chip of await chat.locator('.layer-chip').all()) await chip.click();
  if ((await chat.locator('details.layer.sent').count()) !== 3) errors.push(`chat lacks the three requests: ${await chat.locator('details.layer.sent').count()}`);
  await preview.getByRole('button', { name: 'As calls', exact: true }).click();
  await unfoldPreview(options); // its calls start folded
  const call = (n) => preview.locator('details.prompt-section').filter({ hasText: `Call ${n} ·` }).first();
  const tags = async (n) => (await call(n).locator('.conv-tag').allInnerTexts()).join(',');
  if ((await tags(1)) !== 'New,New') errors.push(`call 1 tags: ${await tags(1)}`);
  if ((await tags(2)) !== 'resent,resent,New,New') errors.push(`call 2 tags: ${await tags(2)}`);
  if ((await tags(3)) !== 'resent,resent,resent,resent,New,New') errors.push(`call 3 tags: ${await tags(3)}`);
  if (!(await call(2).innerText()).includes('calls browser__click')) errors.push('call 2 lacks the tool request');
  await call(3).evaluate((el) => el.querySelectorAll('details').forEach((d) => (d.open = true))); // the attached blocks are folded
  const third = await call(3).innerText();
  if (!third.includes('How much is shipping?') || !third.includes('Demo Shop · X1 Headphones')) errors.push('call 3 lacks the follow-up or the loaded page');
  await options.close();
};

RUN['template-editor'] = async ({ page, errors, ctx, extId, shop }) => {
  // Create a template in the options page, previewing it live on a page opened in the background.
  const options = await ctx.newPage();
  await options.goto(`chrome-extension://${extId}/options.html#site-templates`);
  await options.getByRole('button', { name: '＋ New site' }).click();
  await options.getByLabel(/^Name/).fill('my-template');
  await options.getByLabel(/^Website: URL patterns/).fill('*://localhost/*');
  await options.getByLabel(/^Template/).fill('Heading: {{ page | one: "h1" }}');
  const shopTabs = () => ctx.pages().filter((p) => p.url().includes('/shop.html')).length;
  const before = shopTabs();
  await options.getByPlaceholder(/video\.example\.com\/results/).fill(`http://localhost:${PORT}/shop.html`);
  await options.getByRole('button', { name: 'Load' }).click();
  const preview = options.locator('.template-preview');
  await preview.getByText('main:1 one "h1": found 1 of 1 times').waitFor({ timeout: T.long }).catch(() => errors.push('editor: no diagnosis'));
  // Edited again: run on the open page without reloading it.
  await options.getByLabel(/^Template/).fill('Heading: {{ page | one: "h1" }} {{ page | one: ".missing" }}');
  await preview.getByText('main:1 one ".missing": nothing found ⚠').waitFor({ timeout: T.short }).catch(() => errors.push('editor: preview not updated on edit'));
  if (!(await preview.innerText()).includes('<page_template name="my-template" view="main">')) errors.push('editor: preview lacks the note');
  await options.getByLabel(/^Template/).fill('Heading: {{ page | one: "h1" }}');
  await options.getByRole('button', { name: 'Save', exact: true }).click();
  // Back in the table: listed, and it can be switched off and on again.
  const row = options.locator('.templates-table tr', { hasText: 'my-template' });
  await row.waitFor({ timeout: T.short }).catch(() => errors.push('template not listed after saving'));
  const toggle = row.getByLabel('my-template: on');
  await toggle.click(); // it shows the stored value
  if (!(await waitFor(async () => !(await toggle.isChecked()), T.short))) errors.push('table: not switched off');
  await toggle.click();
  if (!(await waitFor(async () => toggle.isChecked(), T.short))) errors.push('table: not switched back on');
  await waitFor(async () => shopTabs() === before, T.short);
  if (shopTabs() !== before) errors.push(`editor: the preview tab was not closed (${shopTabs()} vs ${before})`);
  await options.close();
};

RUN['options-sync'] = async ({ page, errors, ctx, extId, model }) => {
  // Settings changed in the options page must reach the open panel without a reload.
  const options = await ctx.newPage();
  await options.goto(`chrome-extension://${extId}/options.html`);
  // Once it has loaded (it waits for the settings): the menu is there.
  await options.getByRole('navigation', { name: 'Settings sections' }).waitFor({ timeout: T.medium }).catch(() => undefined);
  for (const title of ['Providers', 'Tools', 'Website access', 'Site policies']) {
    if (!(await options.getByRole('link', { name: title, exact: true }).count())) errors.push(`options: no "${title}" section`);
  }
  // The menu starts with the preview (where the system prompt is edited), then the sections by group
  // (the RAG ones: Memory, Skills, Site templates…); their names without the icons before them.
  const menu = await options.getByRole('navigation', { name: 'Settings sections' }).getByRole('link')
    .evaluateAll((links) => links.map((a) => [...a.childNodes].filter((n) => !n.classList?.contains('options-nav-icon')).map((n) => n.textContent).join('').trim()));
  const at = ['Prompt preview', 'Agents', 'Memory', 'Skills', 'Site templates'].map((t) => menu.indexOf(t));
  if (at[0] !== 0 || at.some((i, n) => i < 0 || (n && i <= at[n - 1]))) errors.push(`menu: ${menu.join(', ')}`);
  const [shown, total] = await toolCount(page); // before a tool is switched off below
  // Sections are shown one at a time: Prompt preview first (the landing page), Tools after picking it.
  await options.locator('.prompt-preview').waitFor({ timeout: T.short }).catch(() => errors.push('options: Prompt preview is not the landing page'));
  if (await options.locator('[id="tool-browser.find"]').count()) errors.push('options: Tools visible before selecting it');
  await options.getByRole('navigation').getByRole('link', { name: 'Tools', exact: true }).click();
  // The section follows the hash, which changes after the click (hashchange).
  await waitFor(async () => !(await options.locator('.prompt-preview').count()), T.short);
  if (await options.locator('.prompt-preview').count()) errors.push('options: Prompt preview still visible after selecting Tools');
  await options.locator('.tool-groups').getByRole('button', { name: /^Browser/ }).click();
  await options.locator('[id="tool-browser.find"] input[type=checkbox]').click();
  if (await options.locator('.tool-drawer').count()) errors.push('options: the switch opened the tool');
  // Appearance: the side panel itself as a preview, with the example conversation and its buttons.
  await options.getByRole('navigation').getByRole('link', { name: 'Appearance', exact: true }).click();
  const panel = options.frameLocator('iframe[title="Side panel preview"]');
  await panel.getByText('Add the white ones to the cart').waitFor({ timeout: T.medium }).catch(() => errors.push('appearance: no panel preview'));
  if (!(await panel.getByPlaceholder(/Ask something/).count())) errors.push('appearance: the preview lacks the message box');
  // Changing an option beside the preview keeps the page where it was (the panel scrolls only its own
  // list): scrolled a little, the option still in view (a click scrolls to it first).
  await options.evaluate(() => window.scrollTo(0, 100));
  const scrolled = await options.evaluate(() => window.scrollY);
  await options.getByRole('group', { name: 'Tool calls' }).getByRole('button', { name: 'Compact' }).click();
  await options.waitForTimeout(QUIET_MS); // a jump would have happened by now
  if (scrolled === 0 || (await options.evaluate(() => window.scrollY)) !== scrolled) errors.push('appearance: the page jumped after a change');
  // The text size scales the panel's messages.
  await options.getByRole('group', { name: 'Text size' }).getByRole('button', { name: '125%' }).click();
  const zoomOf = () => panel.locator('.messages > .msg.user').first().evaluate((el) => getComputedStyle(el).zoom);
  await waitFor(async () => (await zoomOf()) === '1.25', T.short);
  const zoom = await zoomOf();
  if (zoom !== '1.25') errors.push(`appearance: text size not applied (zoom ${zoom})`);
  // Theme tab: Dark applies to Settings and to the panel, whatever the system says.
  await options.getByRole('tab', { name: 'Theme', exact: true }).click();
  await options.getByRole('group', { name: 'Mode' }).getByRole('button', { name: 'Dark' }).click();
  const themes = async () => [await options.evaluate(() => document.documentElement.dataset.theme), await options.frameLocator('iframe[title="Side panel preview"]').locator('html').getAttribute('data-theme')];
  await waitFor(async () => (await themes()).join() === 'dark,dark', T.short);
  if ((await themes()).join() !== 'dark,dark') errors.push(`appearance: dark mode not applied (${(await themes()).join()})`);
  // A highlight color (Layers tab) reaches the panel.
  await options.getByRole('tab', { name: 'Layers', exact: true }).click();
  await options.getByLabel('Your message color').fill('#ff0000');
  const previewStyle = (name) => options.frameLocator('iframe[title="Side panel preview"]').locator('html').evaluate((el, n) => el.style.getPropertyValue(n), name);
  await waitFor(async () => (await previewStyle('--origin-message')) === '#ff0000', T.short);
  const color = await previewStyle('--origin-message');
  if (color !== '#ff0000') errors.push(`appearance: highlight color not applied (${color})`);
  // A ready-made theme sets the accent and the highlights at once.
  await options.getByRole('tab', { name: 'Theme', exact: true }).click();
  await options.getByRole('radio', { name: 'Ocean' }).click();
  const accents = async () => [await previewStyle('--accent'), await previewStyle('--origin-message')].join();
  await waitFor(async () => (await accents()) === '#0284c7,#7dd3fc', T.short);
  const ocean = await accents();
  if (ocean !== '#0284c7,#7dd3fc') errors.push(`appearance: the Ocean theme was not applied (${ocean})`);
  if ((await options.getByRole('radio', { name: 'Ocean' }).getAttribute('aria-checked')) !== 'true') errors.push('appearance: Ocean not shown as chosen');
  // Save as theme: the current appearance under a name (never a built-in one), chosen again later,
  // replaced after asking, deleted after asking.
  await options.getByLabel('Accent color').fill('#123456');
  await options.getByRole('button', { name: 'Save as theme…' }).click();
  await options.getByLabel('Theme name').fill('ocean');
  if (!(await options.getByText(/is a built-in theme/).count())) errors.push('themes: a built-in name was not refused');
  await options.getByLabel('Theme name').fill('Mine');
  await options.getByRole('button', { name: 'Save', exact: true }).click();
  const mine = options.getByRole('radiogroup', { name: 'Your themes' }).getByRole('radio', { name: 'Mine' });
  await mine.waitFor({ timeout: T.short }).catch(() => errors.push('themes: the saved theme is not listed'));
  await options.getByRole('radio', { name: 'Ocean' }).click();
  await waitFor(async () => (await previewStyle('--accent')) === '#0284c7', T.short);
  await mine.click();
  await waitFor(async () => (await previewStyle('--accent')) === '#123456', T.short);
  if ((await previewStyle('--accent')) !== '#123456' || (await mine.getAttribute('aria-checked')) !== 'true') errors.push('themes: choosing the saved theme did not apply it');
  await options.getByRole('button', { name: 'Save as theme…' }).click();
  await options.getByLabel('Theme name').fill('Mine');
  await options.getByRole('button', { name: 'Save', exact: true }).click();
  await options.getByRole('button', { name: 'Confirm: replace the theme Mine' }).click({ timeout: T.short }).catch(() => errors.push('themes: replacing did not ask first'));
  // Import from pasted JSON: saved to the list, not applied.
  await options.locator('.theme-files').getByRole('button', { name: 'Import ▾' }).click();
  await options.getByRole('menuitem', { name: 'From JSON…' }).click();
  await options.getByLabel(/Theme JSON/).fill(JSON.stringify({ type: 'browser-agent-theme', version: 1, name: 'Pasted', accent: '#abcdef', highlights: { nowhere: '#000000' } }));
  await options.locator('.paste-json').getByRole('button', { name: 'Import', exact: true }).click();
  await options.getByText(/Imported "Pasted": pick it in Theme to use it/).waitFor({ timeout: T.short }).catch(() => errors.push('themes: the import did not say what it did'));
  if (!(await options.getByText(/Left out "Pasted" highlight "nowhere"/).count())) errors.push('themes: the import did not say what it left out');
  if ((await previewStyle('--accent')) !== '#123456') errors.push('themes: the import applied the theme');
  await options.getByRole('button', { name: 'Delete the theme Mine' }).click();
  await options.getByRole('button', { name: 'Confirm: delete the theme Mine' }).click();
  await mine.waitFor({ state: 'detached', timeout: T.short }).catch(() => errors.push('themes: the theme was not deleted'));
  // Flexoki: a palette for each mode, the text on its accent worked out, its credit shown; another
  // theme takes it off.
  await options.getByRole('radio', { name: 'Flexoki' }).click();
  const look = async () => [await previewStyle('--bg'), await previewStyle('--accent'), await previewStyle('--on-accent')].join();
  await waitFor(async () => (await look()) === '#100f0f,#da702c,#1b1b1d', T.short);
  if ((await look()) !== '#100f0f,#da702c,#1b1b1d') errors.push(`themes: Flexoki dark not applied (${await look()})`);
  if (!(await options.getByText('Flexoki by Steph Ango (stephango.com/flexoki), MIT license.').count())) errors.push('themes: Flexoki without its credit');
  await options.getByRole('group', { name: 'Mode' }).getByRole('button', { name: 'Light' }).click();
  await waitFor(async () => (await look()) === '#fffcf0,#bc5215,#ffffff', T.short);
  if ((await look()) !== '#fffcf0,#bc5215,#ffffff') errors.push(`themes: Flexoki light not applied (${await look()})`);
  await options.getByRole('radio', { name: 'Ocean' }).click();
  await waitFor(async () => (await previewStyle('--bg')) === '', T.short);
  if ((await previewStyle('--bg')) !== '' || (await options.getByText(/Flexoki by Steph Ango/).count())) errors.push('themes: Flexoki stayed after choosing another theme');
  await options.close();
  await page.getByTitle('Tools offered to the model').getByText(`${shown - 1}/${total}`).waitFor({ timeout: T.short }).catch(() => errors.push('panel did not pick up the change'));
  // A change, and its page gone in the same task (as the popup closes on a click): still stored.
  const again = await ctx.newPage();
  await again.goto(`chrome-extension://${extId}/options.html#appearance`);
  const small = again.getByRole('group', { name: 'Text size' }).getByRole('button', { name: '90%' });
  await small.waitFor({ timeout: T.medium });
  const closed = again.waitForEvent('close', { timeout: T.short }).then(() => true, () => false);
  await small.evaluate((b) => {
    b.click();
    window.close(); // a tab with one page in its history may close itself
  }).catch(() => undefined); // the page may be gone before the answer
  if (!(await closed)) {
    errors.push('options: the page did not close itself');
    await Promise.race([again.close(), new Promise((r) => setTimeout(r, T.short))]);
  }
  if (!(await waitFor(async () => (await stored(page, 'settings')).chatView?.textSize === 90, T.short))) errors.push(`a change made as its page closed is not stored: ${JSON.stringify((await stored(page, 'settings')).chatView)}`);
};

RUN['about-user'] = async ({ errors, ctx, extId }) => {
  // Written in Settings → About you, it reaches the model where {{about_user}} is: Browser's
  // instructions here (the mock checks the system message).
  const options = await ctx.newPage();
  await options.goto(`chrome-extension://${extId}/options.html#about-you`);
  const about = options.locator('.about-you-settings textarea'); // its label's name takes in what it holds
  await about.fill('I am Alex, ABOUT-ME-42.');
  const unused = options.getByText('No prompt uses {{about_user}} yet');
  await unused.waitFor({ timeout: T.short }).catch(() => errors.push('about you: no hint while nothing uses it'));
  await options.goto(`chrome-extension://${extId}/options.html#agents/browser`);
  await options.getByLabel(/^Instructions/).fill('Know the user: {{about_user}}');
  await options.getByRole('button', { name: 'Save', exact: true }).click();
  await options.goto(`chrome-extension://${extId}/options.html#about-you`);
  await about.waitFor({ timeout: T.short }).catch(() => errors.push('about you: not shown again'));
  if (await unused.count()) errors.push('about you: the hint stays once Browser uses it');
  await options.close();
};

// Settings → About you → Date & time: the first turn goes with the default (every part, the browser's
// zone; the mock checks the stamp), then every part is switched off here, the example says nothing goes,
// and the second turn goes without a stamp while the first message is sent as it was.
BETWEEN['date-time'] = async (page) => {
  const options = await page.context().newPage();
  try {
    await options.goto(page.url().replace(/sidepanel\.html.*$/, 'options.html#about-you'));
    await options.getByRole('tab', { name: 'Date & time' }).click();
    const example = options.getByLabel('Example');
    await example.waitFor({ timeout: T.short });
    const shown = await example.innerText();
    if (!/^<message_time>\w+day, .+ \(.+, UTC[+-]\d{2}:\d{2}\)<\/message_time>$/.test(shown)) throw new Error(`example: ${shown}`);
    for (const name of ['Day of the week', 'Date', 'Time', 'Time zone']) {
      const sw = options.getByRole('switch', { name, exact: true });
      await sw.click();
      if (!(await waitFor(async () => !(await sw.isChecked()), T.short))) throw new Error(`${name}: still on`);
    }
    await options.getByText('Nothing: with every part off').waitFor({ timeout: T.short });
    if (!(await waitFor(async () => (await stored(page, 'settings'))?.dateTime?.zone === false, T.short))) throw new Error('not saved');
  } finally {
    await options.close();
  }
};
// The stamp is never shown in the chat.
REJECT['date-time'] = /message_time/;

// Settings → Skills: a skill imported from a URL (through its preview, off), then only it exported,
// chosen with Select.
RUN['collections-io'] = async ({ errors, ctx, extId }) => {
  const options = await ctx.newPage();
  await options.goto(`chrome-extension://${extId}/options.html#skills`);
  await options.getByRole('button', { name: 'Import ▾' }).click();
  await options.getByRole('menuitem', { name: 'From URL…' }).click();
  await options.getByLabel('JSON URL').fill(`http://localhost:${PORT}/collections/skills.json`);
  await options.getByRole('button', { name: 'Read it' }).click();
  const preview = options.locator('.import-preview');
  await preview.waitFor({ timeout: T.medium }).catch(() => undefined);
  if (!(await preview.innerText().catch(() => '')).includes('from-url')) errors.push(`from URL: no preview (${await options.locator('.url-import').innerText().catch(() => '')})`);
  await preview.getByRole('button', { name: 'Import 1' }).click();
  const on = options.getByLabel('from-url: on');
  await on.waitFor({ timeout: T.short }).catch(() => errors.push('from URL: not listed'));
  if (await on.isChecked()) errors.push('from URL: came in switched on');
  const copied = await recordClipboard(options);
  await options.getByRole('button', { name: 'Select', exact: true }).click();
  await options.getByLabel('Select from-url').check();
  await options.locator('.selection-bar').getByRole('button', { name: 'Copy JSON' }).click();
  const exported = JSON.parse((await copied()).at(-1)?.plain ?? '{}');
  if (exported.skills?.map((x) => x.name).join() !== 'from-url') errors.push(`selected export: ${JSON.stringify(exported).slice(0, 200)}`);
  if (await on.isChecked()) errors.push('selecting switched it on');
  await options.getByRole('button', { name: 'Done' }).click();
  await options.close();
};
