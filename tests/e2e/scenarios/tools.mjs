// Live web search, the history mention, user tools, history, MCP servers, mentions, limits.
import { HELLO, HOST, LIVE, PORT, QUIET_MS, setSecret, stored, storedSecret, T, waitFor } from '../lib.mjs';
import { mock, OAUTH } from '../mock/state.mjs';
import { countAnswers, pageHooked, recordedCalls, recordingStatus, startRecording, stopRecording, unfoldPreview } from './helpers.mjs';
import { ACTIONS, AFTER, BEFORE, DISABLED_TOOLS, EXPECT, LIMITS, MESSAGES, MODEL_OF, RUN } from './tables.mjs';

EXPECT['web-live'] = /WEB LIVE (OK|BLOCKED)/;
// A search and a page read, each in a background tab, take longer than a turn's usual wait.
// The background tabs go in the folded "Agent" group (recorded while it lasts: the group goes with
// its last tab); the page shown to the user stays open, in front.
BEFORE['web-search'] = async (page) => {
  const sw = page.context().serviceWorkers()[0];
  await sw.evaluate(() => {
    globalThis.groupsSeen = new Set();
    globalThis.groupWatch = setInterval(async () => {
      for (const g of await chrome.tabGroups.query({})) globalThis.groupsSeen.add(`${g.title}/${g.color}/${g.collapsed}`);
    }, 100);
  });
};
AFTER['web-search'] = async (page) => {
  await page.getByText(/^WEB /).waitFor({ timeout: 20000 });
  const sw = page.context().serviceWorkers()[0];
  const seen = await sw.evaluate(() => {
    clearInterval(globalThis.groupWatch);
    return [...globalThis.groupsSeen];
  });
  if (!seen.includes('Agent/grey/true')) throw new Error(`tab groups seen: ${seen}`);
  const shown = page.context().pages().find((p) => p.url() === 'http://localhost/article');
  if (!shown) throw new Error('the page was not shown to the user');
  await shown.close();
};
AFTER['web-live'] = (page) => page.getByText(/^WEB LIVE/).waitFor({ timeout: 60000 });
BEFORE['web-live'] = async () => {
  if (!LIVE) throw new Error('run it with E2E_LIVE=1');
};
MESSAGES['history-mention'] = 'Compare with #about-lamps';
EXPECT['history-mention'] = ['MENTION HISTORY OK', 'About lamps'];

// Size limits set in Settings → Limits for a scenario.
// The user tools: the questions card (an option and a text answer), the plan pinned above the box,
// and picking an element on the page while the panel shows a card.
EXPECT['user-ask'] = ['ASK OK', 'Size: M · Anything else?: gift wrap'];
BEFORE['user-ask'] = async (page) => {
  page.waitForSelector('[aria-label="Questions from the model"]').then(async () => {
    const card = page.getByRole('alertdialog', { name: 'Questions from the model' });
    await card.getByRole('radio', { name: /^M/ }).check();
    await card.getByLabel('Anything else?').fill('gift wrap');
    await card.getByRole('button', { name: 'Send answers' }).click();
  }).catch((e) => console.log(`     questions: ${e.message.split('\n')[0]}`));
};
EXPECT['user-plan'] = 'PLAN OK';
// The plan pinned above the message box; its close button takes it away.
AFTER['user-plan'] = async (page) => {
  const plan = page.locator('details.plan');
  const shown = await plan.innerText();
  if (!shown.includes('Plan · 1/3 done') || !shown.includes('Pick the size')) throw new Error(`plan: ${shown}`);
  await plan.getByRole('button', { name: 'Remove the plan' }).click();
  await plan.waitFor({ state: 'detached', timeout: T.short });
};
EXPECT['user-pick'] = ['PICK OK', 'picked button "Buy now"'];
// The click that picked never reached the page.
AFTER['user-pick'] = async (page) => {
  const shop = page.context().pages().find((p) => p.url().includes('/shop.html'));
  if ((await shop.locator('body').innerText()).includes('Cart: 1 item')) throw new Error('the picking click reached the page');
};
BEFORE['user-pick'] = async (page) => {
  page.waitForSelector('[aria-label="Pick an element"]').then(async () => {
    const shop = page.context().pages().find((p) => p.url().includes('/shop.html'));
    // The picker is on the page: its banner, a box of its own beside the body.
    await shop.waitForFunction(() => [...document.documentElement.children].some((e) => e.localName === 'div'), null, { timeout: T.short });
    await shop.getByRole('button', { name: 'Buy now' }).click();
  }).catch((e) => console.log(`     pick: ${e.message.split('\n')[0]}`));
};

