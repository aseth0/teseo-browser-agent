// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '../src/storage/settings-types';
import type { SettingsChange } from '../src/ui/useSettings';

// Settings → Speak: voice profiles made, edited, tested, duplicated, deleted (asked first) and chosen as
// the default; the reading settings; and the selectors a reading uses.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const sendMessage = vi.fn(async (_m: unknown): Promise<unknown> => ({ started: true }));
const contains = vi.fn(async () => true);
vi.mock('wxt/browser', () => ({ browser: { offscreen: {}, runtime: { sendMessage }, permissions: { contains, request: vi.fn(async () => true) } } }));
let speaking: unknown;
vi.mock('../src/ui/useSpeakStatus', () => ({ useSpeakStatus: () => speaking }));
vi.mock('../src/ui/useProviderModels', () => ({ useProviderModels: () => ['gpt-4o', 'tts-1'] }));
vi.mock('../src/ui/SectionTop', () => ({ SectionTop: () => null }));
const { SpeakSection } = await import('../src/ui/speak/SpeakSection');
const { applySettingsChange } = await import('../src/ui/useSettings');
const { copyOfProfile, freeName, newProfile, withoutProfile } = await import('../src/speech/profiles');
const { defaultProfile, planOptions, profileOr, selectionButtonOn, speakLanguage, speechTarget } = await import('../src/speech/settings');

const provider = { id: 'p', name: 'Voices', baseURL: 'https://tts.example.test/v1', apiKey: 'k', defaultModel: '' };
const base = (speak?: Settings['speak'], more: Partial<Settings> = {}) => ({ providers: [provider], systemPrompt: '', speak, ...more }) as Settings;
const CALM = { id: 'a', name: 'Calm', providerId: 'p', model: 'tts-1', voice: 'nova_a', speed: 1.1 };

describe('the selectors', () => {
  it('the default profile: the one chosen, else the first; an agent\'s removed reads as the default', () => {
    const quick = { ...CALM, id: 'b', name: 'Quick' };
    expect(defaultProfile(base({ profiles: [CALM, quick], defaultProfileId: 'b' }))).toBe(quick);
    expect(defaultProfile(base({ profiles: [CALM, quick], defaultProfileId: 'gone' }))).toBe(CALM);
    expect(defaultProfile(base())).toBeUndefined();
    expect(profileOr(base({ profiles: [CALM, quick] }), 'gone')).toBe(CALM);
  });
  it('reading rules: chosen here, else dictation\'s language, or none', () => {
    expect(speakLanguage(base(undefined, { voice: { language: 'es' } }))).toBe('es');
    expect(speakLanguage(base({ language: 'none' }, { voice: { language: 'es' } }))).toBeUndefined();
    expect(speakLanguage(base({ language: 'es' }))).toBe('es');
    expect(planOptions(base({ firstPiece: 5, pieceSize: 99_999 }))).toEqual({ first: 40, rest: 2000, language: undefined, pairs: [] });
  });
  it('reading rules: the profile\'s own first, else as before', () => {
    const s = base({ language: 'es' }, { voice: { language: 'es' } });
    expect(speakLanguage(s, { language: 'none' })).toBeUndefined();
    expect(speakLanguage(base({ language: 'none' }), { language: 'es' })).toBe('es');
    expect(speakLanguage(s, {})).toBe('es');
    expect(speakLanguage(base({ language: 'none' }, { voice: { language: 'es' } }), { language: ' ' })).toBeUndefined();
    expect(planOptions(base({ pairs: [{ written: 'a', said: 'b' }] }), { language: 'es' })).toMatchObject({ language: 'es', pairs: [{ written: 'a', said: 'b' }] });
  });
  it('a profile\'s speed bounded, and what is missing said', () => {
    expect(speechTarget(base(), { ...CALM, speed: 9 })).toEqual({ provider, model: 'tts-1', voice: 'nova_a', speed: 4 });
    expect(speechTarget(base(), { ...CALM, voice: ' ' })).toEqual({ error: 'The voice profile "Calm" has no voice: set one in Settings → Speak.' });
  });
  it('the button beside a selection: on by default, with a profile or the system voice', () => {
    expect(selectionButtonOn(base())).toBe(true); // the system voice reads
    expect(selectionButtonOn(base({ systemVoice: false }))).toBe(false);
    expect(selectionButtonOn(base({ profiles: [CALM] }))).toBe(true);
    expect(selectionButtonOn(base({ profiles: [CALM], selectionButton: false }))).toBe(false);
    expect(selectionButtonOn(base({ profiles: [CALM], enabled: false }))).toBe(false);
  });
  it('names not taken, copies, and the default dropped with its profile', () => {
    expect(freeName('Voice', ['voice', 'Voice 2'])).toBe('Voice 3');
    expect(newProfile(base({ profiles: [{ ...CALM, name: 'Voice' }] }), 'n')).toEqual({ id: 'n', name: 'Voice 2', providerId: 'p', speed: 1 });
    expect(copyOfProfile(CALM, base({ profiles: [CALM] }), 'c')).toEqual({ ...CALM, id: 'c', name: 'Calm (copy)' });
    expect(withoutProfile(base({ profiles: [CALM], defaultProfileId: 'a', firstPiece: 80 }), 'a')).toEqual({ profiles: [], firstPiece: 80 });
  });
});

