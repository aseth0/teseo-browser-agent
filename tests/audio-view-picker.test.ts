// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '../src/storage/settings';
import type { TabAudioView } from '../src/storage/settings-types';
import { VoiceSection } from '../src/ui/VoiceSettings';

vi.mock('../src/ui/SectionTop', () => ({ SectionTop: () => null }));
// A browser that can capture a tab's audio (Chromium): elsewhere the tab says why instead (build-notices.test).
vi.mock('../src/core/build', async (actual) => ({ ...(await actual<typeof import('../src/core/build')>()), tabAudioAvailable: () => true }));

// Settings → Voice: what a tab's audio shows on the page, as radio buttons over drawings of the pill.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function open(tabAudioView?: TabAudioView) {
  const onChange = vi.fn();
  const settings = { providers: [], voice: { language: 'es', tabAudioView } } as unknown as Settings;
  const root = document.createElement('div');
  document.body.append(root);
  await act(async () => createRoot(root).render(createElement(VoiceSection, { settings, onChange })));
  // Its own tab of Settings → Voice.
  await act(async () => [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((t) => t.textContent === "A tab's audio")!.click());
  const radios = [...root.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
  return { onChange, radios, root };
}
const named = (radio: HTMLInputElement) => radio.closest('label')!.textContent;

describe("the tab's audio view", () => {
  it('offers the three, in one group, with the stored one chosen', async () => {
    const { radios, root } = await open('transcript');
    expect(radios.map(named)).toEqual(['The time and Stop', 'The transcript too', "The transcript and the sound's waves too"]);
    expect(new Set(radios.map((r) => r.name)).size).toBe(1);
    expect(radios.map((r) => r.checked)).toEqual([false, true, false]);
    expect(radios[0]!.closest('fieldset')!.querySelector('legend')!.textContent).toBe('While it is captured, the page shows');
    expect(root.querySelector('select option[value="waves"]')).toBeNull();
  });

  it('starts on the time and Stop with nothing stored', async () => {
    const { radios } = await open();
    expect(radios.map((r) => r.checked)).toEqual([true, false, false]);
  });

  it('stores what is chosen, and nothing for the time and Stop', async () => {
    const { onChange, radios } = await open('waves');
    await act(async () => radios[1]!.click());
    expect(onChange).toHaveBeenLastCalledWith({ voice: { language: 'es', tabAudioView: 'transcript' } });
    await act(async () => radios[0]!.click());
    expect(onChange).toHaveBeenLastCalledWith({ voice: { language: 'es', tabAudioView: undefined } });
  });

  it('keeps the drawings out of what a screen reader says', async () => {
    const { root } = await open();
    const drawings = [...root.querySelectorAll('.drawn-option svg')];
    expect(drawings).toHaveLength(3);
    expect(drawings.every((d) => d.getAttribute('aria-hidden') === 'true')).toBe(true);
  });
});