// Temporary: the hourglass's conversation is not saved; turning it off starts a new one, saved again.
BEFORE.temporary = async (page) => {
  await page.getByRole('button', { name: 'Temporary conversation' }).click();
  await page.getByText('Temporary conversation: it is not saved in the history.').waitFor({ timeout: T.short });
};
AFTER.temporary = async (page) => {
  await page.getByText(HELLO).waitFor({ timeout: T.medium });
  await page.waitForTimeout(QUIET_MS); // a save would have happened by now
  if ((await stored(page, 'convIndex'))?.length) throw new Error('the temporary conversation was saved');
  if (await page.getByRole('button', { name: 'Float on this page' }).isEnabled()) throw new Error('a temporary conversation can be moved');
  await page.getByRole('button', { name: 'Temporary conversation' }).click();
  if (await page.locator('.msg.user').count()) throw new Error('turning it off did not start a new conversation');
  if (await page.locator('.temporary-note').count()) throw new Error('the note stays');
  await page.getByPlaceholder(/Ask something/).fill('hello again');
  await page.keyboard.press('Enter');
  if (!(await waitFor(async () => (await stored(page, 'convIndex'))?.length === 1, T.medium))) throw new Error('the conversation after it was not saved');
};

// History: the turn is saved; a new conversation starts empty; the saved one is found and goes on;
// opening the panel again goes on with the last one.
AFTER.history = async (page) => {
  await page.getByText(HELLO).waitFor({ timeout: T.medium });
  await page.getByRole('button', { name: 'New conversation' }).click();
  if (await page.locator('.msg.user').count()) throw new Error('the new conversation is not empty');
  await page.getByRole('button', { name: 'Conversation history' }).click();
  const panel = page.getByRole('dialog', { name: 'Conversation history' });
  await panel.getByRole('button', { name: /^hello 1/ }).waitFor({ timeout: T.short });
  // The auto-attach, from the history too: on, and its threshold, saved in the settings.
  await panel.getByRole('button', { name: /^Auto-attach: off/ }).click();
  await panel.getByLabel(/Attach the saved conversations your message matches/).check();
  await panel.getByLabel('Match needed').fill('80');
  await panel.getByRole('button', { name: /^Auto-attach: 80%/ }).waitFor({ timeout: T.short });
  // Stored a moment after it shows: a save reads the stored settings first, in its turn (storage/settings).
  const autoAttach = async () => (await stored(page, 'settings')).history?.autoAttach;
  if (!(await waitFor(async () => (await autoAttach())?.enabled && (await autoAttach())?.threshold === 80, T.short))) throw new Error(`auto-attach settings: ${JSON.stringify(await autoAttach())}`);
  // Pinned: listed apart, first.
  await panel.locator('.history-item', { hasText: 'hello 1' }).hover(); // its buttons show on hover
  await panel.getByRole('button', { name: 'Pin hello 1' }).click();
  await panel.getByText('Pinned', { exact: true }).waitFor({ timeout: T.short });
  await panel.getByLabel('Search conversations').fill('nothing like this');
  await panel.getByText('No conversation matches.').waitFor({ timeout: T.short });
  await panel.getByLabel('Search conversations').fill('"I am the mock"');
  // The snippet shows where it matched, highlighted.
  await panel.locator('.history-snippet mark', { hasText: 'I am the mock' }).waitFor({ timeout: T.short });
  await panel.getByRole('button', { name: /^hello 1/ }).click();
  await page.getByText(HELLO).waitFor({ timeout: T.short });
  if ((await page.locator('.msg.user').innerText()) !== 'hello 1') throw new Error('the saved conversation did not open');
  await page.reload();
  await page.getByText(HELLO).waitFor({ timeout: T.medium });
  // The context meter shows what the last call used, as before.
  if (!/\d(\.\d)?k/.test(await page.getByTitle(/^Context:/).innerText())) throw new Error(`meter: ${await page.getByTitle(/^Context:/).innerText()}`);

  // Deleting, confirmed inside the panel: a real side panel shows no confirm() dialog.
  const dialogs = [];
  const onDialog = (d) => (dialogs.push(d.message()), void d.dismiss());
  page.on('dialog', onDialog);
  await page.evaluate(async () => {
    const meta = (id, title) => ({ id, title, createdAt: Date.now() - 1000, updatedAt: Date.now() - 1000, model: 'mock-model', turns: 1 });
    const extra = [meta('dddddddd-0000-4000-8000-000000000001', 'Delete me one'), meta('dddddddd-0000-4000-8000-000000000002', 'Delete me two'), meta('dddddddd-0000-4000-8000-000000000003', 'Keep me')];
    const { convIndex = [] } = await chrome.storage.local.get('convIndex');
    await chrome.storage.local.set({ convIndex: [...convIndex, ...extra], ...Object.fromEntries(extra.map((c) => [`conv:${c.id}`, { ...c, history: [] }])) });
  });
  await page.getByRole('button', { name: 'Conversation history' }).click();
  const list = page.getByRole('dialog', { name: 'Conversation history' });
  await list.locator('.history-item', { hasText: 'Delete me one' }).hover();
  await list.getByRole('button', { name: 'Delete Delete me one' }).click();
  await list.getByRole('button', { name: 'Cancel' }).click(); // cancelled: still there
  await list.locator('.history-item', { hasText: 'Delete me one' }).hover();
  await list.getByRole('button', { name: 'Delete Delete me one' }).click();
  await list.getByRole('button', { name: 'Confirm: delete Delete me one' }).click();
  await list.getByRole('button', { name: /^Delete me one/ }).waitFor({ state: 'detached', timeout: T.short });
  // Several at once: select them, then delete the selected ones.
  await list.getByRole('button', { name: 'Select' }).click();
  await list.getByLabel('Select Delete me two').check();
  await list.getByLabel('Select Keep me').check();
  await list.getByLabel('Select Keep me').uncheck();
  await list.getByText('1 selected').waitFor({ timeout: T.short });
  await list.getByRole('button', { name: 'Delete selected' }).click();
  await list.getByRole('button', { name: 'Confirm: delete 1 conversation' }).click();
  await list.getByRole('button', { name: /^Delete me two/ }).waitFor({ state: 'detached', timeout: T.short });
  await list.getByRole('button', { name: /^Keep me/ }).waitFor({ timeout: T.short });
  // Select all ticks every listed one.
  await list.getByLabel('Select all').check();
  if (!(await list.getByLabel('Select Keep me').isChecked()) || !(await list.getByLabel('Select hello 1').isChecked())) throw new Error('select all did not tick every conversation');
  await list.getByRole('button', { name: 'Done' }).click();
  page.off('dialog', onDialog);
  if (dialogs.length) throw new Error(`native dialogs shown: ${dialogs.join(' | ')}`);
  const left = (await stored(page, 'convIndex')).map((c) => c.title);
  if (left.includes('Delete me one') || left.includes('Delete me two') || !left.includes('Keep me')) throw new Error(`left after deleting: ${left}`);
};

