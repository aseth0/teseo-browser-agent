// Dictation into the message box (sidepanel/useDictation): Chromium's fake microphone, chunks of 1 s
// sent to the mock's /audio/transcriptions, each answered "chunk N" a moment later.
import { HELLO, T, waitFor } from '../lib.mjs';
import { mock } from '../mock/state.mjs';
import { EXPECT, RUN, TURNS, VOICE } from './tables.mjs';

const voice = { providerId: 'env', model: 'whisper-mock', chunkSeconds: 1 };
const box = (page) => page.getByPlaceholder(/Ask something/);
const dictate = (page) => page.getByRole('button', { name: 'Dictate', exact: true });
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
  await page.getByRole('button', { name: 'Stop dictating', exact: true }).click();
  if (!(await dictate(page).waitFor({ timeout: T.medium }).then(() => true, () => false))) errors.push('dictation did not finish');
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
