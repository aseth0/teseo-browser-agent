// Dictation into the message box (sidepanel/useDictation): Chromium's fake microphone, chunks of 1 s
// sent to the mock's /audio/transcriptions, each answered "chunk N" a moment later.
import { HELLO, T, waitFor } from '../lib.mjs';
import { mock } from '../mock/state.mjs';
import { EXPECT, PAGES, PAGE_ACTIONS, RUN, TURNS, VOICE } from './tables.mjs';

const voice = { providerId: 'env', model: 'whisper-mock', chunkSeconds: 1 };
const box = (page) => page.getByPlaceholder(/Ask something/);
const dictate = (page) => page.getByRole('button', { name: 'Dictate', exact: true });
// The strip in the box while it dictates (sidepanel/DictationStrip), and its Stop.
const strip = (page) => page.getByRole('group', { name: 'Dictation' });
// Shown, its time counting, on one line; a screenshot of the box with E2E_SHOTS.
async function checkStrip(page, errors, what) {
  if (!(await strip(page).isVisible())) return errors.push(`${what}: no dictation strip`);
  const time = await strip(page).locator('.dictation-time').innerText();
  if (!/^\d+:\d\d$/.test(time)) errors.push(`${what}: strip time "${time}"`);
  const { height } = await strip(page).boundingBox();
  if (height > 32) errors.push(`${what}: strip on more than one line (${height}px)`);
  if (process.env.E2E_SHOTS) await page.locator('.composer').screenshot({ path: `${process.env.E2E_SHOTS}/${what}-strip.png` });
}
// The chunks' texts in recording order: "chunk 1 chunk 2 …", as many as were sent.
const inOrder = (n) => Array.from({ length: n }, (_, i) => `chunk ${i + 1}`).join(' ');

// Dictated after what was typed, in order, with what came before as each chunk's prompt; nothing to the
// chat model, and the box keeps it unsent.
VOICE['voice-dictate'] = voice;
TURNS['voice-dictate'] = 0;
EXPECT['voice-dictate'] = 'Teseo';
RUN['voice-dictate'] = async ({ page, errors }) => {
  await box(page).fill('Note:');
  await dictate(page).click();
  if (!(await waitFor(async () => (await box(page).inputValue()).includes('chunk 2'), T.max))) errors.push(`dictated: "${await box(page).inputValue()}" lines: ${await page.locator('.dictation-line').allInnerTexts()} button: ${await page.locator('.dictate').getAttribute('class')}`);
  await checkStrip(page, errors, 'voice-dictate');
  await strip(page).getByRole('button', { name: 'Stop dictation', exact: true }).click();
  if (!(await dictate(page).waitFor({ timeout: T.medium }).then(() => true, () => false))) errors.push('dictation did not finish');
  if (await strip(page).isVisible()) errors.push('the strip stayed after the dictation');
  const n = mock.transcriptions.length;
  const text = await box(page).inputValue();
  if (text !== `Note: ${inOrder(n)}`) errors.push(`box: "${text}", ${n} chunks`);
  if (mock.transcriptions.some((t) => t.model !== 'whisper-mock')) errors.push(`model: ${mock.transcriptions.map((t) => t.model)}`);
  if (mock.transcriptions[1] && mock.transcriptions[1].prompt !== 'chunk 1') errors.push(`second prompt: "${mock.transcriptions[1].prompt}"`);
  if (mock.chatRequests || (await page.locator('.msg.user').count())) errors.push('something went to the chat model');
};

// Enter while dictating: it stops, waits for the last chunk, then the whole box goes once.
VOICE['voice-send'] = voice;
TURNS['voice-send'] = 0;
EXPECT['voice-send'] = HELLO;
RUN['voice-send'] = async ({ page, errors }) => {
  await dictate(page).click();
  if (!(await waitFor(async () => (await box(page).inputValue()).includes('chunk 1'), T.max))) errors.push('nothing dictated');
  await box(page).press('Enter');
  if (await page.locator('.msg.user').count()) errors.push('sent before the last chunk');
  await page.getByText(HELLO).waitFor({ timeout: T.turn }).catch(() => errors.push('no answer'));
  const sent = await page.locator('.msg.user').allInnerTexts();
  const n = mock.transcriptions.length;
  if (sent.length !== 1 || sent[0].trim() !== inOrder(n)) errors.push(`sent: ${JSON.stringify(sent)}, ${n} chunks`);
  if (mock.chatRequests !== 1) errors.push(`chat requests: ${mock.chatRequests}`);
  if (await box(page).inputValue()) errors.push(`box left: "${await box(page).inputValue()}"`);
};