// Settings → MCP servers: the provider (a LiteLLM-like gateway) is checked, its server ticked, added and
// tested; checked again, it is marked added.
const mcpPanel = (options, name) => options.getByRole('button', { name: `${name}: open` }).click();
BEFORE.mcp = async (page) => {
  const options = await page.context().newPage();
  await options.goto(page.url().replace('sidepanel.html', 'options.html#mcp'));
  await options.getByRole('button', { name: '＋ From a provider…' }).click();
  await options.getByRole('button', { name: 'Check this provider' }).click();
  await options.getByLabel('Add notes', { exact: true }).check();
  await options.getByRole('button', { name: /^Add 1 server/ }).click();
  // Its line: a green dot and how many tools.
  await options.locator('.mcp-server', { hasText: '2 tools' }).waitFor({ timeout: T.max });
  if (!(await options.locator('.status-dot.ok').count())) throw new Error('no green status');
  // From the provider again: marked added, not to be added twice.
  await options.getByRole('button', { name: '＋ From a provider…' }).click();
  await options.getByRole('button', { name: 'Check this provider' }).click();
  await options.locator('.mcp-offered li.added', { hasText: 'notes' }).waitFor({ timeout: T.medium });
  if (!(await options.getByLabel('Add notes', { exact: true }).isDisabled())) throw new Error('an added server can be added again');
  await options.locator('.mcp-from-provider').getByRole('button', { name: 'Close' }).click();
  // Its panel: its tools, and its logs with the test.
  await mcpPanel(options, 'notes');
  await options.locator('.mcp-drawer .mcp-tools summary', { hasText: '2 tools (streamable-http)' }).waitFor({ timeout: T.short });
  if ((await options.locator('.mcp-drawer .mcp-tool-chips code').allInnerTexts()).join() !== 'echo,add_note') throw new Error('the tools are not listed');
  const log = options.getByLabel('Connection logs of notes');
  await log.getByText('2 tools (streamable-http)').first().waitFor({ timeout: T.short });
  if (!(await log.innerText()).includes('test')) throw new Error(`logs: ${await log.innerText()}`);
  await options.close();
  // The empty chat lists the server apart, once it has connected.
  await page.getByLabel('What you can mention').getByRole('row', { name: /notes/ }).waitFor({ timeout: T.long });
};
// The same server, its tools on demand: the model loads them first (tools/load).
BEFORE['mcp-on-demand'] = async (page) => {
  await BEFORE.mcp(page);
  await page.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    settings.mcpServers = settings.mcpServers.map((s) => ({ ...s, onDemand: true }));
    await chrome.storage.local.set({ settings });
  });
};
// With two more servers, the same one under another name and one not reached: one button for them
// all, each server a group, folded as the tools menu's, and the one without tools said apart.
AFTER.mcp = async (page) => {
  // Its headers (the provider's key) are not in storage.local: kept in the secrets for its URL
  // (storage/settings-secrets), as Settings saves them.
  // Its provider too (whose key fills "{{apiKey}}"): read only from there (SEC-8).
  const { url, providerId } = await page.evaluate(async () => (await chrome.storage.local.get('settings')).settings.mcpServers[0]);
  const secrets = await storedSecret(page, 'settings');
  await setSecret(page, 'settings', { ...secrets, mcpServers: { ...secrets?.mcpServers, notes2: { url, providerId, headers: { 'x-litellm-api-key': 'Bearer {{apiKey}}' } } } });
  await page.evaluate(async (HOST) => {
    const { settings } = await chrome.storage.local.get('settings');
    settings.mcpServers.push({ ...settings.mcpServers[0], id: 'notes2', name: 'notes2' }, { id: 'nowhere', name: 'nowhere', url: `http://${HOST}/nowhere/mcp`, enabled: true });
    await chrome.storage.local.set({ settings });
  }, HOST);
  const button = page.getByRole('button', { name: "MCP servers' tools offered to the model" });
  await button.click({ timeout: T.medium });
  await page.getByText('MCP 4/4').waitFor({ timeout: T.long });
  if ((await button.innerText()).trim() !== 'MCP 4/4' || (await button.locator('.chat-icon').count()) !== 2) throw new Error(`MCP button: ${await button.innerText()}`);
  const menu = (await page.locator('.tools-list').last().locator('..').innerText()).replace(/\s+/g, ' ');
  if (!menu.includes('MCP · notes 2/2') || !menu.includes('MCP · notes2 2/2') || menu.includes('mcp.notes.echo') || !menu.includes('No tools from nowhere')) throw new Error(`MCP menu: ${menu.replace(/\s+/g, ' ').slice(0, 300)}`);
};

