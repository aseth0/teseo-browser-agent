// Speak: text read aloud by the mock's text to speech (POST /audio/speech), one piece at a time, in the
// offscreen document. Headless Chromium may play nothing: the checks are on what the mock was asked, in
// what order, and on the state the extension shows (its status, the pill, the popup, Settings).
import { QUIET_MS, T, waitFor } from '../lib.mjs';
import { mock } from '../mock/state.mjs';
import { EXPECT, RUN, SPEAK, TURNS } from './tables.mjs';

const PROFILE = { id: 'calm', name: 'Calm', providerId: 'env', model: 'tts-mock', voice: 'nova_a', speed: 1.25 };
const KEY = { code: 'KeyR', alt: true, shift: true }; // the reading's key, set as in Settings → Shortcuts
const status = (sw) => sw.evaluate(async () => (await chrome.storage.session.get('speakStatus')).speakStatus);
const pilled = (shop) => shop.evaluate(() => !!document.querySelector('ba-speech'));

// The shop with a paragraph selected, and the reading's key set for its page.
async function selectOnShop({ shop, sw }, text) {
  await sw.evaluate(async (key) => {
    await chrome.storage.local.set({ pageKeys: { 'speak-toggle': key } });
    const [tab] = await chrome.tabs.query({ url: 'http://localhost/*' });
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['/page-keys.js'] });
  }, KEY);
  await shop.bringToFront();
  await shop.evaluate((t) => {
    const p = document.createElement('p');
    p.id = 'read-me';
    p.textContent = t;
    document.body.prepend(p);
    const range = document.createRange();
    range.selectNodeContents(p);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  }, text);
}
const press = (shop) => shop.keyboard.press('Alt+Shift+KeyR');

// The shortcut reads the selection: its pieces asked for in order, as said in Spanish, with the default
// profile's voice and speed; the pill and the popup say how far it is; the popup's Stop ends it.
SPEAK['speak-command'] = { profiles: [PROFILE], language: 'es', firstPiece: 40 };
TURNS['speak-command'] = 0;
EXPECT['speak-command'] = 'Teseo';
RUN['speak-command'] = async ({ errors, ctx, extId, shop, sw }) => {
  await selectOnShop({ shop, sw }, 'Primera frase corta. Tarda 0,26 s en cargar el 30% de 1.000.000 de datos, más o menos, cuando el servidor está libre. Fin.');
  await press(shop);
  if (!(await waitFor(async () => mock.speech.length >= 2, T.max))) return errors.push(`speak: asked for ${mock.speech.length} pieces`);
  const inputs = mock.speech.map((s) => s.input);
  const want = ['Primera frase corta.', 'Tarda 0 coma 26 segundos en cargar el 30 por ciento de 1000000 de datos, más o menos, cuando el servidor está libre. Fin.'];
  if (JSON.stringify(inputs) !== JSON.stringify(want)) errors.push(`speak: pieces ${JSON.stringify(inputs)}`);
  const first = mock.speech[0];
  if (first.model !== 'tts-mock' || first.voice !== 'nova_a' || first.speed !== 1.25 || first.response_format !== 'mp3') errors.push(`speak: asked ${JSON.stringify(first)}`);
  if (!(await waitFor(async () => (await status(sw))?.total === 2, T.medium))) errors.push(`speak: status ${JSON.stringify(await status(sw))}`);
  if (!(await waitFor(() => pilled(shop), T.medium))) errors.push('speak: no pill on the page');
  // Played: the status says a piece is being read (headless may have no sound to play it on).
  const playing = await waitFor(async () => (await status(sw))?.state === 'reading', T.medium);
  if (!playing) console.log(`     (speak: never playing, status ${JSON.stringify(await status(sw))})`);

  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  const line = popup.getByRole('group', { name: 'Read aloud' });
  await line.waitFor({ timeout: T.medium }).catch(() => errors.push('speak: no line in the popup'));
  if (!/Preparing…|Reading( \d of 2)?/.test((await line.innerText().catch(() => '')) ?? '')) errors.push(`speak: popup says "${await line.innerText().catch(() => '')}"`);
  await line.getByRole('menuitem', { name: 'Stop reading aloud' }).click().catch(() => errors.push('speak: no Stop in the popup'));
  if (!(await waitFor(async () => !(await status(sw)), T.medium))) errors.push('speak: still reading after Stop');
  if (!(await waitFor(async () => !(await pilled(shop)), T.medium))) errors.push('speak: the pill stayed');
  await popup.close().catch(() => undefined);
};

