// Site policies, turns, actions answered in their card, agents and sub-agents.
import { HOST, setSecret, stored, storedSecret, T, waitFor } from '../lib.mjs';
import { chooseAgent, chosenAgent, editedSkillSaved, editSkillOnCard, toolCount } from './helpers.mjs';
import { ACTIONS, AFTER, AGENT_PROFILES, BEFORE, CARD, EXPECT, MESSAGES, REJECT, SITE_POLICIES, TEMPLATES, TURNS, WORD_BLACKLIST } from './tables.mjs';

// Site policies a scenario starts with (none: every site asks).
Object.assign(SITE_POLICIES, { 'web-search': { localhost: 'auto' }, 'web-read': { localhost: 'auto' }, 'web-sign-in': { localhost: 'auto' }, 'custom-tool': { localhost: 'auto' } });
Object.assign(TURNS, { compaction: 3, 'context-persist': 2, 'context-unchanged': 2, 'site-skill': 2, 'message-actions': 2, 'memory-prompt': 2, 'memory-stable': 2, 'mention-open': 2, 'compaction-trim': 2, 'compaction-tool': 3, 'repetition-loop': 2, 'date-time': 2 });
// Action scenarios: model script + how the test answers the confirmation card.
Object.assign(ACTIONS, {
  'click-deny': { model: 'act-click', answer: 'Deny', expect: 'DENIED OK' },
  'click-allow-comment': { model: 'act-click', answer: 'Allow', comment: 'then checkout', expect: ['ALLOW COMMENT OK', 'then checkout'] },
  'click-deny-comment': { model: 'act-click', answer: 'Deny', comment: 'use the white ones', expect: ['DENY COMMENT OK', 'use the white ones'] },
  'click-always': { model: 'act-click', answer: [{ button: `Allow on ${HOST} ▾` }, { menuitem: 'Always (site policy)' }], expect: 'ACT OK', policy: 'auto' },
  // Allowed for this conversation only: the site's policy stays "ask", a chip says so.
  'click-session': { model: 'act-click', answer: [{ button: `Allow on ${HOST} ▾` }, { menuitem: 'In this conversation' }], expect: ['ACT OK', 'this conversation'], policy: 'ask' },
  'type-submit': { model: 'act-type', answer: 'Allow', expect: 'ACT OK' },
  // The word blacklist: the model gets the placeholder, the page (and the chat) the real term.
  'word-blacklist': { model: 'word-blacklist', answer: 'Allow', expect: 'WBL OK for Acme Labs.' },
  // Not for this provider: off until turned on in the chat's page bar.
  'word-blacklist-manual': { model: 'word-blacklist', answer: 'Allow', expect: 'WBL OK for Acme Labs.' },
  // A field browser.find misses (a searchbox), found by CSS selector, then typed into by its ref.
  'dom-type': { model: 'dom-type', answer: 'Allow', expect: 'DOM TYPE OK' },
  'select-option': { model: 'act-select', answer: 'Allow', expect: 'ACT OK' },
  navigate: { model: 'navigate', answer: 'Allow', expect: 'NAV OK' },
  'link-click': { model: 'act-link', answer: 'Allow', expect: 'LINK OK' },
  'webmcp-allow': { model: 'webmcp', answer: 'Allow', expect: ['WEBMCP OK', '1 page tool'] },
  // Navigated to in the turn: the page's tool is offered from the next request on (and takes JSON text).
  'webmcp-navigate': { model: 'webmcp-navigate', answer: [{ button: 'Allow' }, { button: 'Allow' }], expect: 'WEBMCP NAV OK' },
  mcp: { model: 'mcp', answer: 'Allow', expect: ['MCP OK echo', 'MCP 4/4'] }, // two more servers added at the end (AFTER.mcp)
  'mcp-on-demand': { model: 'mcp-on-demand', answer: 'Allow', expect: ['MCP ON DEMAND OK'] },
  'tool-match': { model: 'tool-match', answer: 'Allow', expect: ['TOOL MATCH OK'] },
  'site-access': { model: 'site-access', answer: 'Allow', expect: 'SITE ACCESS OK' },
  'mcp-oauth': { model: 'mcp', answer: 'Allow', expect: ['MCP OK echo', 'notes'] }, // with a warning: signed out at the end
  'access-deny': { model: 'access-deny', answer: [{ dialog: 'Confirm action', button: 'Allow' }, { dialog: 'Allow reading a site', button: 'Deny' }], expect: 'ACCESS OK' },
  // The card and the tool call say which tab, by its title.
  'find-other-tab': { model: 'find-other', answer: 'Allow', expect: ['OTHER TAB OK', 'Deals'] },
  'tech-view': { model: 'act-click', answer: 'Allow', expect: 'ACT OK' },
  'skill-save': { model: 'skill-save', answer: 'Allow', expect: ['SAVE OK', 'shop-buy'] },
  // Edited on the card before it is allowed (CARD): the model is told what changed.
  'skill-edit': { model: 'skill-edit', answer: [], expect: 'EDIT SAVE OK' },
  'template-save': { model: 'template-save', answer: 'Allow', expect: ['TSAVE OK', 'shop-product'] },
  'template-edit': { model: 'template-edit', answer: 'Allow', expect: 'TEDIT OK' },
  'custom-save': { model: 'custom-save', answer: 'Allow', expect: 'CUSTOM SAVED OK' },
  // Tried twice before it is saved: each try is asked, its whole draft and sample on the card.
  'custom-try': { model: 'custom-try', answer: [{ button: 'Allow' }, { button: 'Allow' }, { button: 'Allow' }], expect: 'CUSTOM TRY OK' },
  'custom-edit': { model: 'custom-edit', answer: [{ button: 'Allow' }, { button: 'Allow' }], expect: 'CUSTOM EDIT OK' },
  'action-save': { model: 'action-save', answer: 'Allow', expect: 'ACTION SAVED OK' },
  'action-save-prompt': { model: 'action-save-prompt', answer: 'Allow', expect: 'PROMPT ACTION SAVED OK' },
  'custom-http-post': { model: 'custom-http-post', answer: 'Allow', expect: 'HTTP POST OK' },
  'agent-save': { model: 'agent-save', answer: 'Allow', expect: 'AGENT SAVED OK' },
  'memory-save': { model: 'memory-save', answer: 'Allow', expect: 'MEMORY SAVED OK' },
  'memory-delete': { model: 'memory-delete', answer: 'Allow', expect: 'MEMORY DELETED OK' },
});
// A saved template with two views, one of which the model edits by find/replace.
TEMPLATES['template-edit'] = [{ id: 'sf', name: 'shop-facts', description: '', matches: ['*://shop.example.test/*'], enabled: true, views: [
  { name: 'main', paths: ['*'], replacePage: false, body: 'Name: {{ page | one: "h1" }}\nPrice: {{ page | one: ".price" }}' },
  { name: 'block', paths: [], replacePage: false, body: 'Title: {{ page.title }}\nHeading: {{ page | one: "h2" }}' },
] }];
AFTER['template-edit'] = async (page) => {
  const views = (await stored(page, 'templates'))?.user?.find((t) => t.name === 'shop-facts')?.views ?? [];
  const bodies = views.map((v) => v.body).join(' / ');
  if (bodies !== 'Name: {{ page | one: "h1" }}\nPrice: {{ page | one: ".price" | strip }} / Title: {{ page.title }}\nHeading: {{ page | one: "h2" }}') throw new Error(`saved: ${bodies}`);
};
// What a card shows before it is answered.
const cardText = (page) => page.getByRole('alertdialog').innerText().catch(() => '');
const cardFields = (page) => page.locator('.confirm-details dt').allInnerTexts();
const cardLacks = async (page, errors, wants) => {
  const card = await cardText(page);
  for (const want of wants) if (!card.includes(want)) errors.push(`card lacks ${want}: ${card.slice(0, 300)}`);
};
Object.assign(CARD, {
  // Saving a template: each field of the card apart, the view's code in a block.
  'template-save': async ({ page, errors }) => {
    const fields = await cardFields(page);
    if (!fields.includes('Action') || !fields.includes('Websites') || !fields.some((f) => f.startsWith('View "main"')) || !(await page.locator('.confirm-details .confirm-box.code').count())) errors.push(`card fields: ${fields.join('|')}`);
  },
  // Editing one line of a saved template: the card shows that line removed and added, the other view unchanged.
  'template-edit': async ({ page, errors }) => {
    const dialog = page.getByRole('alertdialog');
    const removed = await dialog.locator('.diff-removed').allInnerTexts();
    const added = await dialog.locator('.diff-added').allInnerTexts();
    if (removed.join('|') !== '− Price: {{ page | one: ".price" }}' || added.join('|') !== '+ Price: {{ page | one: ".price" | strip }}') errors.push(`diff: ${removed.join('|')} / ${added.join('|')}`);
    await cardLacks(page, errors, ['Update the site template "shop-facts"', 'Name: {{ page | one: "h1" }}', 'Unchanged']);
  },
  // Typing: the action in a row, the text in a block of its own (not in the summary).
  'type-submit': async ({ page, errors }) => {
    const fields = await cardFields(page);
    const actionRow = await page.locator('.confirm-action dd').innerText().catch(() => '');
    const block = await page.locator('.confirm-details .confirm-box.code').innerText().catch(() => '');
    if (!fields.includes('Action') || !fields.some((f) => /^Text\b.*\b5 chars$/.test(f)) || actionRow.includes('cable') || !/then press Enter$/.test(actionRow) || block.trim() !== 'cable') errors.push(`type card: ${fields.join('|')} / ${actionRow} / ${block}`);
  },
  // The card asks about the real term: the tool's arguments are restored before the policy sees them.
  'word-blacklist': async ({ page, errors }) => {
    const block = await page.locator('.confirm-details .confirm-box.code').innerText().catch(() => '');
    if (block.trim() !== 'Acme Labs') errors.push(`type card: ${block}`);
  },
  // A field over 20 characters (here the other tab: its title and URL) goes in a box of its own.
  'find-other-tab': async ({ page, errors }) => {
    const box = await page.locator('.confirm-details .confirm-box').innerText().catch(() => '');
    if (!box.includes('Deals')) errors.push(`the tab's title is not in a box of its own: ${box}`);
  },
  // Saving a widget action: the card shows its trial, as the widget would.
  'custom-try': ({ page, errors }) => cardLacks(page, errors, ['Try the custom tool "me.who" once, unsaved (an HTTP request: GET http://localhost/api/me)', 'Tried with', 'user.name']),
  'action-save-prompt': ({ page, errors }) => cardLacks(page, errors, ['Translate to Spanish: {input}', 'not tried now']),
  'action-save': ({ page, errors }) => cardLacks(page, errors, ['Tried with "platypus"', 'Platypus fact → http://localhost/items/Platypus%20fact']),
  // Saving an agent: the card says everything it may do, the site brought down to "ask".
  'agent-save': async ({ page, errors }) => {
    await cardLacks(page, errors, ['Create the agent "Shop" 🛒', 'browser.find', `${HOST}: Ask before acting`, 'Can be asked by them: yes', 'Only read.']);
    // Its nine lines of instructions: collapsed under "Show all", shown whole once clicked.
    const dialog = page.getByRole('alertdialog');
    const clipped = await dialog.locator('.confirm-box.clipped').count();
    await dialog.getByRole('button', { name: 'Show all' }).click({ timeout: T.medium }).catch(() => errors.push('no Show all'));
    const opened = await dialog.locator('.confirm-box').filter({ hasText: '8. Check listing page 8.' }).evaluate((b) => b.scrollHeight <= b.clientHeight + 1).catch(() => false);
    if (clipped !== 1 || !opened || !(await dialog.getByRole('button', { name: 'Show less' }).count())) errors.push(`collapse: clipped ${clipped}, opened ${opened}`);
  },
  // Memory: the card shows the item whole (the site as a host), and what is deleted.
  'memory-save': async ({ page, errors }) => {
    await cardLacks(page, errors, ['Save to memory', 'Prices in euros.', 'Always with VAT.', 'Yes: sent whole while one of its sites is open', 'localhost (reaches the model while one is open)', 'Every agent']);
    if (await page.getByRole('alertdialog').getByRole('button', { name: /^Allow on / }).count()) errors.push('a memory save offers "always"');
  },
  'memory-delete': ({ page, errors }) => cardLacks(page, errors, ['Delete the memory item m-del', 'Forget me.']),
});
// Page each scenario runs on (default: the shop).
// Agents (Settings → Agents): "jira" has its own model (the mock's "agent"), one tool, and only its
// own site ("Only its sites"), so the test page is out of its reach. Chosen in the chat's agent picker.
Object.assign(AGENT_PROFILES, {
  agent: [{
    id: 'jira', enabled: true, name: 'jira', icon: '🎫', description: 'Jira tickets', instructions: 'Keys look like INC-1.',
    providerId: 'env', model: 'agent', tools: ['browser.find'], skills: [], sites: { 'jira.test': 'ask' }, onlyItsSites: true,
  }],
});
// On an agent's site the chat changes to it by itself: "shop" has the test page's host.
AGENT_PROFILES['agent-site'] = [{ id: 'shop', enabled: true, name: 'shop', icon: '🛒', description: 'The shop', instructions: '', providerId: 'env', model: 'basic',
  tools: ['browser.find'], skills: [], templates: [], sites: { [HOST]: 'ask' }, canAsk: false, canBeAsked: false }];
