// The agent manager: two agents, each with its own agent and tab, at work at once; one waits for you
// and is answered from the page while the other goes on. The side panel's agent stays as it was. Their
// conversations are marked in the history, do not open in the side panel while a row has them, and go
// on in a new row from the page's own History. Reopened, the page lists its rows again, stopped.
// And the chat full-screen in a tab, which reuses the manager's chat mode.
import { HELLO, HOST, PORT, T, stored, waitFor } from '../lib.mjs';
import { AGENT_PROFILES, EXPECT, MODEL_OF, RUN, TURNS } from './tables.mjs';
import { chooseAgent, editedSkillSaved, editSkillOnCard } from './helpers.mjs';

const agentProfile = (id, name, icon, model, tools) => ({ id, enabled: true, name, icon, description: '', instructions: '', providerId: 'env', model, tools, skills: [], templates: [], sites: {}, canAsk: false, canBeAsked: false });
AGENT_PROFILES['agent-manager'] = [
  agentProfile('clicker', 'clicker', '🖱', 'act-click', ['browser.find', 'browser.click']),
  agentProfile('reader', 'reader', '📖', 'manager-slow', []),
];
MODEL_OF['agent-manager'] = 'basic'; // the side panel's own turn, after
EXPECT['agent-manager'] = HELLO;