// Stop from the shortcut, mid-reading: the request in flight is cut and no other piece is asked for.
SPEAK['speak-stop'] = { profiles: [PROFILE], firstPiece: 40, pieceSize: 40 };
TURNS['speak-stop'] = 0;
EXPECT['speak-stop'] = 'Teseo';
RUN['speak-stop'] = async ({ errors, shop, sw }) => {
  mock.speechDelayMs = 1500;
  await selectOnShop({ shop, sw }, Array.from({ length: 8 }, (_, i) => `Sentence number ${i + 1} is read on its own.`).join(' '));
  await press(shop);
  if (!(await waitFor(async () => mock.speech.length >= 1, T.max))) return errors.push('speak-stop: nothing asked for');
  await press(shop); // the same key, while it reads: Stop
  if (!(await waitFor(async () => !(await status(sw)), T.medium))) errors.push('speak-stop: still reading after the key');
  const asked = mock.speech.length;
  await new Promise((r) => setTimeout(r, mock.speechDelayMs + QUIET_MS));
  if (mock.speech.length !== asked) errors.push(`speak-stop: ${mock.speech.length - asked} more asked for after Stop`);
  if (asked >= 8) errors.push('speak-stop: every piece was asked for');
  if (!mock.speech.some((s) => s.aborted)) errors.push('speak-stop: the request in flight was not cut');
};

// Settings → Speak, in the Audio group beside Voice: a profile made, tested (a voice the server does not
// have: its answer shown; then one it has: read with it), another made the default. Each with its own
// reading rules (Spanish, None): the same selection, read by the shortcut with one then the other, goes
// said in Spanish, then as written. Then two profiles imported from a pasted Name=voice@speed list.
TURNS['speak-settings'] = 0;
EXPECT['speak-settings'] = 'Teseo';
RUN['speak-settings'] = async ({ errors, ctx, extId, shop, sw }) => {
  const options = await ctx.newPage();
  await options.goto(`chrome-extension://${extId}/options.html#speak`);
  const nav = options.getByRole('navigation', { name: 'Settings sections' });
  await nav.getByRole('link', { name: 'Speak', exact: true }).waitFor({ timeout: T.medium }).catch(() => errors.push('speak-settings: no Speak in the menu'));
  const groups = (await nav.locator('.options-nav-group, a').allTextContents()).map((g) => g.trim());
  const at = groups.indexOf('Audio');
  if (at < 0 || groups[at + 1] !== 'Voice' || groups[at + 2] !== 'Speak') errors.push(`speak-settings: menu ${JSON.stringify(groups.slice(at, at + 3))}`);

  await options.getByRole('button', { name: '＋ New profile' }).click();
  await options.getByLabel('Profile name').fill('Calm');
  await options.getByLabel('Model', { exact: true }).fill('tts-mock');
  await options.getByLabel('Voice', { exact: true }).fill('nova_x');
  await options.getByLabel('Speed').fill('1.5');
  await options.getByRole('button', { name: 'Test', exact: true }).click();
  const alert = options.getByRole('alert');
  await alert.waitFor({ timeout: T.medium }).catch(() => undefined);
  const said = (await alert.innerText().catch(() => '')) ?? '';
  if (!said.includes("Voice 'nova_x' not found. Available voices: nova_a, nova_b")) errors.push(`speak-settings: refusal shown as "${said}"`);

  await options.getByLabel('Voice', { exact: true }).fill('nova_b');
  mock.speech.length = 0;
  await options.getByRole('button', { name: 'Test', exact: true }).click();
  if (!(await waitFor(async () => mock.speech.length >= 1, T.max))) errors.push('speak-settings: Test asked for nothing');
  else if (mock.speech[0].voice !== 'nova_b' || mock.speech[0].speed !== 1.5 || mock.speech[0].input !== 'Hello! This is how this voice sounds.') errors.push(`speak-settings: Test asked ${JSON.stringify(mock.speech[0])}`);
  // While it reads, Test is Stop.
  const stop = options.getByRole('button', { name: 'Stop', exact: true });
  if (await stop.waitFor({ timeout: T.medium }).then(() => true, () => false)) await stop.click();
  else if (await status(sw)) errors.push('speak-settings: no Stop while it read');

  await options.getByRole('button', { name: '＋ New profile' }).click();
  await options.getByLabel('Profile name').fill('Quick');
  await options.getByRole('button', { name: 'Use by default' }).click();
  const ok = await waitFor(async () => {
    const speak = (await sw.evaluate(async () => (await chrome.storage.local.get('settings')).settings.speak)) ?? {};
    const [calm, quick] = speak.profiles ?? [];
    return calm?.name === 'Calm' && calm.voice === 'nova_b' && calm.speed === 1.5 && quick?.name === 'Quick' && speak.defaultProfileId === quick.id;
  }, T.medium);
  if (!ok) errors.push(`speak-settings: stored ${JSON.stringify(await sw.evaluate(async () => (await chrome.storage.local.get('settings')).settings.speak))}`);

  // Quick (the default) reads as written; Calm, in Spanish.
  const stored = async () => (await sw.evaluate(async () => (await chrome.storage.local.get('settings')).settings.speak)) ?? {};
  await options.getByLabel('Model', { exact: true }).fill('tts-mock');
  await options.getByLabel('Voice', { exact: true }).fill('nova_a');
  await options.getByLabel('Reading rules', { exact: true }).selectOption('none');
  await options.getByRole('navigation', { name: 'Voice profiles' }).getByRole('button', { name: /^Calm/ }).click();
  await options.getByLabel('Reading rules', { exact: true }).selectOption('es');
  const ruled = await waitFor(async () => {
    const [calm, quick] = (await stored()).profiles ?? [];
    return calm?.language === 'es' && quick?.language === 'none' && quick.voice === 'nova_a' && quick.model === 'tts-mock';
  }, T.medium);
  if (!ruled) errors.push(`speak-settings: rules stored ${JSON.stringify(await stored())}`);
  const rows = await options.getByRole('navigation', { name: 'Voice profiles' }).locator('.tool-group-item').allInnerTexts();
  if (!rows.some((r) => r.includes('Spanish rules')) || !rows.some((r) => r.includes('no rules'))) errors.push(`speak-settings: rows ${JSON.stringify(rows)}`);

  const sample = 'Tarda 0,26 s.';
  const readWith = async (name) => {
    if (!(await waitFor(async () => !(await status(sw)), T.max))) errors.push(`speak-settings: still reading before ${name}`);
    mock.speech.length = 0;
    await selectOnShop({ shop, sw }, sample);
    await press(shop);
    if (!(await waitFor(async () => mock.speech.length >= 1, T.max))) return errors.push(`speak-settings: ${name} asked for nothing`);
    return mock.speech.map((x) => x.input).join(' ');
  };
  const plain = await readWith('Quick');
  if (plain !== sample || mock.speech[0]?.voice !== 'nova_a') errors.push(`speak-settings: Quick asked ${JSON.stringify(mock.speech)}`);
  await options.bringToFront();
  await options.getByRole('button', { name: 'Use by default' }).click();
  if (!(await waitFor(async () => { const k = await stored(); return k.defaultProfileId === k.profiles?.[0]?.id; }, T.medium))) errors.push('speak-settings: Calm not made the default');
  const spanish = await readWith('Calm');
  if (spanish !== 'Tarda 0 coma 26 segundos.' || mock.speech[0]?.voice !== 'nova_b') errors.push(`speak-settings: Calm asked ${JSON.stringify(mock.speech)}`);
  await waitFor(async () => !(await status(sw)), T.max);

  // Two profiles from a pasted list, with the provider and model chosen in the preview.
  await options.bringToFront();
  await options.getByRole('button', { name: 'Import ▾' }).click();
  await options.getByRole('menuitem', { name: 'Paste JSON…' }).click();
  await options.locator('.paste-json textarea').fill('Reader=nova_a@1.15, Blend=nova_a+nova_b@1.2; not an entry');
  await options.locator('.paste-json').getByRole('button', { name: 'Import', exact: true }).click();
  const preview = options.locator('.import-preview');
  await preview.waitFor({ timeout: T.medium }).catch(() => errors.push('speak-settings: no import preview'));
  await options.getByLabel('Provider for the list').selectOption({ index: 1 });
  await options.getByLabel('Model for the list').fill('tts-mock');
  await preview.getByRole('button', { name: 'Import 2' }).click().catch(() => errors.push('speak-settings: no Import 2'));
  const imported = await waitFor(async () => {
    const k = await stored();
    const [reader, blend] = (k.profiles ?? []).slice(2);
    return k.profiles?.length === 4 && reader?.name === 'Reader' && reader.voice === 'nova_a' && reader.speed === 1.15 && reader.model === 'tts-mock' && !!reader.providerId
      && blend?.name === 'Blend' && blend.voice === 'nova_a+nova_b' && blend.speed === 1.2 && k.defaultProfileId === k.profiles[0].id;
  }, T.medium);
  if (!imported) errors.push(`speak-settings: imported ${JSON.stringify(await stored())}`);
  await options.close();
};

