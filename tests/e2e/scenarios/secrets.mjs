// The secrets (providers' keys, MCP sign-ins) are out of a content script's reach: neither in
// storage.local nor in what its onChanged tells, also once the key is changed in Options; the
// chat still sends the key.
import { PORT, stored, storedSecret, T, waitFor } from '../lib.mjs';
import { mock } from '../mock/state.mjs';
import { CHECK, CUSTOM_TOOLS, PAGE_ACTIONS, RUN } from './tables.mjs';

const WRITTEN = 'sk-e2e-written-key'; // by a content script
const TYPED = 'sk-e2e-typed-key';
// The page widget (a content script) on the article, as in page-widget.
PAGE_ACTIONS['secrets-isolated'] = [{ id: 'items', enabled: true, name: 'Search items', where: ['http://localhost/article'], input: 'text', tool: 'api.search', args: { query: '{input}' }, outputs: [{ label: 'Items', from: '[]' }] }];
CUSTOM_TOOLS['secrets-isolated'] = CUSTOM_TOOLS['custom-http'];

// The extension's isolated world in a page (its content scripts'), through the DevTools protocol.
async function contentScriptWorld(page, extId) {
  const cdp = await page.context().newCDPSession(page);
  const worlds = [];
  cdp.on('Runtime.executionContextCreated', ({ context }) => worlds.push(context));
  await cdp.send('Runtime.enable');
  const ours = () => worlds.find((c) => c.auxData?.type === 'isolated' && c.origin.includes(extId));
  await waitFor(async () => ours(), T.medium);
  if (!ours()) throw new Error(`no content script world: ${JSON.stringify(worlds.map((c) => [c.name, c.origin, c.auxData?.type]))}`);
  return async (expression) => {
    const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, contextId: ours().id, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };
}

const envKey = (secrets) => secrets?.providers?.['env']?.apiKey;

RUN['secrets-isolated'] = async ({ page, errors, ctx, extId, sw }) => {
  // A key written to storage.local (a content script's): removed unread, never taken.
  await sw.evaluate(async (key) => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, providers: settings.providers.map((p) => ({ ...p, apiKey: key })) } });
  }, WRITTEN);
  if (!(await waitFor(async () => !JSON.stringify(await stored(sw, 'settings')).includes(WRITTEN)))) errors.push('the key written there was left in storage.local');
  if (envKey(await storedSecret(page, 'settings')) !== 'x') errors.push('the key written there was taken into the secrets');

  // The widget on the article; what its world sees from now on.
  const article = await ctx.newPage();
  await article.goto(`http://localhost:${PORT}/article`);
  const inWidget = await contentScriptWorld(article, extId);
  await inWidget(`globalThis.__seen = []; chrome.storage.onChanged.addListener((c, area) => __seen.push([area, c])); true`);

  // The key typed in Options.
  const options = await ctx.newPage();
  await options.goto(`chrome-extension://${extId}/options.html#providers`);
  await options.locator('.provider-pane').getByLabel('API key').fill(TYPED); // the chat's provider, shown first
  if (!(await waitFor(async () => envKey(await storedSecret(options, 'settings')) === TYPED))) errors.push('the typed key was not saved to the secrets');
  await options.close();

  const seen = await inWidget(`(async () => JSON.stringify([await chrome.storage.local.get(null), __seen]))()`);
  if (!seen.includes('secretsRev')) errors.push('the content script was not told of the change at all (the check would prove nothing)');
  for (const key of [WRITTEN, TYPED]) if (seen.includes(key)) errors.push(`a content script can read the key ${key}`);
  // Its indexedDB is the page's: the extension's secrets are not there.
  const pageDbs = await inWidget(`indexedDB.databases().then((d) => d.map((x) => x.name))`);
  if (pageDbs.includes('browser-agent')) errors.push(`the page's indexedDB has the secrets database: ${pageDbs}`);
  await article.close();
};
// The chat still sends the key typed.
CHECK['secrets-isolated'] = async ({ errors }) => {
  if (mock.lastAuthorization !== `Bearer ${TYPED}`) errors.push(`the model got ${mock.lastAuthorization}`);
};