// A server behind OAuth, added by URL: its test says to sign in; signing in (the provider's page, in
// its own window: its Allow) registers the extension, exchanges the code with PKCE and keeps the
// tokens; tested again, its tools are there, and the chat uses them.
BEFORE['mcp-oauth'] = async (page) => {
  const options = await page.context().newPage();
  await options.goto(page.url().replace('sidepanel.html', 'options.html#mcp'));
  await options.getByRole('button', { name: '＋ By URL' }).click();
  await options.getByLabel(/^Name/).fill('notes');
  await options.getByLabel('URL', { exact: true }).fill(`http://localhost:${PORT}/secure/mcp`);
  await options.getByRole('button', { name: 'Save', exact: true }).click();
  await mcpPanel(options, 'notes');
  const panel = options.locator('.mcp-drawer');
  await panel.getByRole('button', { name: 'Test connection' }).click();
  await panel.getByRole('button', { name: 'Sign in', exact: true }).click({ timeout: T.max });
  const signInPage = await page.context().waitForEvent('page', { predicate: (p) => p.url().includes('/oauth/authorize'), timeout: T.max });
  await signInPage.getByRole('button', { name: 'Allow Browser Agent' }).click();
  await panel.locator('.mcp-tools summary', { hasText: '2 tools (streamable-http)' }).waitFor({ timeout: T.max });
  await panel.getByText('Signed in', { exact: true }).first().waitFor({ timeout: T.short }); // its state (the logs say it too)
  const mcpAuth = await storedSecret(options, 'mcpAuth');
  const kept = Object.values(mcpAuth ?? {})[0];
  if (kept?.tokens?.access_token !== OAUTH.token || kept.client?.client_id !== 'browser-agent-test' || kept.verifier) throw new Error(`kept: ${JSON.stringify(kept)}`);
  if (OAUTH.registered !== 1 || OAUTH.exchanged !== 1) throw new Error(`registered ${OAUTH.registered}, exchanged ${OAUTH.exchanged}`);
  await options.close();
  await page.getByLabel('What you can mention').getByRole('row', { name: /notes/ }).waitFor({ timeout: T.long });
};
// Signed out: the tokens go, and testing it asks to sign in again.
AFTER['mcp-oauth'] = async (page) => {
  const options = await page.context().newPage();
  await options.goto(page.url().replace('sidepanel.html', 'options.html#mcp'));
  await mcpPanel(options, 'notes');
  const panel = options.locator('.mcp-drawer');
  await panel.getByRole('button', { name: 'Sign out' }).click();
  await panel.getByRole('button', { name: 'Sign in', exact: true }).waitFor({ timeout: T.max });
  const mcpAuth = await storedSecret(options, 'mcpAuth');
  await options.close();
  if (Object.values(mcpAuth ?? {})[0]?.tokens) throw new Error('the tokens were kept after signing out');
};