RUN['agent-manager'] = async ({ page, errors, ctx }) => {
  const deals = await ctx.newPage();
  await deals.goto(`http://localhost:${PORT}/deals`);
  await page.bringToFront();
  const opened = ctx.waitForEvent('page');
  await page.getByRole('button', { name: 'Agents Panel', exact: true }).click();
  const manager = await opened;
  await manager.waitForLoadState();
  const rowOf = (name) => manager.getByRole('listitem').filter({ hasText: name });
  const chat = () => manager.frameLocator('iframe.manager-frame:not([hidden])');

  // A new agent on the tab whose title starts so, as that agent; what the tab list offered.
  const start = async (tabTitle, agent) => {
    await manager.getByRole('button', { name: '+ New agent', exact: true }).click();
    const tabs = manager.getByLabel('Work on tab');
    await waitFor(async () => (await tabs.locator('option').count()) > 0, T.short); // the open tabs are read first
    const offered = await tabs.locator('option').allInnerTexts();
    const pick = offered.find((t) => t.startsWith(tabTitle));
    if (!pick) errors.push(`new agent: no ${tabTitle} tab in ${offered.join(' | ')}`);
    else await tabs.selectOption({ label: pick });
    await manager.getByLabel('Agent', { exact: true }).selectOption({ label: agent });
    await manager.getByRole('button', { name: 'Start', exact: true }).click();
    return offered;
  };
  const say = async (text) => {
    const box = chat().getByPlaceholder(/Ask something/);
    await box.waitFor({ timeout: T.medium });
    await box.fill(text);
    await box.press('Enter');
  };

  const first = await start('Deals', '📖 reader');
  if (first.some((t) => t.startsWith('Agents Panel'))) errors.push('the manager offered its own tab');
  await say('read it');
  const second = await start('Demo Shop', '🖱 clicker');
  if (second.some((t) => t.startsWith('Deals'))) errors.push('the tab of another row was offered again');
  await say('buy it');

  // The clicker waits for you; meanwhile the reader is still at work.
  if (!(await waitFor(async () => (await rowOf('clicker').innerText()).includes('Waiting for you'), T.turn))) errors.push(`clicker not waiting: ${await rowOf('clicker').innerText()}`);
  const reading = await rowOf('reader').innerText();
  if (!/\d+\/15/.test(reading)) errors.push(`reader not working while the other waits: ${reading}`);
  // Answered from the manager, in the clicker's chat (selected: the last one added).
  await chat().getByRole('alertdialog').getByRole('button', { name: 'Allow', exact: true }).click({ timeout: T.medium }).catch(() => errors.push('could not answer the card'));
  await chat().getByText('ACT OK').waitFor({ timeout: T.turn }).catch(() => errors.push('clicker: no ACT OK'));
  await rowOf('reader').getByRole('button').first().click();
  await chat().getByText('SLOW DONE').waitFor({ timeout: T.turn }).catch(() => errors.push('reader: no SLOW DONE'));
  for (const name of ['clicker', 'reader']) {
    if (!(await waitFor(async () => (await rowOf(name).innerText()).includes('Done'), T.medium))) errors.push(`${name} row: ${await rowOf(name).innerText()}`);
  }

  // History: each conversation with its agent; the side panel's agent unchanged.
  const index = (await stored(manager, 'convIndex')) ?? [];
  for (const id of ['clicker', 'reader']) {
    if (!index.some((c) => c.agents?.some((a) => a.id === id))) errors.push(`history: no conversation with ${id}: ${JSON.stringify(index.map((c) => c.agents))}`);
  }
  const settings = await stored(manager, 'settings');
  if (settings.activeAgentId !== undefined) errors.push(`the side panel's agent changed to ${settings.activeAgentId}`);
  const panelAgent = await page.locator('.agent-picker-name').innerText().catch(() => '');
  if (panelAgent !== 'Browser') errors.push(`the side panel shows ${panelAgent}`);
  // Marked as started in the Agents Panel.
  if (!index.every((c) => c.origin === 'manager')) errors.push(`history: not marked as from the Agents Panel: ${JSON.stringify(index.map((c) => [c.title, c.origin]))}`);

  // The side panel's history: a conversation open in a row does not open there; its click shows that row.
  await page.bringToFront();
  await page.getByRole('button', { name: 'Conversation history', exact: true }).click();
  const inPanel = page.locator('.history-item').filter({ hasText: 'read it' });
  if (!(await waitFor(async () => (await inPanel.innerText().catch(() => '')).includes('In the Agents Panel'), T.medium))) errors.push(`panel history: ${await inPanel.innerText().catch(() => 'no "read it"')}`);
  if (!(await inPanel.locator('.history-origin').count())) errors.push('panel history: no mark of the Agents Panel');
  await inPanel.locator('.history-open').click();
  if (!(await waitFor(async () => (await rowOf('reader').getByRole('button').first().getAttribute('aria-current')) === 'true', T.medium))) errors.push('panel history: the reader row was not shown');
  if (await page.getByText('SLOW DONE').count()) errors.push('panel history: opened a conversation a row has open');
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  // The Agents Panel's history: the reader's row removed, its conversation goes on in a new row.
  await manager.bringToFront();
  await rowOf('reader').getByRole('button', { name: 'Remove', exact: true }).click();
  await waitFor(async () => !(await rowOf('reader').count()), T.medium);
  await manager.getByRole('button', { name: 'History', exact: true }).click();
  const inManager = manager.locator('.history-item').filter({ hasText: 'read it' });
  if (!(await waitFor(async () => !(await inManager.innerText().catch(() => 'In the Agents Panel')).includes('In the Agents Panel'), T.medium))) errors.push('manager history: the removed row still holds it');
  await inManager.locator('.history-open').click();
  const tabs = manager.getByLabel('Work on tab');
  await waitFor(async () => (await tabs.locator('option').count()) > 0, T.short);
  const deal = (await tabs.locator('option').allInnerTexts()).find((t) => t.startsWith('Deals'));
  if (deal) await tabs.selectOption({ label: deal });
  if ((await manager.getByLabel('Agent', { exact: true }).inputValue()) !== 'reader') errors.push('continue: not with its own agent');
  await manager.getByRole('button', { name: 'Continue', exact: true }).click();
  await chat().getByText('SLOW DONE').waitFor({ timeout: T.medium }).catch(() => errors.push('continue: the saved conversation did not open'));
  if (!(await waitFor(async () => (await rowOf('reader').innerText().catch(() => '')).includes('read it'), T.medium))) errors.push('continue: no row for it');

  // Reopened, the page lists its rows again, stopped, with no chat; one clicked goes on on its tab.
  await waitFor(async () => (await stored(manager, 'managerRows'))?.length === 2, T.medium);
  await manager.reload();
  for (const name of ['clicker', 'reader']) {
    if (!(await waitFor(async () => (await rowOf(name).innerText().catch(() => '')).includes('Stopped'), T.medium))) errors.push(`reopened: ${name} row: ${await rowOf(name).innerText().catch(() => 'none')}`);
  }
  if (await manager.locator('iframe.manager-frame').count()) errors.push('reopened: a chat loaded before any row was clicked');
  await rowOf('reader').getByRole('button').first().click();
  await chat().getByText('SLOW DONE').waitFor({ timeout: T.medium }).catch(() => errors.push('reopened: the reader row did not go on with its conversation'));
  if (await manager.getByLabel('Work on tab').count()) errors.push('reopened: asked for a tab while its own was open');
  if ((await rowOf('reader').innerText()).includes('Stopped')) errors.push('reopened: the reader row still says Stopped');
  await page.bringToFront();
};

