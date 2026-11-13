// Helpers more than one area of scenarios uses.
import { stored, waitFor } from '../lib.mjs';

// The panel's tool count, "shown/total" on the tools menu (shown: those offered).
export const toolCount = async (page) => (await page.locator('.tools-count').first().innerText()).match(/(\d+)\/(\d+)/)?.slice(1).map(Number) ?? [];

// Replaces the page's clipboard with a recorder (the real one needs a focused window); returns what
// was copied since, as { plain, html? } each.
export async function recordClipboard(page) {
  await page.evaluate(() => {
    window.__copied = [];
    navigator.clipboard.writeText = async (plain) => void window.__copied.push({ plain });
    navigator.clipboard.write = async ([item]) =>
      void window.__copied.push({ plain: await (await item.getType('text/plain')).text(), html: await (await item.getType('text/html')).text() });
  });
  return async () => {
    await page.waitForTimeout(200); // reading the blobs is asynchronous
    return page.evaluate(() => window.__copied);
  };
}

// A recording's hooks are in the page (recording/page-hooks): its fetch is no longer the browser's.
// The background's recording as the chats and the popup see it (recording/recorder-protocol).
export const recordingStatus = (page) => page.evaluate(async () => (await chrome.storage.session.get('recordingStatus')).recordingStatus);
// The toolbar popup, opened over `shop` (the tab it acts on).
async function popupOver(page, shop) {
  const popup = await page.context().newPage();
  await popup.goto(new URL('/popup.html', page.url()).href);
  await shop.bringToFront();
  return popup;
}
// The popup's Record line: a preset (none: the default, API calls), then a mode; recording once the
// background says so. The chat has no record button.
export async function startRecording(page, shop, { mode = 'This tab', preset } = {}) {
  const popup = await popupOver(page, shop);
  const line = popup.getByRole('group', { name: 'Record' });
  if (preset) await line.getByRole('combobox', { name: 'Preset' }).selectOption({ label: preset });
  await line.getByRole('menuitem', { name: new RegExp(`^${mode}`) }).click();
  if (!(await waitFor(async () => (await recordingStatus(page))?.state === 'recording', 5000))) throw new Error('the recording did not start');
  await popup.close().catch(() => undefined); // it closes itself
}
// The popup's Stop: the review opens in the chat.
export async function stopRecording(page, shop) {
  const popup = await popupOver(page, shop);
  await popup.getByRole('menuitem', { name: 'Stop recording' }).click();
  await popup.close().catch(() => undefined);
  const review = page.getByRole('dialog', { name: 'Recording review' });
  await review.waitFor({ timeout: 5000 });
  return review;
}
// Its calls kept so far reach `n`.
export const recordedCalls = (page, n) => waitFor(async () => (await recordingStatus(page))?.calls === n, 3000);
export const pageHooked = (shop) => shop.waitForFunction(() => !String(window.fetch).includes('[native code]'), null, { timeout: 3000 });
// Counts the answers a recorded page relays to the panel (recording-answer); returns a check that
// `n` came.
export async function countAnswers(page) {
  await page.evaluate(() => {
    window.__answers = 0;
    chrome.runtime.onMessage.addListener((m) => void (m?.type === 'recording-answer' && window.__answers++));
  });
  return (n) => page.evaluate((n) => window.__answers >= n, n);
}

// Settings → Prompt preview with every text in view: its sections and groups unfolded, each
// section showing its blocks (they start "As sent", or stay on JSON once shown).
export async function unfoldPreview(options) {
  const preview = options.locator('.prompt-preview');
  await preview.waitFor();
  const unfold = () => options.evaluate(() => document.querySelectorAll('.prompt-preview details').forEach((d) => (d.open = true)));
  await unfold();
  for (const button of await preview.getByRole('button', { name: 'Blocks', exact: true }).all()) {
    if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
  }
  await unfold(); // what the blocks brought
  return preview;
}

// The chat's agent menu: the agent chosen (its name on the button), and choosing one by name.
export const chosenAgent = async (page) => (await page.locator('.agent-picker .agent-picker-name').innerText()).trim();
export async function chooseAgent(page, name) {
  await page.locator('.agent-picker > .popover > button').click();
  await page.getByRole('menuitemradio', { name: new RegExp(`^\\S*\\s*${name}\\b`) }).click();
}

// On skills.save's card (scenarios skill-edit, skill-edit-full): a name that is not one first, asked
// again saying why, then a good name and another description, allowed.
export async function editSkillOnCard(page) {
  const card = page.getByRole('alertdialog');
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  await card.getByLabel('Name', { exact: true }).fill('Not A Name');
  await card.getByRole('button', { name: 'Allow', exact: true }).click();
  const again = page.getByRole('alertdialog');
  await again.getByRole('alert').waitFor({ timeout: 5000 });
  if (!(await again.getByLabel('Name', { exact: true }).inputValue()).startsWith('Not A Name')) throw new Error('the name edited is not kept');
  await again.getByLabel('Name', { exact: true }).fill('shop-notes');
  await again.getByLabel('Description', { exact: true }).fill('Edited by the user.');
  await again.getByRole('button', { name: 'Allow', exact: true }).click();
}

// The skill saved with the user's values.
export async function editedSkillSaved(page) {
  const skills = await stored(page, 'skills');
  const saved = skills.user.find((s) => s.name === 'shop-notes');
  if (saved?.description !== 'Edited by the user.' || saved.body !== '1. Read the price.' || skills.user.some((s) => s.name === 'shop-note')) throw new Error(`saved skill: ${JSON.stringify(skills.user)}`);
}
