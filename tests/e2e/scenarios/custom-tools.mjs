// Custom tools: derived, HTTP, session and CSRF, sources, scripts; site access.
import { PORT, stored, storedSecret, T, waitFor } from '../lib.mjs';
import { leaks, mock, teamTool } from '../mock/state.mjs';
import { recordClipboard } from './helpers.mjs';
import { AFTER, BEFORE, CUSTOM_TOOLS, DISABLED_TOOLS, EXPECT, PAGES } from './tables.mjs';

// Custom tools: made from web.search, offered as their own, edited in Settings → Custom tools.
Object.assign(CUSTOM_TOOLS, {
  'custom-tool': [{
    id: 'reddit', enabled: true, name: 'reddit.search', description: 'Searches Reddit threads.', base: 'web.search',
    params: { query: { mode: 'model', template: '{value} site:reddit.com' }, limit: { mode: 'fixed', value: 1 } },
  }, {
    id: 'local', enabled: true, name: 'local.read', description: 'Reads a page of the test site by its name.', base: 'web.read',
    inputs: [{ name: 'page', type: 'string', description: 'The page name, e.g. article', required: true }],
    params: { url: { mode: 'built', template: 'http://localhost/{page}' } },
  }],
});
// Saved by the model once the user allows it, marked as the model's.
AFTER['custom-save'] = async (page) => {
  const customTools = await stored(page, 'customTools');
  const saved = customTools?.user?.[0];
  const ok = saved?.name === 'wiki.read' && saved.createdBy === 'model' && saved.inputs?.map((i) => i.name).join() === 'title,lang' &&
    saved.params.url.mode === 'built' && saved.params.url.template === 'https://{lang}.wikipedia.org/wiki/{title}';
  if (!ok) throw new Error(`saved: ${JSON.stringify(customTools)}`);
};
// HTTP requests: the key only in the header, never offered to the model.
const API = { base: 'http', params: {}, enabled: true };
CUSTOM_TOOLS['custom-http'] = [{
  ...API, id: 'search', name: 'api.search', description: 'Searches the items API.',
  inputs: [{ name: 'query', type: 'string', description: 'Words', required: true }],
  http: { method: 'GET', url: 'http://localhost/api/items?q={query}', headers: [{ name: 'X-Key', value: 'KEY-VALUE-42' }], extract: 'items[].title' },
}];
// Read, changed and deleted by the model (custom_tools.read, edit, delete), the user allowing each change.
CUSTOM_TOOLS['custom-edit'] = CUSTOM_TOOLS['custom-http'];
AFTER['custom-edit'] = async (page) => {
  const customTools = await stored(page, 'customTools');
  if (customTools?.user?.length) throw new Error(`not deleted: ${JSON.stringify(customTools)}`);
};
CUSTOM_TOOLS['custom-http-post'] = [{
  ...API, id: 'add', name: 'api.add', description: 'Adds an item.',
  inputs: [{ name: 'name', type: 'string', description: 'Its name', required: true }],
  http: { method: 'POST', url: 'http://localhost/api/items', body: '{"name": {name}}', headers: [{ name: 'X-Key', value: 'KEY-VALUE-42' }] },
}];
EXPECT['custom-http'] = ['HTTP OK', 'api__search'];
// Try in the editor: the request as edited, with a typed value, and what the model would get.
const tryInEditor = async (page, tool, values, expected, status = '✓ 200') => {
  await page.getByText(/^(HTTP|SESSION) /).waitFor({ timeout: 30000 });
  const options = await page.context().newPage();
  await options.goto(page.url().replace('sidepanel.html', 'options.html#custom-tools'));
  await options.getByRole('button', { name: new RegExp(`^${tool.replace('.', '\\.')}`) }).click();
  await options.getByRole('button', { name: 'Change: Try it' }).click(); // its steps open folded
  for (const [name, value] of Object.entries(values)) await options.getByLabel(`Try value of ${name}`).fill(value);
  await options.getByRole('button', { name: 'Try', exact: true }).click();
  const shown = options.locator('.custom-try pre');
  await shown.waitFor({ timeout: T.medium });
  const text = await shown.innerText();
  if (!expected.every((e) => text.includes(e))) throw new Error(`try: ${text.slice(0, 200)}`);
  const badge = await options.locator('.try-status').innerText();
  if (!badge.includes(status)) throw new Error(`try status: ${badge}`);
  await options.close();
};
AFTER['custom-http'] = (page) => tryInEditor(page, 'api.search', { query: 'platypus' }, ['status="200"', 'Platypus fact']);
// The browser's session: only the tool the user ticked it on sends the site's cookie.
const ME = { ...API, inputs: [], description: 'Who am I.' };
CUSTOM_TOOLS['custom-session'] = [
  { ...ME, id: 'signed', name: 'me.signed', http: { method: 'GET', url: 'http://localhost/api/me', session: true } },
  { ...ME, id: 'anonymous', name: 'me.anonymous', http: { method: 'GET', url: 'http://localhost/api/me' } },
];
BEFORE['custom-try'] = (page) => page.context().addCookies([{ name: 'session', value: 'abc', domain: 'localhost', path: '/' }]);
// Saved only once tried right.
AFTER['custom-try'] = async (page) => {
  const saved = (await stored(page, 'customTools'))?.user ?? [];
  if (saved.map((t) => t.name).join() !== 'me.who' || saved[0].http.extract !== 'username') throw new Error(`saved: ${JSON.stringify(saved)}`);
};
BEFORE['custom-session'] = (page) => page.context().addCookies([{ name: 'session', value: 'abc', domain: 'localhost', path: '/' }]);
EXPECT['custom-session'] = ['SESSION OK'];
// A POST with the session that only reads (no card), and the CSRF header from a cookie of its site.
const MM_SEARCH = { method: 'POST', url: 'http://localhost/api/channels/search', body: '{"term": "INC-42"}', session: true, readOnly: true };
CUSTOM_TOOLS['custom-csrf'] = [
  { ...ME, id: 'mm', name: 'mm.search', http: { ...MM_SEARCH, headers: [{ name: 'X-Requested-With', value: 'XMLHttpRequest' }, { name: 'X-CSRF-Token', value: '{{cookie:MMCSRF}}' }] } },
  { ...ME, id: 'mm2', name: 'mm.no_csrf', http: { ...MM_SEARCH, headers: [{ name: 'X-Requested-With', value: 'XMLHttpRequest' }] } },
];
BEFORE['custom-csrf'] = (page) => page.context().addCookies([{ name: 'session', value: 'abc', domain: 'localhost', path: '/' }, { name: 'MMCSRF', value: 'csrf-1', domain: 'localhost', path: '/' }]);
EXPECT['custom-csrf'] = ['CSRF OK'];
// Custom tools from a source (Settings → Custom tools → Sources), read with the session and a token:
// new ones come off; the key the user sets stays across syncs; one that changes its request is
// switched off until checked; one no longer in the source goes.
// A row's checkbox shows the stored state: on once it is saved.
const switchOn = async (row) => {
  const box = row.locator('input[type=checkbox]');
  await box.click();
  await row.page().waitForFunction((el) => el.checked, await box.elementHandle(), { timeout: T.medium });
};
// When the source was last synced (0: never). A sync stores it last, once its tools are saved.
const syncedAt = async (page) => {
  const sources = await stored(page, 'customToolSources');
  return (sources?.user ?? sources ?? [])[0]?.syncedAt ?? 0;
};
// A sync started (by a click, or by saving the source) is over: stored after `since`, and its row
// shows Sync again with the sync's report. Only then is it checked, or the mock changed.
const synced = async (page, since) => {
  const source = page.locator('.source-row');
  const done = await waitFor(async () => (await syncedAt(page)) > since && (await source.getByRole('button', { name: 'Sync', exact: true }).isEnabled()), T.long);
  if (!done) throw new Error(`the sync did not end: ${await source.innerText()}`);
};
// A tab of Settings → Custom tools: the list (Tools) or Sources.
const toTab = (page, name) => page.getByRole('tab', { name: new RegExp(`^${name}`) }).click();
// Sync now, from its row in Sources, and wait for it to end; back on the list after.
const syncAgain = async (page) => {
  const since = await syncedAt(page);
  await toTab(page, 'Sources');
  await page.locator('.source-row').getByRole('button', { name: 'Sync', exact: true }).click();
  await synced(page, since);
  await toTab(page, 'Tools');
};
BEFORE['custom-sources'] = async (page) => {
  await page.context().addCookies([{ name: 'session', value: 'abc', domain: 'localhost', path: '/' }]);
  const options = await page.context().newPage();
  await options.goto(page.url().replace('sidepanel.html', 'options.html#custom-tools'));
  await toTab(options, 'Sources');
  await options.getByRole('button', { name: '＋ Add a source' }).click();
  await options.getByLabel('Source URL').fill(`http://localhost:${PORT}/tools/team.json`);
  await options.getByRole('button', { name: '＋ Add a header' }).click();
  await options.getByLabel('Header name').fill('X-Token');
  await options.getByLabel('Value of X-Token').fill('t-1');
  await options.getByLabel("Send the browser's session for this site").check();
  await options.getByRole('button', { name: 'Save and sync' }).click();
  await synced(options, 0);
  const source = options.locator('.source-row');
  // Its report, shown as the sync ends.
  await source.getByText('New, off until you switch them on: team.search.').waitFor({ timeout: T.short }).catch(() => undefined);
  if (!(await source.innerText()).includes('New, off until you switch them on: team.search.')) throw new Error(`first sync: ${await source.innerText()}`);
  await toTab(options, 'Tools');
  const row = options.locator('.collection-table tr', { hasText: 'team.search' });
  await row.waitFor({ timeout: T.medium });
  if (await row.locator('input[type=checkbox]').isChecked()) throw new Error('a new tool came on');
  if (!(await row.innerText()).includes(`from localhost:${PORT}`)) throw new Error(`no source label: ${await row.innerText()}`);
  // The user's key, set in the tool; then on.
  await row.getByRole('button').click();
  if (!(await options.locator('.editor').innerText()).includes('its next sync replaces what you change here')) throw new Error('the editor does not say it comes from a source');
  await options.getByRole('button', { name: 'Change: The request' }).click(); // its steps open folded
  await options.getByLabel('Value of X-Key').fill('KEY-VALUE-42');
  await options.getByRole('button', { name: 'Save', exact: true }).click();
  await switchOn(row);
  // Synced again, the same: still on, with the key.
  await syncAgain(options);
  if (!(await row.locator('input[type=checkbox]').isChecked())) throw new Error('an unchanged tool was switched off');
  // Another request: off and marked, until switched on again.
  mock.teamTools = [teamTool('http://localhost/api/items?q={query}&v=2')];
  await syncAgain(options);
  await row.getByText('changed', { exact: true }).waitFor({ timeout: T.medium });
  if (await row.locator('input[type=checkbox]').isChecked()) throw new Error('a changed tool stayed on');
  await switchOn(row);
  await row.getByText('changed', { exact: true }).waitFor({ state: 'detached', timeout: T.short });
  const customTools = await stored(options, 'customTools');
  const saved = customTools.user.find((t) => t.name === 'team.search');
  // The key's value kept apart from it, where no content script reads it (tools/custom/store).
  const kept = (await storedSecret(options, 'customToolSecrets'))?.[saved.id];
  if (saved.http.headers[0].value !== '' || kept?.headers?.[0]?.value !== 'KEY-VALUE-42' || !saved.http.url.endsWith('&v=2')) throw new Error(`stored: ${JSON.stringify(saved.http)} ${JSON.stringify(kept)}`);
  // In Settings, by group: the user's own (none), then the source's.
  const titles = (await options.locator('.custom-group-title').allInnerTexts()).map((t) => t.toLowerCase());
  if (titles.join() !== 'no group,team api') throw new Error(`sections: ${titles}`);
  await options.close();
};
EXPECT['custom-sources'] = ['SOURCES OK'];
CUSTOM_TOOLS['custom-sources'] = CUSTOM_TOOLS['custom-http']; // one of the user's, in no group
AFTER['custom-sources'] = async (page) => {
  // Its group: a section of its own in the tools menu, and in Settings.
  await page.getByTitle(/^Tools offered to the model/).click();
  const menu = page.locator('.tools-list');
  await menu.waitFor({ timeout: T.short });
  if (!(await menu.innerText()).includes('Team API')) throw new Error(`no group in the tools menu: ${(await menu.innerText()).replace(/\s+/g, ' ').slice(0, 400)}`);
  await menu.getByRole('button', { name: /Team API/ }).click();
  if (!(await menu.innerText()).includes('team.search')) throw new Error(`tools menu: ${(await menu.innerText()).slice(0, 300)}`);
  await page.keyboard.press('Escape');
  mock.teamTools = [];
  const options = await page.context().newPage();
  await options.goto(page.url().replace('sidepanel.html', 'options.html#custom-tools')); // synced as it opens
  await toTab(options, 'Sources');
  await options.locator('.source-row', { hasText: 'No longer in it, removed: team.search.' }).waitFor({ timeout: T.long });
  await toTab(options, 'Tools');
  if (await options.locator('.collection-table tr', { hasText: 'team.search' }).count()) throw new Error('a tool no longer in its source stayed');
  await options.close();
};
// A script tool: a search across every team, run in the script engine (script/quickjs) in the background, its
// requests made with the tool's session and CSRF header; and a script that tries to get out.
// Its parameters are names of their own too: term, and team, not given (null).
const MM_FIND = `if (team !== null) throw new Error('team should be null, not ' + team);
const { data: teams } = await request('GET', '/mm/api/v4/users/me/teams');
const found = new Map();
await Promise.all(teams.map(async (team) => {
  const [mine, open] = await Promise.all([
    request('GET', '/mm/api/v4/teams/' + team.id + '/channels/search_autocomplete?name=' + encodeURIComponent(term)),
    request('POST', '/mm/api/v4/teams/' + team.id + '/channels/search', { term: input.term }),
  ]);
  for (const c of [...mine.data, ...open.data]) if (!c.delete_at) found.set(c.id, { name: c.display_name, team: team.display_name, last: c.last_post_at });
}));
return [...found.values()].sort((a, b) => b.last - a.last);`;
const LEAK = `const out = [];
try { await fetch('http://127.0.0.1:${PORT}/leak-fetch'); out.push('fetched'); } catch { out.push('fetch blocked'); }
try { await request('GET', 'http://127.0.0.1:${PORT}/leak-request'); out.push('requested'); } catch { out.push('request refused'); }
try { new Image().src = 'http://127.0.0.1:${PORT}/leak-image'; out.push('image'); } catch { out.push('no image'); }
try { await new Promise((r) => setTimeout(r, 500)); out.push('waited'); } catch { out.push('no timers'); }
return out.join(', ');`;
const LEAK_NAV = `location.href = 'http://127.0.0.1:${PORT}/leak-nav?x=1';
await new Promise((r) => setTimeout(r, 2000));
return 'still here';`;
const SCRIPT_ACCESS = { method: 'GET', url: 'http://localhost', session: true, readOnly: true, headers: [{ name: 'X-CSRF-Token', value: '{{cookie:MMCSRF}}' }] };
CUSTOM_TOOLS['script-tool'] = [
  { ...API, base: 'script', id: 'mmf', name: 'mm.find_all', description: 'Finds channels in every team.', inputs: [{ name: 'term', type: 'string', description: 'Words', required: true }, { name: 'team', type: 'string', description: 'A team' }], http: SCRIPT_ACCESS, script: MM_FIND },
  { ...API, base: 'script', id: 'leak', name: 'leak.try', description: 'Tries to get out.', inputs: [], http: SCRIPT_ACCESS, script: LEAK },
  { ...API, base: 'script', id: 'leaknav', name: 'leak.navigate', description: 'Tries to navigate out.', inputs: [], http: SCRIPT_ACCESS, script: LEAK_NAV },
  // Does not parse: its error says where (the engine's line and column, script/quickjs).
  { ...API, base: 'script', id: 'broken', name: 'broken.parse', description: 'Does not parse.', inputs: [], http: SCRIPT_ACCESS, script: 'const a = 1;\nconst b = Math.max(a, 2));\nreturn b;' },
  // An input declared again, and a name a script does not have: their errors say what it has.
  { ...API, base: 'script', id: 'declared', name: 'broken.declared', description: 'Declares its input again.', inputs: [{ name: 'query', type: 'string', description: 'Words', required: true }], http: SCRIPT_ACCESS, script: 'const query = String(input.query);\nreturn query;' },
  { ...API, base: 'script', id: 'undefined', name: 'broken.undefined', description: 'Calls what it does not have.', inputs: [], http: SCRIPT_ACCESS, script: "await navigate('https://example.com');\nreturn 1;" },
];
BEFORE['script-tool'] = (page) => page.context().addCookies([{ name: 'session', value: 'abc', domain: 'localhost', path: '/' }, { name: 'MMCSRF', value: 'csrf-1', domain: 'localhost', path: '/' }]);
EXPECT['script-tool'] = ['SCRIPT OK'];
// Tried in the editor, in the script engine in the options page.
AFTER['script-tool'] = async (page) => {
  const options = await page.context().newPage();
  await options.goto(page.url().replace('sidepanel.html', 'options.html#custom-tools'));
  await options.getByRole('button', { name: /^mm\.find_all/ }).click();
  await options.getByRole('button', { name: 'Change: Try it' }).click(); // its steps open folded
  await options.getByLabel('Try value of term').fill('inc-42');
  await options.getByRole('button', { name: 'Try', exact: true }).click();
  const shown = options.locator('.custom-try pre').last(); // what the model would get, after its requests
  await shown.waitFor({ timeout: T.max });
  const text = await shown.innerText();
  const badge = await options.locator('.try-status').innerText();
  const calls = await options.locator('.custom-try pre').first().textContent(); // folded when it worked
  await options.close();
  if (!text.includes('INC-42 dev') || !badge.includes('✓ 5 requests')) throw new Error(`try: ${badge} ${text.slice(0, 200)}`);
  if (!calls.includes('GET /mm/api/v4/users/me/teams → 200') || !calls.includes('POST /mm/api/v4/teams/t2/channels/search → 200')) throw new Error(`its requests: ${calls}`);
  if (leaks.length) throw new Error(`leaked: ${leaks.join(' ')}`);
};
// browser.site_access on a page that calls its API: the cookies' and headers' names, never a value; the
// tool made from them sends the session and the CSRF header from the cookie.
BEFORE['site-access'] = (page) => page.context().addCookies([
  { name: 'session', value: 'abc', domain: 'localhost', path: '/' },
  { name: 'MMCSRF', value: 'csrf-1', domain: 'localhost', path: '/' },
  { name: 'MMAUTHTOKEN', value: 'secret-auth', domain: 'localhost', path: '/', httpOnly: true },
]);
AFTER['site-access'] = async (page) => {
  const customTools = await stored(page, 'customTools');
  const id = customTools?.user?.find((t) => t.name === 'mm.find')?.id;
  // The session and the headers' values kept apart from it (tools/custom/store).
  const kept = (await storedSecret(page, 'customToolSecrets'))?.[id];
  if (!kept?.session || kept.headers?.[1]?.value !== '{{cookie:MMCSRF}}') throw new Error(`saved: ${JSON.stringify(kept)}`);
};
AFTER['custom-session'] = async (page) => {
  await tryInEditor(page, 'me.signed', {}, ['status="200"', 'perry']);
  await tryInEditor(page, 'me.anonymous', {}, ['status="401"'], '✗ 401');
};
EXPECT['custom-tool'] = ['CUSTOM OK', 'reddit__search', 'local__read'];
AFTER['custom-tool'] = async (page) => {
  await page.getByText(/^CUSTOM /).waitFor({ timeout: 30000 });
  const options = await page.context().newPage();
  await options.goto(page.url().replace('sidepanel.html', 'options.html#custom-tools'));
  // A ▾ menu from the keyboard: Enter opens it on its first item, ↓ moves, Escape closes it.
  await options.getByRole('button', { name: 'Import ▾' }).focus();
  await options.keyboard.press('Enter');
  const focused = () => options.evaluate(() => document.activeElement?.textContent?.trim());
  if ((await focused()) !== 'From file…') throw new Error(`menu: opened on ${await focused()}`);
  await options.keyboard.press('ArrowDown');
  if ((await focused()) !== 'Paste JSON…') throw new Error(`menu: ↓ went to ${await focused()}`);
  await options.keyboard.press('Escape');
  await options.getByRole('menu', { name: 'Import' }).waitFor({ state: 'detached', timeout: T.short });
  await options.getByRole('button', { name: /^reddit\.search/ }).click();
  await options.getByText('The whole definition (JSON)').click();
  const offered = await options.locator('.custom-side-card details pre').innerText();
  if (!offered.includes('"reddit__search"') || offered.includes('"limit"')) throw new Error(`editor preview: ${offered.slice(0, 200)}`);
  // Import: pasted JSON and a file; they come in off.
  await options.getByRole('button', { name: 'Cancel' }).click();
  const tool = (name) => ({ name, description: 'Imported.', base: 'web.read', params: {} });
  await options.getByRole('button', { name: 'Import ▾' }).click();
  await options.getByRole('menuitem', { name: 'Paste JSON…' }).click();
  await options.locator('.paste-json textarea').fill(JSON.stringify({ customTools: [tool('pasted.read')] }));
  await options.locator('.paste-json').getByRole('button', { name: 'Import', exact: true }).click();
  await options.locator('.import-preview').getByRole('button', { name: /^Import \d/ }).click();
  await options.getByText(/^Imported pasted\.read/).waitFor({ timeout: T.short });
  await options.getByRole('button', { name: 'Import ▾' }).click();
  const [chooser] = await Promise.all([options.waitForEvent('filechooser'), options.getByRole('menuitem', { name: 'From file…' }).click()]);
  await chooser.setFiles({ name: 'tools.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify([tool('filed.read')])) });
  await options.locator('.import-preview').getByRole('button', { name: /^Import \d/ }).click();
  await options.getByText(/^Imported filed\.read/).waitFor({ timeout: T.short });
  // Export to JSON: all of them, copied.
  const copied = await recordClipboard(options);
  await options.getByRole('button', { name: 'Export ▾' }).click();
  await options.getByRole('menuitem', { name: /^Copy all as JSON/ }).click();
  const exported = (await copied()).at(-1)?.plain ?? '';
  if (!['reddit.search', 'local.read', 'pasted.read', 'filed.read'].every((n) => exported.includes(`"${n}"`))) throw new Error(`exported: ${exported.slice(0, 200)}`);
  for (const name of ['pasted.read', 'filed.read']) {
    const row = options.locator('.collection-table tr', { hasText: name });
    if (await row.locator('input[type=checkbox]').isChecked()) throw new Error(`${name} was imported on`);
  }
  await options.close();
};

// A script that calls tools (tools/custom/script-tool's tool()): its tools switched off for the model, still called
// by it; only the step with report and its note reach the model; a tool outside its uses is refused;
// every step shows under its call.
const STEPS = `const waited = await tool('browser.wait_for', { stableMs: 300, timeoutSec: 5 }, { report: true });
const found = await tool('browser.find', { query: 'button product' });
note('Found ' + (found.data?.length ?? 0) + ' buttons');
const outside = await tool('browser.click', { ref: 'ref_1' }).then(() => 'ran', (e) => 'refused: ' + e.message);
return { waited: waited.ok, first: found.data?.[0]?.ref ? found.data[0].line : 'none', outside };`;
CUSTOM_TOOLS['script-steps'] = [{
  ...API, base: 'script', id: 'steps', name: 'steps.check', description: 'Checks the page in steps.', inputs: [],
  http: { method: 'GET', url: '' }, uses: ['browser.wait_for', 'browser.find'], script: STEPS,
}];
DISABLED_TOOLS['script-steps'] = ['browser.wait_for', 'browser.find'];
PAGES['script-steps'] = '/big.html';
EXPECT['script-steps'] = ['STEPS OK'];
AFTER['script-steps'] = async (page) => {
  const inside = await page.locator('.sub-agent').first().textContent();
  if (!inside.includes('steps.check') || !inside.includes('browser.wait_for') || !inside.includes('browser.find') || !inside.includes('Found 20 buttons')) {
    throw new Error(`its steps, under its call: ${inside}`);
  }
};
