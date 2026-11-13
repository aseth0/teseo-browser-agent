// Chat basics: thinking, site access, the selection, another tab, skills and memory, signing in, the context meter; and removing the last provider.
import { HELLO, PORT, T, waitFor } from '../lib.mjs';
import { AFTER, BEFORE, EXPECT, MEMORY, RUN, SKILLS } from './tables.mjs';

Object.assign(EXPECT, {
  error500: 'chat 500: upstream exploded', // the server's own error, as the chat shows it
  'reasoning-field': ['Thought process', 'so I greet back.', HELLO],
  'page-context': 'CTX OK',
  'selection-chip': 'SELECTION OK',
  'selection-skip': 'NO SELECTION OK',
  'context-persist': 'PERSIST OK',
  'context-unchanged': 'UNCHANGED OK', // the same page on the 2nd message goes as a note (Settings → Compaction → Don't resend)
  'tool-find': /FOUND <untrusted_page_content source="browser\.find">.*button "Buy now" \[ref_\w+\]/,
  'tool-text': 'TEXT OK',
  'tool-structured': 'LD OK',
  'tools-offered': ['TOOLS ', 'browser__click', 'templates__run', 'browser.find'], // browser.find: listed in the dropdown (one less offered: AFTER)
});
// UI steps to run before sending the prompt.
Object.assign(BEFORE, {
  'model-picker': async (page) => {
    await page.getByTitle(/^Model:/).click();
    await page.getByRole('button', { name: 'mock-model', exact: true }).waitFor();
    if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/model-picker-open.png` });
    await page.getByRole('button', { name: 'mock-model', exact: true }).click();
  },
});
EXPECT['model-picker'] = 'PICKED mock-model';
// Thinking level: chosen in the thinking menu (saved for this model) before sending.
const pickThinking = (level) => async (page) => {
  await page.getByRole('button', { name: /^Thinking: Default/ }).click();
  await page.getByRole('menuitemradio', { name: level }).click();
  await page.getByRole('button', { name: new RegExp(`^Thinking: ${level}`) }).waitFor({ timeout: T.short });
};
BEFORE['thinking'] = pickThinking('High');
// A second tab on a site the extension has no permission for ([::1] is not in host_permissions);
// the shop stays the panel's page.
let otherSite;
BEFORE['access-deny'] = async (page) => {
  otherSite = await page.context().newPage();
  await otherSite.goto(`http://[::1]:${PORT}/deals`);
  await page.context().pages().find((p) => p.url().includes('/shop.html'))?.bringToFront();
  await page.bringToFront();
};
AFTER['access-deny'] = async () => otherSite?.close();
BEFORE['thinking-rejected'] = pickThinking('Low');
// Text selected on the shop: its chip beside the host, as soon as the page says it changed; a click
// leaves it out of the next message.
const selectHeading = (skip) => async (page) => {
  const shop = page.context().pages().find((p) => p.url().includes('/shop.html'));
  await shop.evaluate(() => getSelection().selectAllChildren(document.querySelector('h1')));
  const chip = page.locator('.selection-chip');
  await chip.waitFor({ timeout: T.medium });
  const label = await chip.innerText();
  if (label.trim() !== '13' || !(await chip.getAttribute('title')).includes('X1 Headphones')) throw new Error(`selection chip: ${label}`);
  if (!skip) return;
  await chip.click();
  if ((await chip.getAttribute('aria-pressed')) !== 'false') throw new Error('the selection chip is not off after a click');
};
BEFORE['selection-chip'] = selectHeading(false);
BEFORE['selection-skip'] = selectHeading(true);
// Another tab of the same site, in the background; the shop stays the panel's page. (A discarded
// tab cannot be tested here: headless Chromium crashes when a tab Playwright drives is discarded.)
let otherTab;
BEFORE['find-other-tab'] = async (page) => {
  otherTab = await page.context().newPage();
  await otherTab.goto(`http://localhost:${PORT}/deals`);
  await page.context().pages().find((p) => p.url().includes('/shop.html'))?.bringToFront();
  await page.bringToFront();
};
AFTER['find-other-tab'] = async () => otherTab?.close();
EXPECT['thinking'] = 'THINK OK';
EXPECT['skill-values'] = 'VALUES OK';
EXPECT['long-reply'] = 'LAST-LINE-OF-REPLY';
EXPECT['thinking-rejected'] = [HELLO, 'thinking-rejected does not accept the thinking setting: sent without it.'];
EXPECT['options-sync'] = HELLO;
EXPECT['step-limit'] = ['CONTINUED OK after 16 rounds'];
EXPECT['page-template'] = ['TEMPLATE OK', 'test-template · main · 4'];
EXPECT['template-editor'] = ['TEDITOR OK', 'my-template · main · 1'];
EXPECT['skill-catalog'] = 'SKILL OK';
EXPECT['site-skill'] = ['SITE OK', 'test-site'];
EXPECT['skill-editor'] = 'EDITOR OK';
EXPECT['about-user'] = 'ABOUT OK';
EXPECT['memory-prompt'] = ['MEMORY OK']; // and the pill under the message the site's memory went with (AFTER)
EXPECT['memory-settings'] = 'MEMSET OK';
// Memory items present in storage for a scenario (memory/store).
const memoryItem = (id, text, change = {}) => ({ id, enabled: true, text, pinned: false, domains: [], agents: [], source: 'user', createdAt: 1, updatedAt: 1, ...change });
Object.assign(MEMORY, {
  'memory-prompt': [
    memoryItem('m-pin', 'PIN-RULE-7', { pinned: true, updatedAt: 5 }),
    memoryItem('m-site', 'SITE-RULE-9', { domains: ['localhost'], pinned: true, updatedAt: 4 }),
    memoryItem('m-title', 'Site title rule\nSITE-BODY-3', { domains: ['localhost'], updatedAt: 3.5 }),
    memoryItem('m-idx', 'Index rule title\nIndex rule body', { updatedAt: 3 }),
    memoryItem('m-off', 'OFF-RULE', { enabled: false, pinned: true, updatedAt: 2 }),
    memoryItem('m-nobody', 'NOBODY-RULE', { agents: ['nobody'], pinned: true, updatedAt: 1 }),
  ],
  'memory-delete': [memoryItem('m-del', 'Forget me.')],
  'memory-list': [memoryItem('m-a', 'Older rule', { updatedAt: 1 }), memoryItem('m-b', 'Newer rule\nits body', { pinned: true, updatedAt: 2 }), memoryItem('m-c', 'Not for this agent', { agents: ['nobody'] })],
  'memory-stable': [memoryItem('m-pin', 'PIN-A', { pinned: true }), memoryItem('m-idx', 'Kept rule'), memoryItem('m-gone', 'Gone rule')],
});
EXPECT['memory-stable'] = 'STABLE OK';
EXPECT['memory-list'] = 'MEMORY LIST OK';
// User skills present in storage for a scenario.
Object.assign(SKILLS, {
  'skill-values': [{ id: 'v', name: 'test-values', description: 'Reads page values.', matches: ['*://localhost/*'], body: 'Title: {{selector:h1}} · Price: {{schema:@Product:offers.price}} · {{meta:missing}} · Links: {{items:nav a; text=; url=?href; icon=img?src}}', references: [], enabled: true }],
  'site-skill': [{ id: 't', name: 'test-site', description: 'Test site rules.', matches: ['*://localhost/*'], body: 'SITE-RULE-42', references: [], enabled: true }],
  // Its block went with the first turn, which the summary replaces: the fourth message carries it again.
  compaction: [{ id: 't', name: 'test-site', description: 'Test site rules.', matches: ['*://localhost/*'], body: 'SITE-RULE-42', references: [], enabled: true }],
  // Long, so trimming leaves it out of the first turn; it goes again in full with the third.
  'compaction-trim': [{ id: 't', name: 'test-site', description: 'Test site rules.', matches: ['*://localhost/*'], body: `SITE-RULE-77 ${'x'.repeat(600)}`, references: [], enabled: true }],
});
EXPECT['compaction-trim'] = ['TRIMMED OK'];
EXPECT['markdown'] = ['Bold claim', 'first item', 'second item'];
EXPECT.compaction = ['COMPACTED OK', 'Compacted · 2 turns', 'summarized'];
EXPECT['compaction-tool'] = ['COMPACT CALLED', 'TOOL COMPACTED OK'];
EXPECT['image-upload'] = 'IMAGE OK';
EXPECT['web-read'] = 'WEB READ OK';
EXPECT['web-sign-in'] = 'SIGN IN OK';
// The card while its tab waits: shown, signed in there, then read.
BEFORE['web-sign-in'] = async (page) => {
  page.waitForSelector('[aria-label="Sign in"]', { timeout: 15000 }).then(async () => {
    const card = page.getByRole('alertdialog', { name: 'Sign in' });
    await card.getByRole('button', { name: 'Show the tab' }).click();
    const tab = await waitForTab(page, '/private');
    await tab.locator('input[name="user"]').fill('someone');
    await tab.locator('input[name="pass"]').fill('test-password');
    await tab.getByRole('button', { name: 'Sign in' }).click();
    await tab.waitForURL(/\/private$/);
    await tab.getByText('PRIVATE FACT').waitFor();
    await page.bringToFront();
    await card.getByRole('button', { name: 'Done, read it' }).click();
  }).catch((e) => console.log(`     sign-in: ${e.message.split('\n')[0]}`));
};
const waitForTab = async (page, path) => {
  const tab = () => page.context().pages().find((p) => p.url().endsWith(path));
  if (await waitFor(async () => tab(), T.max)) return tab();
  throw new Error(`no tab of ${path}`);
};
EXPECT['context-learned'] = 'maximum context length is 16000 tokens';
EXPECT['repetition-loop'] = ['LOOP TOLD OK'];
EXPECT['context-retry'] = ['The server said the request was too long: sent again, shortened more.', 'RETRY OK'];
// The server reports 2,000 input tokens for a request estimated at about 6,000: corrected ×0.5, the least.
EXPECT['context-usage'] = ['USAGE', '25%', '2,048 / 8,192 tokens (25.0%)', 'Reported by the server', 'Estimates for this model corrected ×0.5 from what the server reported.', 'Sent again with every call', 'Tool definitions', 'Grows with the conversation', 'Page blocks', 'By origin', '↑ 2.0k · ↓ 48 ·'];

RUN['no-provider'] = async ({ page, errors, sw }) => {
  // Removing the last provider, then adding it back: the chat changes view without breaking
  // (its hooks are the same in both, "Rendered fewer hooks" otherwise), then works as before.
  const providers = await sw.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, providers: [] } });
    return settings.providers;
  });
  await page.getByText('Add an OpenAI-compatible provider to start chatting.').waitFor({ timeout: T.short }).catch(() => errors.push('no-provider: the empty chat is not shown'));
  await sw.evaluate(async (providers) => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, providers } });
  }, providers);
  await page.getByPlaceholder(/Ask something/).waitFor({ timeout: T.short }).catch(() => errors.push('no-provider: the chat did not come back'));
};