// The offscreen document, made with AUDIO_PLAYBACK beside USER_MEDIA: still open well past the 30 seconds
// without sound after which Chrome closes one whose only reason is AUDIO_PLAYBACK; closed anyway, the next
// reading opens it again.
const offscreenOpen = (sw) => sw.evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length > 0);
SPEAK['speak-offscreen'] = { profiles: [PROFILE] };
TURNS['speak-offscreen'] = 0;
EXPECT['speak-offscreen'] = 'Teseo';
RUN['speak-offscreen'] = async ({ errors, shop, sw }) => {
  await selectOnShop({ shop, sw }, 'Short.');
  await press(shop);
  if (!(await waitFor(async () => mock.speech.length === 1, T.max))) return errors.push('speak-offscreen: nothing asked for');
  if (!(await waitFor(async () => !(await status(sw)), T.max))) errors.push(`speak-offscreen: never ended, ${JSON.stringify(await status(sw))}`);
  await new Promise((r) => setTimeout(r, 35_000));
  if (!(await offscreenOpen(sw))) errors.push('speak-offscreen: closed after 35 s without sound');
  await sw.evaluate(() => chrome.offscreen.closeDocument());
  if (await offscreenOpen(sw)) errors.push('speak-offscreen: not closed');
  await shop.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('read-me'));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await press(shop);
  if (!(await waitFor(async () => mock.speech.length === 2, T.max))) errors.push('speak-offscreen: not read again once the document was closed');
  if (!(await offscreenOpen(sw))) errors.push('speak-offscreen: not opened again');
  // Over before the next scenario: its status would come back into the storage cleared for it.
  if (!(await waitFor(async () => !(await status(sw)), T.max))) errors.push('speak-offscreen: the second reading never ended');
};