// The Agents Panel's tools: the agent of a row the user started starts another (confirmed on its card),
// in a row under it on a new tab, and waits for its answer; the one it started gets none of the tools.
AGENT_PROFILES['panel-tools'] = [
  { ...agentProfile('boss', 'boss', '🧭', 'panel-boss', []), canAsk: true },
  { ...agentProfile('worker', 'worker', '🔧', 'panel-worker', []), canBeAsked: true },
];
EXPECT['panel-tools'] = /[\s\S]*/;
TURNS['panel-tools'] = 0;

// The boss started on the Deals tab, told `prompt`, and its card for panel.start allowed: the page and its chat.
async function bossAllowed({ page, errors, ctx }, prompt) {
  const deals = await ctx.newPage();
  await deals.goto(`http://localhost:${PORT}/deals`);
  await page.bringToFront();
  const opened = ctx.waitForEvent('page');
  await page.getByRole('button', { name: 'Agents Panel', exact: true }).click();
  const manager = await opened;
  await manager.waitForLoadState();
  const chat = () => manager.frameLocator('iframe.manager-frame:not([hidden])');
  await manager.getByRole('button', { name: '+ New agent', exact: true }).click();
  const tabs = manager.getByLabel('Work on tab');
  await waitFor(async () => (await tabs.locator('option').count()) > 0, T.short);
  const pick = (await tabs.locator('option').allInnerTexts()).find((t) => t.startsWith('Deals'));
  if (pick) await tabs.selectOption({ label: pick });
  await manager.getByLabel('Agent', { exact: true }).selectOption({ label: '🧭 boss' });
  await manager.getByRole('button', { name: 'Start', exact: true }).click();
  const box = chat().getByPlaceholder(/Ask something/);
  await box.waitFor({ timeout: T.medium });
  await box.fill(prompt);
  await box.press('Enter');
  const card = chat().getByRole('alertdialog');
  await card.waitFor({ timeout: T.turn }).catch(() => errors.push('panel.start: no card'));
  if (!(await card.innerText().catch(() => '')).includes('count to three')) errors.push(`panel.start card: ${await card.innerText().catch(() => '')}`);
  await card.getByRole('button', { name: 'Allow', exact: true }).click({ timeout: T.medium }).catch(() => errors.push('panel.start: could not allow'));
  return { manager, chat };
}
const lastAnswer = async (chat) => (await chat().locator('.msg.assistant').last().innerText().catch(() => '')).slice(0, 300);

RUN['panel-tools'] = async ({ page, errors, ctx }) => {
  const { manager, chat } = await bossAllowed({ page, errors, ctx }, 'get it done');
  await chat().getByText('BOSS OK').waitFor({ timeout: T.turn }).catch(async () => errors.push(`boss: ${await lastAnswer(chat)}`));
  // Told by panel.wait: no notice after it (manager/notices GRACE_MS is 3 s).
  await manager.waitForTimeout(4500);
  if (await chat().locator('.msg-event').count()) errors.push('a notice came after panel.wait told the answer');
  const worker = manager.getByRole('listitem').filter({ hasText: 'worker' });
  // Its title is its task, not what the model got; the tree's line joins it to the boss.
  const workerText = await worker.innerText().catch(() => 'none');
  if (!workerText.startsWith('count to three') || workerText.includes('The agent')) errors.push(`worker row: ${workerText}`);
  if ((await worker.locator('.manager-row-main').getAttribute('title').catch(() => '')) !== 'Started by 🧭 boss') errors.push('worker row: no "Started by 🧭 boss"');
  const tree = await manager.locator('.manager-row').evaluateAll((rows) => rows.map((r) => [...r.classList].find((c) => c.startsWith('tree-')) ?? ''));
  if (JSON.stringify(tree) !== '["tree-parent","tree-last"]') errors.push(`tree: ${JSON.stringify(tree)}`);
  await worker.getByRole('button').first().click({ timeout: T.medium }).catch(() => errors.push('no worker row to click'));
  await chat().getByText('WORKER DONE').waitFor({ timeout: T.medium }).catch(() => errors.push('worker: its chat has no WORKER DONE'));
  await page.bringToFront();
};

// A boss that does not wait (it ends its turn once the worker is started) is told when the worker has
// answered, and goes on by itself; its chat shows a line, the model the answer.
AGENT_PROFILES['panel-notice'] = AGENT_PROFILES['panel-tools'].map((a) => (a.id === 'boss' ? { ...a, model: 'panel-boss-async' } : a));
EXPECT['panel-notice'] = /[\s\S]*/;
TURNS['panel-notice'] = 0;