// The chat floating on a page that denies the microphone to every frame (Permissions-Policy:
// microphone=()): the frame itself cannot have it, and dictation records in the offscreen document
// instead, as in the side panel. Folded, it stops; the page navigated, the recording goes with it.
VOICE['voice-floating'] = voice;
TURNS['voice-floating'] = 0;
EXPECT['voice-floating'] = 'Teseo';
PAGES['voice-floating'] = '/no-mic.html';
PAGE_ACTIONS['voice-floating'] = [{ id: 'm', enabled: true, name: 'Page info', where: ['http://localhost/no-mic.html'], input: 'none', tool: 'browser.list_tabs', args: {}, outputs: [{ label: 'Tabs' }] }];
RUN['voice-floating'] = async ({ errors, shop, sw }) => {
  // Floated as its shortcut does (the background to the tab's widget), once the bubble is there.
  const float = (toggle) => sw.evaluate(async ({ toggle }) => {
    const [tab] = await chrome.tabs.query({ url: 'http://localhost/no-mic.html' });
    return tab && chrome.tabs.sendMessage(tab.id, { type: 'browser-agent:widget-float', ...(toggle && { toggle }) }).catch(() => undefined);
  }, { toggle });
  const frame = () => shop.frames().find((f) => f.url().includes('/floating.html'));
  if (!(await waitFor(async () => (await float())?.floated && (await frame()?.getByPlaceholder(/Ask something/).isVisible().catch(() => false)), T.max))) throw new Error('no chat floating on the page');
  const chat = frame();
  // At the floating chat's width the message box's buttons are behind ⋯ (its OverflowBar): opened first.
  const more = chat.getByRole('button', { name: 'More: message box buttons' });
  const open = async () => (await more.getAttribute('aria-expanded')) !== 'true' && (await more.click());
  const press = async (name) => {
    await open();
    await chat.getByRole('button', { name, exact: true }).click();
  };
  const shown = (name) => waitFor(async () => {
    await open();
    return chat.getByRole('button', { name, exact: true }).isVisible();
  }, T.medium);
  // The page's policy: no frame of it gets the microphone, not even the extension's.
  const own = await chat.evaluate(() => navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => (s.getTracks().forEach((t) => t.stop()), 'allowed'), (e) => e.name));
  if (own !== 'NotAllowedError') errors.push(`the frame's own microphone: ${own}`);
  await box(chat).fill('Note:');
  await press('Dictate');
  if (!(await waitFor(async () => (await box(chat).inputValue()).includes('chunk 2'), T.max))) errors.push(`floating: dictated "${await box(chat).inputValue()}" lines: ${await chat.locator('.dictation-line').allInnerTexts()}`);
  await checkStrip(chat, errors, 'voice-floating'); // in view, though its 🎤 is behind ⋯
  await strip(chat).getByRole('button', { name: 'Stop dictation', exact: true }).click();
  if (!(await shown('Dictate'))) errors.push('floating: dictation did not finish');
  const n = mock.transcriptions.length;
  if ((await box(chat).inputValue()) !== `Note: ${inOrder(n)}`) errors.push(`floating: box "${await box(chat).inputValue()}", ${n} chunks`);
  if (mock.transcriptions[1] && mock.transcriptions[1].prompt !== 'chunk 1') errors.push(`floating: second prompt "${mock.transcriptions[1].prompt}"`);
  if (mock.chatRequests) errors.push('floating: something went to the chat model');
  // No more chunks once the recording is off: none sent for a while.
  const stillOff = async (what) => {
    await new Promise((r) => setTimeout(r, 1200)); // a chunk recording then may still go
    const before = mock.transcriptions.length;
    await new Promise((r) => setTimeout(r, 2500));
    if (mock.transcriptions.length !== before) errors.push(`${what}: still recording (${mock.transcriptions.length - before} chunks more)`);
  };
  // Folded: it stops.
  await press('Dictate');
  if (!(await waitFor(async () => mock.transcriptions.length > n, T.max))) errors.push('floating: the second dictation sent nothing');
  await float(true);
  await stillOff('folded');
  // Shown again: stopped. Dictating again, then the page navigates: the recording goes with the frame.
  await float(true);
  if (!(await shown('Dictate'))) return errors.push('floating: shown again after folded, still dictating');
  await press('Dictate');
  const sent = mock.transcriptions.length;
  if (!(await waitFor(async () => mock.transcriptions.length > sent, T.max))) errors.push(`floating: the third dictation sent nothing (lines: ${await chat.locator('.dictation-line').allInnerTexts()}; button: ${await chat.locator('.dictate').getAttribute('class').catch(() => 'none')})`);
  await shop.goto(shop.url());
  await stillOff('navigated');
};