// The section with its settings kept as it changes them.
async function show(initial: Settings) {
  let now = initial;
  function Harness() {
    const [settings, setSettings] = useState(initial);
    return createElement(SpeakSection, { settings, onChange: (change: SettingsChange) => setSettings((s) => (now = applySettingsChange(s, change))) });
  }
  const box = document.createElement('div');
  document.body.append(box);
  await act(async () => createRoot(box).render(createElement(Harness)));
  const field = <T extends Element>(label: string) => box.querySelector<T>(`[aria-label="${label}"]`)!;
  const button = (text: string) => [...box.querySelectorAll('button')].find((b) => b.textContent === text);
  const profiles = () => [...box.querySelectorAll('[aria-label="Voice profiles"] .tool-group-item')].map((b) => [...b.querySelectorAll('span')].map((x) => x.textContent).join(' · '));
  return { box, field, button, profiles, settings: () => now };
}
const type = async (el: HTMLInputElement | HTMLSelectElement, value: string) =>
  act(async () => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
const click = async (b: HTMLElement | undefined) => act(async () => b!.click());

describe('Settings → Speak', () => {
  it('a profile made, set, tested and chosen as the default', async () => {
    const { button, field, profiles, settings } = await show(base());
    await click(button('＋ New profile'));
    expect(profiles()).toEqual(['Voice · default']);
    await type(field('Profile name'), 'Calm');
    await type(field('Model'), 'tts-1');
    await type(field('Voice'), 'nova_a+nova_b');
    await type(field('Speed'), '1.25');
    const made = settings().speak!.profiles![0]!;
    expect(made).toMatchObject({ name: 'Calm', providerId: 'p', model: 'tts-1', voice: 'nova_a+nova_b', speed: 1.25 });

    sendMessage.mockClear();
    await click(button('Test'));
    expect(contains).toHaveBeenCalledWith({ origins: ['https://tts.example.test/*'] });
    expect(sendMessage).toHaveBeenCalledWith({ type: 'browser-agent:speak-text', text: 'Hello! This is how this voice sounds.', profile: made, key: `test:${made.id}` });

    await click(button('＋ New profile'));
    expect(profiles()).toEqual(['Calm · default', 'Voice · ']);
    await click(button('Use by default'));
    expect(settings().speak!.defaultProfileId).toBe(settings().speak!.profiles![1]!.id);
  });

  it('a profile\'s own reading rules: as Speak\'s default until chosen, shown in its row, and Test reads with them', async () => {
    const { button, field, profiles, settings } = await show(base({ profiles: [CALM], defaultProfileId: 'a' }, { voice: { language: 'es' } }));
    const rules = field<HTMLSelectElement>('Reading rules');
    expect(rules.selectedOptions[0]!.textContent).toBe("As Speak's default (Spanish)");
    expect(profiles()).toEqual(['Calm · default']);
    await type(rules, 'none');
    expect(settings().speak!.profiles![0]).toEqual({ ...CALM, language: 'none' });
    expect(profiles()).toEqual(['Calm · default · no rules']);
    await type(field('Reading rules'), 'es');
    expect(profiles()).toEqual(['Calm · default · Spanish rules']);
    sendMessage.mockClear();
    await click(button('Test'));
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ profile: { ...CALM, language: 'es' } }));
    await type(field('Reading rules'), '');
    expect(settings().speak!.profiles![0]).toEqual({ ...CALM, language: undefined });
    expect(profiles()).toEqual(['Calm · default']);
  });

  it('Test shows what the server said when it refuses, and becomes Stop while it reads', async () => {
    const { button, box } = await show(base({ profiles: [CALM] }));
    sendMessage.mockResolvedValueOnce({ error: 'The voice server answered 400: Voice nova_a not found. Voices: nova_b, nova_c' });
    await click(button('Test'));
    expect(box.querySelector('[role="alert"]')?.textContent).toBe('The voice server answered 400: Voice nova_a not found. Voices: nova_b, nova_c');
    speaking = { run: 'r', state: 'reading', piece: 1, total: 1, startedAt: 1, key: 'test:a' };
    const again = await show(base({ profiles: [CALM] }));
    expect(again.button('Stop')).toBeDefined();
    speaking = undefined;
  });

  it('Duplicate, and Delete asked first inside the page', async () => {
    const { button, profiles, box } = await show(base({ profiles: [CALM], defaultProfileId: 'a' }));
    await click(button('Duplicate'));
    expect(profiles()).toEqual(['Calm · default', 'Calm (copy) · nova_a']);
    await click(button('Delete'));
    expect(box.querySelector('.inline-confirm')?.textContent).toContain('Delete "Calm (copy)"?');
    await click(box.querySelector<HTMLButtonElement>('.inline-confirm .danger')!);
    expect(profiles()).toEqual(['Calm · default']);
  });

  it('the reading settings: the pieces bounded, the rules, the pairs, the selection button', async () => {
    const { field, settings, box } = await show(base({ profiles: [CALM] }, { voice: { language: 'es' } }));
    await click([...box.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((t) => t.textContent === 'Reading'));
    expect(field<HTMLSelectElement>('Default reading rules').selectedOptions[0]!.textContent).toBe('As dictation (Spanish)');
    await type(field('Default reading rules'), 'none');
    await type(field('First piece, in characters'), '80');
    const pairs = field<HTMLTextAreaElement>('Pronunciations');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(pairs, 'example.test = example dot test\nno pair');
      pairs.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(field<HTMLInputElement>('Button beside a selection'));
    expect(settings().speak).toMatchObject({ language: 'none', firstPiece: 80, pairs: [{ written: 'example.test', said: 'example dot test' }], selectionButton: false });
  });

  it('imports profiles from a pasted list: the preview, a provider and model for all of them, added to yours', async () => {
    const { button, field, profiles, settings, box } = await show(base({ profiles: [CALM], defaultProfileId: 'a', firstPiece: 80 }));
    await click(button('Import ▾'));
    await click(button('Paste JSON…'));
    const paste = box.querySelector<HTMLTextAreaElement>('.paste-json textarea')!;
    expect(box.querySelector('.paste-json label')!.textContent).toContain('Name=voice@speed');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(paste, 'Reader=voice_a@1.15, Blend=voice_a+voice_b@1.2; nothing here; reader=voice_b, Calm=nova_z');
      paste.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(button('Import'));
    const preview = box.querySelector('.import-preview')!;
    expect(preview.querySelector('strong')!.textContent).toBe('5 voice profiles in the pasted JSON');
    expect([...preview.querySelectorAll('.import-rows li')].map((li) => li.textContent)).toEqual([
      'Readernew', 'Blendnew', 'nothing hereleft out', 'readerleft out', 'Calmreplaces yours',
    ]);
    expect(preview.textContent).toContain('They are added to yours; one of the same name is replaced.');
    await type(field('Provider for the list'), 'p');
    await type(field('Model for the list'), 'tts-1');
    await click(box.querySelector<HTMLInputElement>('[aria-label="Import Calm"]')!); // left as it is
    await click(button('Import 2'));
    expect(settings().speak!.profiles!.map(({ id: _id, ...p }) => p)).toEqual([
      { name: 'Calm', providerId: 'p', model: 'tts-1', voice: 'nova_a', speed: 1.1 },
      { name: 'Reader', providerId: 'p', model: 'tts-1', voice: 'voice_a', speed: 1.15, language: 'none' },
      { name: 'Blend', providerId: 'p', model: 'tts-1', voice: 'voice_a+voice_b', speed: 1.2, language: 'none' },
    ]);
    expect(settings().speak).toMatchObject({ defaultProfileId: 'a', firstPiece: 80 });
    expect(profiles()).toEqual(['Calm · default', 'Reader · voice_a · no rules', 'Blend · voice_a+voice_b · no rules']);
    expect(box.querySelector('[role="status"]')!.textContent).toContain('Imported Reader, Blend.');
  });

  it('a JSON profile whose provider is not here comes in without one, and its row says to choose it', async () => {
    const { button, profiles, box } = await show(base({ profiles: [CALM] }));
    await click(button('Import ▾'));
    await click(button('Paste JSON…'));
    const paste = box.querySelector<HTMLTextAreaElement>('.paste-json textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(paste, JSON.stringify({ voiceProfiles: [{ name: 'Far', providerId: 'elsewhere', model: 'tts-1', voice: 'v' }] }));
      paste.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(button('Import'));
    expect(box.querySelector('.import-preview')!.textContent).toContain('Far: its provider is not among yours.');
    expect(box.querySelector('[aria-label="Provider for the list"]')).toBeNull();
    await click(button('Import 1'));
    expect(profiles()).toEqual(['Calm · default', 'Far · v · choose its provider']);
  });

  it('exports the profiles ticked, as one file\'s JSON copied', async () => {
    const writeText = vi.fn(async (_t: string) => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { button, box } = await show(base({ profiles: [CALM, { ...CALM, id: 'b', name: 'Quick' }] }));
    await click(button('Select'));
    await click(box.querySelector<HTMLInputElement>('[aria-label="Select Quick"]')!);
    await click(button('Copy JSON'));
    expect(JSON.parse(writeText.mock.calls[0]![0])).toEqual({ voiceProfiles: [{ name: 'Quick', providerId: 'p', model: 'tts-1', voice: 'nova_a', speed: 1.1 }] });
  });
});
