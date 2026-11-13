// Settings → Shortcuts: a key set there for a command, recorded from the keys pressed, and run when it is
// pressed in a page (the page-keys script) as the command's browser shortcut runs it.
import { HELLO, T } from '../lib.mjs';
import { EXPECT, MODEL_OF, RUN } from './tables.mjs';

MODEL_OF['page-keys'] = 'basic';
EXPECT['page-keys'] = HELLO;

RUN['page-keys'] = async ({ errors, ctx, extId, shop, sw }) => {
  const options = await ctx.newPage();
  await options.goto(`chrome-extension://${extId}/options.html#shortcuts`);
  const menu = options.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Shortcuts', exact: true });
  await menu.waitFor({ timeout: T.medium }).catch(() => errors.push('shortcuts: no Shortcuts section'));
  if (!(await menu.locator('svg').count())) errors.push('shortcuts: no icon in the menu');
  // Recorded: a click on its field, then the key.
  const row = options.getByRole('row', { name: /Screenshot the visible part/ });
  await row.locator('[data-key-recorder]').click();
  await row.getByText('Press keys · Esc cancels').waitFor({ timeout: T.short }).catch(() => errors.push('shortcuts: not recording'));
  await options.keyboard.press('Control+Alt+KeyV');
  // The key shows once it is saved (ui/shortcuts usePageKeys), a moment after it is pressed.
  await row.locator('kbd', { hasText: /^(Ctrl\+Alt\+V|⌃⌥V)$/ }).last().waitFor({ timeout: T.short }).catch(() => undefined);
  const shown = (await row.locator('kbd').last().textContent().catch(() => '')) ?? '';
  if (!/^(Ctrl\+Alt\+V|⌃⌥V)$/.test(shown)) errors.push(`shortcuts: recorded as "${shown}"`);
  // Only the sites granted one by one here: a screenshot from it needs access to every site.
  if (!(await row.getByText('Needs access to every site').count())) errors.push('shortcuts: no note on access to every site');
  const stored = await sw.evaluate(async () => (await chrome.storage.local.get('pageKeys')).pageKeys);
  const key = stored?.['capture-visible'];
  if (Object.keys(stored ?? {}).length !== 1 || key?.code !== 'KeyV' || !key.ctrl || !key.alt || key.shift || key.meta) errors.push(`shortcuts: stored ${JSON.stringify(stored)}`);
  await options.close();

  // Pressed in the page. The test's sites are granted by the manifest here, where the script is not
  // registered (only on the sites the user granted): put into the shop as the background puts it into
  // open tabs. Without access to every site, the chat gets a note on why and what to use instead.
  await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'http://localhost/*' });
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['/page-keys.js'] });
    globalThis.__attached = undefined;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'session' && changes.chatAttach?.newValue) globalThis.__attached = changes.chatAttach.newValue;
    });
  });
  await shop.bringToFront();
  await shop.locator('body').click();
  await shop.keyboard.press('Control+Alt+KeyV');
  const attached = await sw.evaluate(async () => {
    for (let i = 0; i < 50 && !globalThis.__attached; i++) await new Promise((r) => setTimeout(r, 100));
    const a = globalThis.__attached;
    return a && { images: a.payload.images.length, note: a.payload.note };
  });
  if (attached?.images !== 0 || !/captures only with access to every site/.test(attached.note ?? '')) errors.push(`shortcuts: the page's key handed ${JSON.stringify(attached)}`);
};