BEFORE['agent-site'] = (page) => page.waitForFunction(() => document.querySelector('.agent-picker .agent-picker-name')?.textContent === 'shop', null, { timeout: 5000 });
BEFORE.agent = (page) => chooseAgent(page, 'jira');
// Sub-agents: jira can ask, "mm" can be asked; mm has its own model, a tool and the test page as its site.
AGENT_PROFILES['sub-agent'] = [
  { ...AGENT_PROFILES.agent[0], model: 'sub-jira', tools: [], canAsk: true },
  { id: 'mm', enabled: true, name: 'mm', icon: '🛰', description: 'Searches the shop', instructions: '', providerId: 'env', model: 'sub-mm',
    tools: ['browser.find'], skills: [], templates: [], sites: { [HOST]: 'ask' }, canBeAsked: true },
];
BEFORE['sub-agent'] = BEFORE.agent;
// "@" lists the agents the chat's agent may ask: "lead" may ask mm, not "shy" (it cannot be asked).
AGENT_PROFILES['agent-mention'] = [
  { id: 'lead', enabled: true, name: 'lead', description: 'Leads', instructions: '', providerId: 'env', model: 'agent-mention', tools: [], skills: [], templates: [], sites: {}, canAsk: true, canBeAsked: false },
  { ...AGENT_PROFILES['sub-agent'][1], sites: {} }, // no site of its own: the chat stays with lead
  { ...AGENT_PROFILES['sub-agent'][1], id: 'shy', name: 'shy', sites: {}, canBeAsked: false },
];
MESSAGES['agent-mention'] = null; // sends what was typed
BEFORE['agent-mention'] = async (page) => {
  // Browser may not ask (its Can ask is off): "@" says why instead of listing nothing.
  const box = page.getByPlaceholder(/Ask something/);
  await box.click();
  await page.keyboard.type('@');
  await page.getByRole('status').filter({ hasText: 'cannot ask other agents' }).waitFor({ timeout: T.short });
  await box.fill('');
  await chooseAgent(page, 'lead');
  await box.click();
  await page.keyboard.type('mail someone@example.com, then ask @M'); // any case
  const list = page.getByRole('listbox', { name: 'Agent mentions' });
  await list.getByRole('option', { name: /mm/ }).waitFor({ timeout: T.short });
  const offered = await list.innerText();
  if (offered.includes('shy') || offered.includes('lead') || !offered.includes('Searches the shop')) throw new Error(`@ offers: ${offered}`);
  await page.keyboard.press('Enter');
  if ((await box.inputValue()) !== 'mail someone@example.com, then ask @mm ') throw new Error(`completed to: ${await box.inputValue()}`);
  const chips = await page.locator('.mention-chips').innerText();
  if (chips.trim() !== 'mm') throw new Error(`chips: ${chips}`);
};
// Builder, switched on, with its own model and only what this test needs; Browser then lacks the
// creating tools. Stored after its skills were taken away (builderSkills: none comes back).
AGENT_PROFILES['agent-save'] = [{ id: 'builder', enabled: true, name: 'Builder', icon: '🛠️', description: 'Creates things', instructions: '', providerId: 'env', model: 'agent-save',
  tools: ['agents.catalog', 'agents.save'], skills: [], templates: [], sites: {}, canAsk: false, canBeAsked: false,
  builderSkills: ['create-agent', 'create-custom-tool', 'create-page-action', 'create-script-tool', 'create-skill', 'create-template', 'manage-creations'] }];