// The empty chat lists what can be mentioned; a click writes it in the box. Gone once chatting.
BEFORE['mentions-help'] = async (page) => {
  // Only the groups show; a group opens to its mentions.
  const help = page.getByLabel('What you can mention');
  await waitFor(async () => (await help.innerText()).includes('Browser'), T.medium); // the tools come once the catalog is read
  const listed = await help.innerText();
  if (!listed.includes('Skills') || !listed.includes('Browser') || listed.includes('$browser.find')) throw new Error(`listed: ${listed.replace(/\s+/g, ' ').slice(0, 300)}`);
  await help.getByRole('row', { name: /Browser/ }).click();
  await help.getByRole('button', { name: '$browser.find', exact: true }).click();
  const box = page.getByPlaceholder(/Ask something/);
  if ((await box.inputValue()) !== '$browser.find') throw new Error(`box: ${await box.inputValue()}`);
};
AFTER['mentions-help'] = async (page) => {
  if (await page.getByLabel('What you can mention').count()) throw new Error('the list stays once chatting');
  // Every text of the mentions and the user tools is in Settings → Prompt preview, the JSON too.
  const options = await page.context().newPage();
  await options.goto(page.url().replace('sidepanel.html', 'options.html#prompt'));
  const preview = await (await unfoldPreview(options)).innerText();
  await options.close();
  const want = ['Skill mention', 'Tool mention', 'The user answered:', 'The user picked', 'Plan shown to the user', 'Asks the user 1 to 4 questions'];
  const missing = want.filter((w) => !preview.includes(w));
  if (missing.length) throw new Error(`prompt preview lacks: ${missing.join(', ')}`);
};
MESSAGES['mentions-help'] = null; // sends what the click wrote

