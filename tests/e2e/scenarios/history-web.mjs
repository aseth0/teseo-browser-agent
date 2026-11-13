// Saved conversations and web search.
import fs from 'node:fs';
import { AFTER, CONVERSATIONS, DISABLED_TOOLS, EXPECT, MESSAGES, REJECT, TEMPLATES, WEB_SEARCH } from './tables.mjs';

// Text that must NOT be in the model's reply for a scenario.
Object.assign(REJECT, { 'tools-offered': /TOOLS [^ ]*browser__find(?!_)/, markdown: /\*\*|onerror|<img/, 'message-actions': /CONTEXT x/ });
Object.assign(DISABLED_TOOLS, { 'tools-offered': ['browser.find'] });
// Saved conversations present for a scenario: the model searches and reads them, or the user
// attaches one with #.
const LAMPS = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001', title: 'About lamps', createdAt: Date.now() - 86_400_000, updatedAt: Date.now() - 86_400_000,
  site: 'shop.test', model: 'mock-model', turns: 1, tokens: 3200,
  history: [{ role: 'user', parts: [{ type: 'text', text: 'Which lamp is cheapest?' }] }, { role: 'assistant', parts: [{ type: 'text', text: 'The brass lamp is 40 €.' }] }],
};
Object.assign(CONVERSATIONS, { 'history-tools': [LAMPS], 'history-mention': [LAMPS], 'history-auto': [{ ...LAMPS, pinned: true }] });
MESSAGES['history-auto'] = 'which brass lamp was cheapest?';
EXPECT['history-auto'] = ['AUTO OK'];
// Under the message, a quiet pill: what went on its own, listed in its title.
AFTER['history-auto'] = async (page) => {
  const title = await page.locator('.msg-auto-pill').first().getAttribute('title');
  if (!title.includes('Saved conversations that match your message') || !title.includes('• About lamps')) throw new Error(`pill title: ${title}`);
};
EXPECT['history-tools'] = ['HISTORY OK', 'history__search', 'history__read'];

// Web search: the built-in DuckDuckGo template's results view, here for the test server's engine
// (http://localhost/?q=…); the live scenario uses the browser's own engine.
const DDG_RESULTS = fs.readFileSync('templates/duckduckgo-search/TEMPLATE.md', 'utf8').match(/<!-- view: results [^>]*-->\n([\s\S]*?)\n\n<!-- view:/)[1];
const LOCAL_DDG = { id: 'ddg-local', name: 'ddg-local', description: '', matches: ['http://localhost/*'], enabled: true, views: [{ name: 'results', paths: ['/?*q=*'], replacePage: true, body: DDG_RESULTS }] };
TEMPLATES['web-search'] = TEMPLATES['web-blocked'] = TEMPLATES['custom-tool'] = [LOCAL_DDG];
Object.assign(WEB_SEARCH, { 'web-search': { engineUrl: 'http://localhost/?q=%s', results: 1 }, 'custom-tool': { engineUrl: 'http://localhost/?q=%s' }, 'web-blocked': { engineUrl: 'http://localhost/?q=%s&blocked=1' } });
EXPECT['web-search'] = ['WEB OK', 'web__search', 'web__read', 'web__show_user'];
EXPECT['web-blocked'] = 'BLOCKED OK';