BEFORE['agent-save'] = (page) => chooseAgent(page, 'Builder');
// Saved as reviewed: on, "act without asking" brought down to "ask"; Browser's menu without the creating tools.
AFTER['agent-save'] = async (page) => {
  const agents = await stored(page, 'agents');
  const shop = agents?.user.find((a) => a.name === 'Shop');
  const access = (await storedSecret(page, 'agentAccess'))?.[shop?.id]; // kept apart from it (agents/profiles)
  if (!access?.enabled || access.sites?.[HOST] !== 'ask' || access.tools?.join() !== 'browser.find' || !access.canBeAsked) throw new Error(`saved: ${JSON.stringify(shop)} ${JSON.stringify(access)}`);
  await chooseAgent(page, 'Browser');
  // Its tools counted once chosen, the count no longer changing.
  let last;
  await waitFor(async () => {
    const now = (await chosenAgent(page)) === 'Browser' && (await toolCount(page)).join();
    const steady = now && now === last;
    last = now;
    return steady;
  }, T.short);
  // The creating (and deleting) tools fewer than with Builder off.
  const [, on] = await toolCount(page);
  // Switched off where it is kept (agents/profiles: agentAccess).
  const kept = await storedSecret(page, 'agentAccess');
  await setSecret(page, 'agentAccess', { ...kept, builder: { ...kept.builder, enabled: false } });
  await page.waitForFunction((n) => document.querySelector('#root').querySelector('.tools-count')?.innerText.match(/\d+\/(\d+)/)?.[1] !== String(n), on, { timeout: T.short }).catch(() => undefined);
  const [, off] = await toolCount(page);
  if (off - on !== 12) throw new Error(`Browser's tools: ${on} with Builder on, ${off} with it off (the 12 creating ones are Builder's)`);
};
EXPECT['agent-mention'] = ['AGENT MENTION OK', 'mm'];
EXPECT['sub-agent'] = 'SUB OK'; // the mock checks its tools: the skill loaders and agents.ask, with someone to ask
// The sub-agent's run is kept with the call, for the user.
AFTER['sub-agent'] = async (page) => {
  const savedTrace = async () => {
    const id = (await stored(page, 'convIndex'))?.[0]?.id;
    return (await stored(page, `conv:${id}`))?.history.flatMap((m) => m.parts).find((p) => p.type === 'tool_result' && p.trace);
  };
  await waitFor(savedTrace, T.short);
  const result = await savedTrace();
  const steps = result?.trace?.messages.flatMap((m) => m.parts.map((p) => p.name ?? p.type)).join();
  if (result?.trace?.agent !== '🛰 mm' || !steps?.includes('browser__find')) throw new Error(`trace: ${JSON.stringify(result?.trace)?.slice(0, 300)}`);
  // Shown inside the call, folded: what it did, and its answer.
  await page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));
  await waitFor(async () => (await page.locator('#root').innerText()).includes('MM FOUND the button'), T.short);
  const shown = (await page.locator('#root').innerText()).replace(/\s+/g, ' ');
  if (!shown.includes('🛰 mm') || !shown.includes('browser__find') || !shown.includes('MM FOUND the button')) throw new Error(`the sub-agent's step: ${shown.slice(0, 400)}`);
};
EXPECT.agent = ['AGENT OK', 'Not given to jira']; // the mock checks its tools (its one, and the skill loaders it always has); the page bar, its site
// The conversation is saved as the agent's.
AFTER.agent = async (page) => {
  await waitFor(async () => (await stored(page, 'convIndex'))?.[0]?.agentId === 'jira', T.short);
  const convIndex = await stored(page, 'convIndex');
  if (convIndex?.[0]?.agentId !== 'jira' || convIndex[0].agent !== '🎫 jira') throw new Error(`saved: ${JSON.stringify(convIndex?.[0])}`);
  // Its answer says who gave it.
  const agentMark = await page.locator('.msg-actions .msg-agent').first().innerText().catch(() => '');
  if (agentMark !== '🎫 jira') throw new Error(`answer's agent: ${JSON.stringify(agentMark)}`);
  // Layers rebuilds the request as the agent's: its instructions, not Browser's skills.
  await page.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, chatRender: 'tech', chatView: { ...settings.chatView, techCallsOpen: true } } });
  });
  // Folded blocks render their content once opened: open them, again for the nested ones.
  await waitFor(async () => {
    await page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));
    return /Agent: jira\s+Keys look like INC-1\./.test(await page.locator('#root').innerText());
  }, T.medium);
  const layers = await page.locator('#root').innerText();
  const agentShown = /Agent: jira\s+Keys look like INC-1\./.test(layers); // the heading is drawn, without its ##
  if (!agentShown || layers.includes('create-custom-tool')) throw new Error(`Layers: agent ${agentShown}, Browser's skills ${layers.includes('create-custom-tool')}`);
  // Settings → Agents: listed, and a new one made with a tool and a site.
  const options = await page.context().newPage();
  await options.goto(page.url().replace('sidepanel.html', 'options.html#agents'));
  await options.getByRole('button', { name: /🎫 jira/ }).waitFor({ timeout: T.short });
  // The table: each agent's switches in its row, changed there.
  const headers = (await options.locator('.agents-table th').allInnerTexts()).filter(Boolean).join('|'); // the first, the rows' handles
  if (headers !== 'On|Agent|Tags|Description|Can ask|Can be asked') throw new Error(`agents table: ${headers}`);
  await options.getByLabel('jira can be asked').click(); // it shows the stored value: checked once saved
  const jiraId = (await stored(options, 'agents'))?.user?.find((a) => a.name === 'jira')?.id;
  if (!(await waitFor(async () => (await storedSecret(options, 'agentAccess'))?.[jiraId]?.canBeAsked === true, T.short))) throw new Error('"Can be asked" was not saved from the table');
  if (process.env.E2E_SHOTS) await options.screenshot({ path: `${process.env.E2E_SHOTS}/agents-table.png` });
  await options.getByRole('button', { name: '＋ New agent' }).click();
  await options.getByLabel('Name', { exact: true }).fill('mm');
  await options.locator('.page-section').filter({ has: options.locator('.page-section-head', { hasText: 'Tools' }) }).getByRole('button', { name: 'Edit' }).click(); // its list, from its summary
  await options.locator('.tools-list').getByRole('button', { name: /Browser$/ }).click();
  await options.locator('.tool-row', { hasText: 'browser.read_page' }).getByRole('checkbox').check();
  if (process.env.E2E_SHOTS) await options.screenshot({ path: `${process.env.E2E_SHOTS}/agent-editor.png`, fullPage: true });
  await options.getByLabel('Add a site').fill('https://chat.test/channels/x');
  await options.getByRole('button', { name: 'Add site' }).click();
  await options.getByRole('button', { name: 'Save', exact: true }).click();
  await options.getByRole('button', { name: /^mm/ }).waitFor({ timeout: T.short });
  const agents = await stored(options, 'agents');
  // What it may reach kept apart from it, where no content script can write it (agents/profiles; storage.local
  // keeps a copy, never read).
  const access = await storedSecret(options, 'agentAccess');
  await options.close();
  const mm = agents?.user?.find((a) => a.name === 'mm');
  const own = access?.[mm?.id];
  if (!mm || own?.tools?.join() !== 'browser.read_page' || JSON.stringify(own.sites) !== '{"chat.test":"ask"}') throw new Error(`made: ${JSON.stringify(mm)} ${JSON.stringify(access)}`);
};