// Typed with the suggestions: "/" lists the skills, "$" the tools; Enter completes.
DISABLED_TOOLS['inline-mentions'] = ['browser.find'];
MESSAGES['inline-mentions'] = null;
BEFORE['inline-mentions'] = async (page) => {
  const box = page.getByPlaceholder(/Ask something/);
  await box.click();
  await page.keyboard.type('/summ');
  await page.getByRole('listbox', { name: 'Skill mentions' }).getByRole('option', { name: /^summarize-page/ }).waitFor({ timeout: T.short });
  await page.keyboard.press('Enter');
  await page.keyboard.type('with $browser.fi');
  await page.getByRole('listbox', { name: 'Tool mentions' }).getByRole('option', { name: /^browser\.find\b/ }).waitFor({ timeout: T.short });
  await page.keyboard.press('Enter');
  if ((await box.inputValue()) !== '/summarize-page with $browser.find ') throw new Error(`completed to: ${await box.inputValue()}`);
  await page.locator('.mention-chips').getByText('browser.find').waitFor({ timeout: T.short });
};
EXPECT['inline-mentions'] = ['INLINE OK', 'summarize-page', 'browser.find'];

Object.assign(LIMITS, { 'limit-cut': { pageBudget: 100 } }); // under its minimum: 500 tokens are used
EXPECT['limit-cut'] = 'CUT OK';
// The cut shows on the context meter and in Layers; Settings → Limits changes a limit.
AFTER['limit-cut'] = async (page) => {
  await page.getByTitle(/^Context: .* cut this turn/).click();
  const details = await page.locator('.context-details').innerText();
  if (!details.includes('Cut this turn') || !details.includes('Page block: cut at 500 of')) throw new Error(`meter: ${details.slice(0, 300)}`);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Show the chat as: Markdown' }).click();
  await page.getByRole('menuitemradio', { name: 'Layers' }).click();
  await page.locator('.messages .layer-chip').first().click();
  const first = page.locator('.messages details.layer.sent').first();
  if (!(await first.locator('.cut-mark').count())) throw new Error('no ✂ in Layers');
  if (mock.markedRequests) throw new Error(`${mock.markedRequests} requests carried marks or cut notes`);
  const options = await page.context().newPage();
  await options.goto(page.url().replace('sidepanel.html', 'options.html#limits'));
  await options.getByRole('tab', { name: /^What the model reads/ }).click(); // its tab in Limits
  await options.locator('.limits-settings').getByLabel('Tool result limit', { exact: true }).fill('5000'); // also at the top of Tools; not "WebMCP tool result limit"
  await waitFor(async () => (await stored(options, 'settings')).limits?.toolResult === 5000, T.short);
  const settings = await stored(options, 'settings');
  await options.close();
  if (settings.limits?.toolResult !== 5000) throw new Error(`stored limits: ${JSON.stringify(settings.limits)}`);
};

