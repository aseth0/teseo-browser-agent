// What the e2e's parts share: the mock server's port, how long to wait, and small helpers.
import fs from 'node:fs';

// The command line: [scenario,scenario…] [--port N]. Runs side by side need ports of their own.
const argv = process.argv.slice(2);
const portAt = argv.indexOf('--port');
export const PORT = portAt >= 0 ? Number(argv[portAt + 1]) : 8787;
if (!Number.isInteger(PORT) || PORT <= 0) throw new Error(`--port takes a port number, not ${argv[portAt + 1]}`);
// The scenarios asked for (none: all of them).
export const SCENARIOS = argv.filter((_, i) => portAt < 0 || (i !== portAt && i !== portAt + 1))[0]?.split(',');
// The test site's host as the extension names it (site policies, places, labels).
export const HOST = `localhost:${PORT}`;
// Live scenarios (E2E_LIVE=1, not in the default run): web-live searches the web for real.
export const LIVE = process.env.E2E_LIVE === '1';
// How long to wait for what the extension shows or stores.
export const T = { short: 3000, medium: 5000, long: 8000, max: 10000, turn: 20000 }; // turn: a whole turn, its tools included
// How long a check that something does not happen waits: by then it would have.
export const QUIET_MS = 1000;
// A value the extension stored (chrome.storage.local), read from one of its pages or its worker.
export const stored = (page, key) => page.evaluate(async (k) => (await chrome.storage.local.get(k))[k], key);
// A secret the extension keeps (storage/secrets: its own IndexedDB), read from one of its pages.
// Writes a secret as the extension does (storage/secrets updateSecret): the value, then a new stamp
// that tells its pages and worker.
export const setSecret = (page, name, value) =>
  page.evaluate(
    ({ n, v }) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('browser-agent', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('secrets');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('secrets', 'readwrite');
          tx.objectStore('secrets').put(v, n);
          tx.oncomplete = async () => {
            open.result.close();
            const { secretsRev = {} } = await chrome.storage.local.get('secretsRev');
            await chrome.storage.local.set({ secretsRev: { ...secretsRev, [n]: crypto.randomUUID() } });
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    { n: name, v: value },
  );
export const storedSecret = (page, name) =>
  page.evaluate(
    (n) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('browser-agent', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('secrets');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const get = open.result.transaction('secrets').objectStore('secrets').get(n);
          get.onsuccess = () => (open.result.close(), resolve(get.result));
          get.onerror = () => reject(get.error);
        };
      }),
    name,
  );
// As widget/store: what a page action's secret part is kept for (its reach, with every object's keys sorted).
export const ACTION_REACH = ['tool', 'args', 'where', 'when', 'prompt', 'openChat', 'agent'];
const sortedKeys = (v) => (Array.isArray(v) ? v.map(sortedKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortedKeys(v[k])])) : v);
export const actionPart = (a) => ({ ...Object.fromEntries([...ACTION_REACH, 'enabled'].map((f) => [f, a[f]])), boundTo: JSON.stringify(sortedKeys(ACTION_REACH.map((f) => a[f] ?? null))) });
export const waitFor = async (check, ms = T.long) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 200))) if (await check().catch(() => false)) return true;
  return false;
};
// The chat's turn is over: its Stop button gone (shown from the message sent to the answer's end).
// `shown`: the user's messages before this one was sent, to tell that it went (a turn may end before
// the first look). False when it did not end within T.turn.
export async function turnEnded(page, shown) {
  const stop = page.getByRole('button', { name: 'Stop', exact: true });
  // Not even begun: not ended either (a message that was never sent).
  if (!(await waitFor(async () => (await stop.count()) > 0 || (await page.locator('.msg.user').count()) > shown, T.short))) return false;
  return waitFor(async () => !(await stop.count()), T.turn);
}
export const SHOP = fs.readFileSync('tests/fixtures/shop.html', 'utf8');
export const WEBMCP = fs.readFileSync('tests/fixtures/webmcp.html', 'utf8');
export const ENGINE = fs.readFileSync('tests/fixtures/engine.html', 'utf8');
export const WORKER = fs.readFileSync('tests/fixtures/worker.html', 'utf8');
export const EDITOR = fs.readFileSync('tests/fixtures/editor.html', 'utf8');
export const RAIL = fs.readFileSync('tests/fixtures/rail.html', 'utf8');
export const HELLO = 'Hello, I am the mock.';
