// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { copyOfPreset, SHIPPED_PRESETS, withoutPreset, withPreset } from '../src/recording/presets';
import type { Settings } from '../src/storage/settings-types';
import { RecordingSection } from '../src/ui/RecordingSettings';

// Settings → Recording: the presets a recording keeps calls by, edited and saved.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const api = SHIPPED_PRESETS[0]!;

describe('saving presets', () => {
  it('an edit replaces the stored one by id, clamped', () => {
    const once = withPreset({} as Settings, { ...api, maxBody: 50_000 });
    expect(once).toEqual([{ ...api, maxBody: 20_000 }]);
    expect(withPreset({ recordingPresets: once } as Settings, { ...api, name: 'Mine' })).toEqual([{ ...api, name: 'Mine' }]);
  });
  it('a copy has its own id and name', () => {
    const copy = copyOfPreset(api, ['api', 'everything', 'errors']);
    expect(copy.id).not.toBe('api');
    expect(copy.name).toBe('API calls (copy)');
    expect(copy.exclude).toEqual(api.exclude);
  });
  it('removing one: a shipped one goes back to how it ships', () => {
    expect(withoutPreset({ recordingPresets: [{ ...api, name: 'Mine' }] } as Settings, 'api')).toBeUndefined();
  });
});

async function show(settings: Partial<Settings> = {}) {
  const onChange = vi.fn();
  const box = document.createElement('div');
  await act(async () => createRoot(box).render(createElement(RecordingSection, { settings: settings as Settings, onChange })));
  const field = <T extends Element>(label: string) => box.querySelector<T>(`[aria-label="${label}"]`)!;
  const button = (text: string) => [...box.querySelectorAll('button')].find((b) => b.textContent === text);
  // The presets on the left: each its name and what it is (default, built-in, edited, yours).
  const presets = () => [...box.querySelectorAll('[aria-label="Presets"] .tool-group-item')].map((b) => [...b.querySelectorAll('span')].map((x) => x.textContent).join(' · '));
  const pick = (name: string) => [...box.querySelectorAll<HTMLButtonElement>('[aria-label="Presets"] .tool-group-item')].find((b) => b.firstElementChild?.textContent === name)!;
  return { box, onChange, field, button, presets, pick };
}
const set = async (el: HTMLInputElement | HTMLSelectElement, value: string) =>
  act(async () => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });

describe('Settings → Recording', () => {
  it('lists the shipped presets and the default one', async () => {
    const { presets, field } = await show({ recordingPreset: 'errors' });
    expect(presets()).toEqual(['API calls · built-in', 'Everything · built-in', 'Errors only · default']);
    expect(field<HTMLInputElement>('Name').value).toBe('Errors only'); // the default one shown first
  });
  it('a body limit over 20,000 is saved as 20,000 once the field is left', async () => {
    const { field, onChange } = await show({ recordingPresets: [{ ...api, maxBody: 5000 }] });
    const body = field<HTMLInputElement>('Body kept up to, in characters');
    await set(body, '50000');
    await act(async () => void body.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(onChange).toHaveBeenLastCalledWith({ recordingPresets: [expect.objectContaining({ id: 'api', maxBody: 20_000 })] });
  });
  it('a new preset, a copy of the one shown', async () => {
    const { button, onChange } = await show();
    await act(async () => button('＋ New preset')!.click());
    expect(onChange).toHaveBeenLastCalledWith({ recordingPresets: [expect.objectContaining({ name: 'API calls (copy)' })] });
  });
  it('Delete asks first, inside the page', async () => {
    const own = { ...api, id: 'u1', name: 'Own' };
    const { pick, button, onChange, box } = await show({ recordingPresets: [own] });
    await act(async () => pick('Own').click());
    await act(async () => button('Delete')!.click());
    expect(onChange).not.toHaveBeenCalled();
    expect(box.textContent).toContain('Delete "Own"?');
    await act(async () => button('Delete preset')!.click());
    expect(onChange).toHaveBeenLastCalledWith({ recordingPresets: undefined, recordingPreset: undefined });
  });
  it('Reset only for a shipped one that was edited, asked first', async () => {
    const { button, onChange, box } = await show({ recordingPresets: [{ ...api, name: 'Mine' }] });
    expect(button('Delete')).toBeUndefined();
    await act(async () => button('Reset')!.click());
    expect(onChange).not.toHaveBeenCalled();
    expect(box.textContent).toContain('Discard your changes?');
    await act(async () => button('Reset')!.click());
    expect(onChange).toHaveBeenLastCalledWith({ recordingPresets: undefined });
  });
  it('the last kind of call cannot be unticked, saying why', async () => {
    const { box, onChange } = await show({ recordingPresets: [{ ...api, types: ['fetch'] }] });
    const fetch = box.querySelector<HTMLInputElement>('[aria-label="Kinds of calls"] input')!;
    await act(async () => fetch.click());
    expect(onChange).not.toHaveBeenCalled();
    expect(fetch.checked).toBe(true);
    expect(box.textContent).toContain('Keep at least one kind of call: a preset without any records nothing.');
  });
  it('a new line or a comma typed stays while you type', async () => {
    const { field, onChange } = await show();
    const out = field<HTMLTextAreaElement>('Leave out these addresses');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(out, `${out.value}\n`);
      out.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(out.value.endsWith('\n')).toBe(true);
    const methods = field<HTMLInputElement>('Methods');
    await set(methods, 'GET,');
    expect(methods.value).toBe('GET,');
    expect(onChange).toHaveBeenLastCalledWith({ recordingPresets: [expect.objectContaining({ methods: ['GET'] })] });
  });
});