// Recorded from the toolbar popup with the default preset (API calls): the shop's calls recorded, a repeated
// one and an analytics-like one left out as they came (only counted), a value hidden in the review, a
// variable renamed in the Make a tool step (the id an answer gave, used by the next call), then attached
// to the message without it (the mock checks what reaches it).
MESSAGES.recording = 'Build a tool that makes these calls';
EXPECT.recording = ['RECORDING OK', `recording · 3 calls · ${HOST}`];
RUN.recording = async ({ page, errors, shop }) => {
  if (await page.locator('.topbar').getByTitle(/^Record the calls/).count()) errors.push('recording: the chat still has a record button');
  await startRecording(page, shop);
  if (await page.locator('.topbar').getByRole('button', { name: 'Stop recording' }).count()) errors.push('recording: the chat still has a Stop button');
  await pageHooked(shop);
  const answered = await countAnswers(page);
  await shop.evaluate(async () => {
    await fetch('/collect?v=1').catch(() => undefined); // analytics-like: left out by API calls
    await fetch('/rec/items?q=platypus');
    const created = await (await fetch('/rec/items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Echidna', password: 'hunter2', note: 'PRIVATE NOTE' }) })).json();
    await fetch(`/rec/items/${created.id}`);
    await new Promise((resolve) => {
      const x = new XMLHttpRequest();
      x.open('GET', '/rec/items?q=noise');
      x.onloadend = resolve;
      x.send();
    });
  });
  if (!(await waitFor(() => answered(4), T.short))) errors.push('recording: the page did not tell its 4 answers');
  // q=noise repeats q=platypus (the same call, other values): API calls keeps the first.
  if (!(await recordedCalls(page, 3))) errors.push(`recording: ${(await recordingStatus(page))?.calls} calls kept`);
  const review = await stopRecording(page, shop);
  const meta = await review.locator('.recording-meta').innerText();
  if (!meta.includes('API calls · 2 left out')) errors.push(`recording: the review says ${meta}`);
  // The ticked calls carry the numbers the model gets; the actions say what each does.
  const numbers = await review.locator('.recording-n').allInnerTexts();
  if (numbers.join(',') !== '#1,#2,#3') errors.push(`recording: the calls are numbered ${numbers}`);
  if (!(await review.getByText('Nothing is sent until you send your message.').count())) errors.push('recording: no word that nothing is sent yet');
  if ((await review.innerText()).includes('q=noise')) errors.push('recording: the repeated call was kept');
  await review.locator('details.recording-call').nth(1).locator('.recording-url').click(); // open the POST
  const pre = review.locator('.recording-body pre', { hasText: 'PRIVATE NOTE' }).first();
  await pre.evaluate((el) => {
    const node = el.firstChild;
    const at = node.textContent.indexOf('PRIVATE NOTE');
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + 'PRIVATE NOTE'.length);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await review.locator('.recording-body', { hasText: 'PRIVATE NOTE' }).first().getByRole('button', { name: 'Hide selected value' }).click();
  const shown = await review.innerText();
  if (shown.includes('PRIVATE NOTE')) errors.push('recording: the value was not hidden');
  const privacy = await review.locator('details[data-section="privacy"] > summary').innerText();
  if (!privacy.includes('1 hidden')) errors.push(`recording: the private values say ${privacy}`);
  if (!shown.includes('"password": "••••"')) errors.push(`recording: the password is not hidden as it came: ${shown.slice(0, 400)}`);
  // What the model gets: the text as it goes, the hidden value as ••••, its size against the limit; no
  // variables, which only Make a tool… sends.
  const model = review.locator('details[data-section="model"]');
  await model.locator('summary').click();
  const preview = await model.locator('pre').innerText();
  if (preview.includes('PRIVATE NOTE') || !preview.includes('"note": "••••"') || preview.includes('Variables,')) errors.push(`recording: the preview shows ${preview.slice(0, 400)}`);
  if (!/ of 30k characters/.test(await model.locator('summary').innerText())) errors.push('recording: no size against the limit');
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/recording-review.png` });
  // Make a tool…: the id the create gave, used by the next call, a variable from that answer, renamed; then back.
  await review.getByRole('button', { name: 'Make a tool…' }).click();
  const step = page.getByRole('dialog', { name: 'Make a tool' });
  const idName = step.getByLabel('Name of 4242');
  if ((await idName.inputValue().catch(() => '')) !== 'itemId') errors.push(`recording: the id's variable is ${await idName.inputValue().catch(() => 'missing')}`);
  if ((await step.getByLabel('Kind of itemId').inputValue().catch(() => '')) !== 'answer') errors.push('recording: the id is not "from an answer"');
  await idName.fill('createdId');
  const stepModel = step.locator('details[data-section="model"]');
  await stepModel.locator('summary').click();
  if (!(await stepModel.locator('pre').innerText()).includes('- createdId = 4242: from the answer of #2 (id); in #3 URL (after items)')) errors.push('recording: the step\'s preview lacks the variable renamed');
  await step.getByRole('button', { name: 'Back', exact: true }).click();
  await review.getByRole('button', { name: /^Attach 3 / }).click();
  await page.getByText(`Recording · 3 calls · ${HOST}`).waitFor({ timeout: T.short }).catch(() => errors.push('recording: no chip by the message box'));
  if (!/ · [\d.]+k? chars/.test(await page.locator('.attachments', { hasText: 'Recording · 3 calls' }).innerText())) errors.push('recording: the chip does not say its size');
};