// Only for this provider: the mock's ("env"). The placeholder never shows in the chat.
WORD_BLACKLIST['word-blacklist'] = { config: { enabled: true, targets: [{ providerId: 'env' }] }, entries: [{ term: 'Acme Labs', replacement: 'CLIENT_A' }] };
MESSAGES['word-blacklist'] = 'Search the shop for Acme Labs';
REJECT['word-blacklist'] = /CLIENT_A/;
// The tool typed the real term into the page; the page bar says it is on.
AFTER['word-blacklist'] = async (page) => {
  if (!(await page.locator('.pagebar').getByText('Word blacklist', { exact: true }).count())) throw new Error('no word blacklist chip');
  // Your message's shield pill says what was replaced, and where.
  const pill = page.locator('.msg-actions.user .msg-auto-pill').filter({ has: page.locator('.chat-icon') }).last();
  if (!(await pill.getAttribute('title'))?.includes('Your message: Acme Labs → CLIENT_A')) throw new Error(`pill: ${await pill.getAttribute('title')}`);
  // Turning it off once something went masked is asked first.
  await page.locator('.pagebar').getByRole('button', { name: 'Word blacklist', exact: true }).click();
  await page.getByRole('group', { name: /Turn off the word blacklist for this chat/ }).getByRole('button', { name: 'Cancel' }).click();
  const shop = page.context().pages().find((p) => p.url().includes('/shop.html'));
  const shown = await shop?.locator('body').innerText();
  if (!shown?.includes('Searched: Acme Labs')) throw new Error(`the shop shows: ${shown?.slice(0, 200)}`);
};
WORD_BLACKLIST['word-blacklist-manual'] = { config: { enabled: true, targets: [{ providerId: 'other' }] }, entries: [{ term: 'Acme Labs', replacement: 'CLIENT_A' }] };
MESSAGES['word-blacklist-manual'] = MESSAGES['word-blacklist'];
REJECT['word-blacklist-manual'] = /CLIENT_A/;
CARD['word-blacklist-manual'] = CARD['word-blacklist'];
CARD['skill-edit'] = ({ page, errors }) => editSkillOnCard(page).catch((e) => errors.push(`card: ${e.message.split('\n')[0]}`));
AFTER['skill-edit'] = editedSkillSaved;
BEFORE['word-blacklist-manual'] = async (page) => page.getByRole('button', { name: 'Word blacklist: off' }).click({ timeout: T.medium });
AFTER['word-blacklist-manual'] = AFTER['word-blacklist'];
