// The toolbar button's popup, opened as a page: where the chat opens.
import { HELLO, PORT, T } from '../lib.mjs';
import { EXPECT, MODEL_OF, RUN } from './tables.mjs';

MODEL_OF['action-popup'] = 'basic';
EXPECT['action-popup'] = HELLO;

RUN['action-popup'] = async ({ errors, ctx, extId, shop, sw, page }) => {
  let popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await shop.bringToFront();
  // By their names (the screenshots are icons; Visible's name carries its key when the browser set one).
  const names = await popup.getByRole('menuitem').evaluateAll((items) => items.map((i) => i.getAttribute('aria-label') ?? i.textContent?.trim()));
  if (!/^Agents Panel\|Settings\|Chat on this page\|Chat in the side panel\|Chat full screen in a tab\|Section\|Visible( \(.+\))?\|Full page\|Capture the tab's audio\|This tab( \(.+\))?$/.test(names.join('|'))) errors.push(`popup: ${names.join('|')}`);
  // Visible: handed to the chat's message box (CHAT_ATTACH). Opened as a page here, the popup gives the
  // extension no activeTab grant (the toolbar button and the shortcut do), so the browser refuses the
  // capture and the note says so: the way from the popup to the chat is what this checks.
  await sw.evaluate(() => {
    globalThis.__attached = undefined;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'session' && changes.chatAttach?.newValue) globalThis.__attached = changes.chatAttach.newValue;
    });
  });
  await popup.getByRole('menuitem', { name: /^Visible/ }).click();
  const attached = await sw.evaluate(async () => {
    for (let i = 0; i < 50 && !globalThis.__attached; i++) await new Promise((r) => setTimeout(r, 100));
    const a = globalThis.__attached;
    return a && { images: a.payload.images.length, note: a.payload.note };
  });
  if (attached?.images !== 0 || !/^Could not capture the page \(.*activeTab.*\)\.$/.test(attached.note ?? '')) errors.push(`popup: Visible handed ${JSON.stringify(attached)}`);
  // It closed itself.
  popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await shop.bringToFront();
  // The shop is granted, with the bubble only where actions are (these settings): said, and the popup stays.
  await popup.getByRole('menuitem', { name: 'Chat on this page' }).click();
  await popup.getByText('The bubble is off on this site.').waitFor({ timeout: T.short }).catch(() => errors.push('popup: no note without a widget'));
  if (await popup.locator('.popup-site').count()) errors.push('popup: a site line on a site already enabled');
  // Settings, at Website access.
  const settings = ctx.waitForEvent('page', { timeout: T.medium });
  await popup.getByRole('status').getByRole('button', { name: 'Settings', exact: true }).click();
  const options = await settings.catch(() => undefined);
  if (!options?.url().endsWith('/options.html#web-access')) errors.push(`popup: Settings opened ${options?.url()}`);
  // A site the extension may not use ([::1] stays ungranted): its first line says so, with Enable it (the
  // browser's own prompt it opens is not clicked here; the line going once granted is the unit tests').
  const ungranted = await ctx.newPage();
  await ungranted.goto(`http://[::1]:${PORT}/shop.html`);
  const third = await ctx.newPage();
  await ungranted.bringToFront();
  await third.goto(`chrome-extension://${extId}/popup.html`);
  await ungranted.bringToFront();
  await third.getByText(`[::1]:${PORT} is not enabled`).waitFor({ timeout: T.short }).catch(() => errors.push('popup: no line on a site not enabled'));
  if (!(await third.getByRole('menuitem', { name: `Enable [::1]:${PORT}` }).count())) errors.push('popup: no Enable it');
  await ungranted.close();
  await third.close();
  // A page no extension may reach: said, with nothing to do.
  const blank = await ctx.newPage();
  const fourth = await ctx.newPage();
  await blank.bringToFront();
  await fourth.goto(`chrome-extension://${extId}/popup.html`);
  await blank.bringToFront();
  await fourth.getByText("Teseo can't work on this page").waitFor({ timeout: T.short }).catch(() => errors.push('popup: no line on a page out of reach'));
  await blank.close();
  await fourth.close();
  // It closed itself: open again.
  const again = await ctx.newPage();
  await again.goto(`chrome-extension://${extId}/popup.html`);
  await shop.bringToFront();
  const opened = ctx.waitForEvent('page', { timeout: T.medium });
  await again.getByRole('menuitem', { name: 'Agents Panel' }).click();
  const manager = await opened.catch(() => undefined);
  if (!manager?.url().endsWith('/manager.html')) errors.push(`popup: the manager did not open (${manager?.url()})`);
  // Audio: for its review, by default, it needs Settings → Voice's model, and says so.
  const listener = await ctx.newPage();
  await listener.goto(`chrome-extension://${extId}/popup.html`);
  await shop.bringToFront();
  const audioTo = listener.getByLabel('Where the audio goes');
  if ((await audioTo.inputValue()) !== 'review') errors.push(`popup: the audio goes to ${await audioTo.inputValue()} by default`);
  await listener.getByRole('menuitem', { name: "Capture the tab's audio" }).click();
  await listener.getByText(/^Choose an audio model in Settings → Voice/).waitFor({ timeout: T.short }).catch(() => errors.push('popup: no note without an audio model'));
  // Audio only needs none. Opened as a page, the popup gives no activeTab grant here either, so the browser
  // refuses the tab's stream and the popup says so, staying open: the way from the popup to tabCapture is
  // what this checks. Where it goes is remembered.
  await audioTo.selectOption('file');
  await listener.getByRole('menuitem', { name: "Capture the tab's audio" }).click();
  await listener.getByText(/^The browser did not let the extension capture this tab \(.+\)\.$/).waitFor({ timeout: T.short }).catch(() => errors.push('popup: no note when the tab audio is refused'));
  if (await sw.evaluate(async () => (await chrome.storage.session.get('audioStatus')).audioStatus)) errors.push('popup: a refused tab audio left a status');
  await listener.reload();
  await listener.waitForFunction(() => document.querySelector('select[aria-label="Where the audio goes"]')?.value === 'file', null, { timeout: T.short }).catch(() => errors.push('popup: where the audio goes was not remembered'));
  await listener.getByLabel('Where the audio goes').selectOption('review');
  await listener.close();
  // Its review page, with no audio kept, says so.
  const audioReview = await ctx.newPage();
  await audioReview.goto(`chrome-extension://${extId}/audio.html`);
  await audioReview.getByText(/^No audio is kept/).waitFor({ timeout: T.short }).catch(() => errors.push('popup: the audio review did not open'));
  await audioReview.close();
  // Record: this tab with the default preset; the icon counts its calls; Stop opens the review in the chat.
  const recorder = await ctx.newPage();
  await recorder.goto(`chrome-extension://${extId}/popup.html`);
  await shop.bringToFront();
  await recorder.getByRole('menuitem', { name: /^This tab/ }).click();
  const recording = await sw.evaluate(async () => {
    for (let i = 0; i < 50; i++) {
      const { recordingStatus } = await chrome.storage.session.get('recordingStatus');
      if (recordingStatus?.state === 'recording') return { preset: recordingStatus.preset, badge: await chrome.action.getBadgeText({}) };
      await new Promise((r) => setTimeout(r, 100));
    }
    return undefined;
  });
  if (recording?.preset !== 'API calls' || recording.badge !== '0') errors.push(`popup: Record started ${JSON.stringify(recording)}`);
  const stopper = await ctx.newPage();
  await stopper.goto(`chrome-extension://${extId}/popup.html`);
  await shop.bringToFront();
  await stopper.getByRole('group', { name: 'Record' }).getByText(/^0 calls · /).waitFor({ timeout: T.short }).catch(() => errors.push('popup: no Recording line'));
  await stopper.getByRole('menuitem', { name: 'Stop recording' }).click();
  const review = page.getByRole('dialog', { name: 'Recording review' });
  await review.waitFor({ timeout: T.short }).catch(() => errors.push('popup: Stop did not bring the review to the chat'));
  await review.getByRole('button', { name: 'Discard' }).click().catch(() => undefined);
};