RUN['panel-notice'] = async ({ page, errors, ctx }) => {
  const { chat } = await bossAllowed({ page, errors, ctx }, 'start it and go');
  await chat().getByText('BOSS STARTED').waitFor({ timeout: T.turn }).catch(async () => errors.push(`boss start: ${await lastAnswer(chat)}`));
  await chat().getByText('NOTICED OK').waitFor({ timeout: T.turn }).catch(async () => errors.push(`boss notice: ${await lastAnswer(chat)}`));
  // A muted line, not a message of the user's, naming the row by its title (the worker's task), never by its id.
  const line = chat().locator('.msg-event', { hasText: 'answered' });
  const lineText = (await line.first().innerText({ timeout: T.medium }).catch(() => '')).trim();
  if (!lineText) errors.push('notice: its line is not in the chat');
  else if (!/^↳ worker · .+ answered$/.test(lineText) || lineText.includes('(row ')) errors.push(`notice line: ${lineText}`);
  if (await chat().locator('.msg.user', { hasText: 'answered' }).count()) errors.push('notice: drawn as a message of the user');
  await page.bringToFront();
};

// The chat full-screen in a tab (sidepanel.html?full), opened from the side panel's top bar: it works
// on the last web tab, keeps history but has no pin or move, and its agent is its own. The button
// again brings that tab to the front instead of opening another.
AGENT_PROFILES['fullscreen-chat'] = [agentProfile('reader', 'reader', '📖', 'basic', [])];
MODEL_OF['fullscreen-chat'] = 'basic';
EXPECT['fullscreen-chat'] = HELLO;

RUN['fullscreen-chat'] = async ({ page, errors, ctx, shop }) => {
  await shop.bringToFront();
  const opened = ctx.waitForEvent('page');
  await page.getByRole('button', { name: 'Open in a tab', exact: true }).click();
  const full = await opened;
  await full.waitForLoadState();
  await full.locator('.app.full').waitFor({ timeout: T.medium }).catch(() => errors.push('no full-screen chat'));
  if (!(await waitFor(async () => (await full.locator('.pagebar .host').innerText().catch(() => '')) === HOST, T.medium))) {
    errors.push(`full: works on ${await full.locator('.pagebar .host').innerText().catch(() => '?')}`);
  }
  for (const name of ['Follow me across tabs', 'Float on this page', 'Agents Panel', 'Open in a tab']) {
    if (await full.getByRole('button', { name, exact: true }).count()) errors.push(`full: shows ${name}`);
  }
  if (!(await full.getByRole('button', { name: 'Conversation history', exact: true }).count())) errors.push('full: no history button');

  await chooseAgent(full, 'reader');
  const box = full.getByPlaceholder(/Ask something/);
  await box.fill('hello');
  await box.press('Enter');
  await full.getByText(HELLO).waitFor({ timeout: T.turn }).catch(() => errors.push('full: no answer'));
  const settings = await stored(full, 'settings');
  if (settings.activeAgentId !== undefined) errors.push(`the side panel's agent changed to ${settings.activeAgentId}`);

  const another = ctx.waitForEvent('page', { timeout: 1000 }).then(() => true, () => false);
  await page.getByRole('button', { name: 'Open in a tab', exact: true }).click();
  if (await another) errors.push('the button opened a second tab');
  await full.close();
  await page.bringToFront();
};

// A save edited on its card in the full-screen chat too (helpers editSkillOnCard); the side panel sends nothing.
TURNS['skill-edit-full'] = 0;
EXPECT['skill-edit-full'] = /[\s\S]*/;

RUN['skill-edit-full'] = async ({ page, errors, ctx, shop }) => {
  await shop.bringToFront();
  const opened = ctx.waitForEvent('page');
  await page.getByRole('button', { name: 'Open in a tab', exact: true }).click();
  const full = await opened;
  await full.waitForLoadState();
  const box = full.getByPlaceholder(/Ask something/);
  await box.fill('save a skill');
  await box.press('Enter');
  await full.getByRole('alertdialog').waitFor({ timeout: T.medium }).catch(() => errors.push('full: no confirmation card'));
  await editSkillOnCard(full).catch((e) => errors.push(`full card: ${e.message.split('\n')[0]}`));
  await full.getByText('EDIT SAVE OK').waitFor({ timeout: T.turn }).catch(() => errors.push('full: no EDIT SAVE OK'));
  await editedSkillSaved(full).catch((e) => errors.push(`full: ${e.message.split('\n')[0]}`));
  await full.close();
  await page.bringToFront();
};