// "Make a tool…", then its step's "Make the tool": the recording attached with a message asking for the
// tool, left in the message box and sent as it is; the model saves a script tool with the recording's parameter.
MESSAGES['recording-tool'] = null; // what the box holds
ACTIONS['recording-tool'] = { model: 'recording-tool', answer: 'Allow', expect: 'TOOL FROM RECORDING OK' };
RUN['recording-tool'] = async ({ page, errors, shop }) => {
  await startRecording(page, shop);
  await pageHooked(shop);
  const answered = await countAnswers(page);
  await shop.evaluate(() => fetch('/rec/items?q=platypus'));
  await recordedCalls(page, 1);
  await waitFor(() => answered(1), T.short);
  await (await stopRecording(page, shop)).getByRole('button', { name: 'Make a tool…' }).click();
  await page.getByRole('dialog', { name: 'Make a tool' }).getByRole('button', { name: 'Make the tool' }).click();
  const box = await page.getByPlaceholder(/Ask something/).inputValue().catch(() => '');
  if (!box.startsWith('Create a script tool that makes the calls of this recording')) errors.push(`recording tool: the message box has ${JSON.stringify(box.slice(0, 80))}`);
  await page.getByText(`Recording · 1 call · ${HOST}`).waitFor({ timeout: T.short }).catch(() => errors.push('recording tool: no chip by the message box'));
};
AFTER['recording-tool'] = async (page) => {
  const saved = (await stored(page, 'customTools'))?.user?.find((t) => t.name === 'shop.items');
  if (!saved?.script?.includes("request('GET', '/rec/items?q='") || saved.inputs?.[0]?.name !== 'q') throw new Error(`saved: ${JSON.stringify(saved)}`);
};

// The recording goes on in the background: the panel reloaded (as if closed and opened again) while it
// records, the call made meanwhile is kept; the popup's Stop brings the review.
MODEL_OF['recording-background'] = 'basic';
RUN['recording-background'] = async ({ page, errors, shop }) => {
  await startRecording(page, shop, { preset: 'Everything' });
  await page.reload();
  if ((await recordingStatus(page))?.state !== 'recording') errors.push('recording-background: not recording after the panel reloaded');
  await pageHooked(shop);
  await shop.evaluate(() => fetch('/rec/items?q=meanwhile'));
  if (!(await recordedCalls(page, 1))) errors.push(`recording-background: ${(await recordingStatus(page))?.calls} calls kept`);
  const review = await stopRecording(page, shop).catch(() => undefined);
  if (!review) return void errors.push('recording-background: no review');
  if (!(await review.innerText()).includes('q=meanwhile')) errors.push('recording-background: the call made meanwhile is missing');
  await review.getByRole('button', { name: 'Discard' }).click();
};
