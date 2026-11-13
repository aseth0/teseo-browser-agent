// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { ProviderConfig, Settings } from '../src/storage/settings';
import type { SettingsChange } from '../src/ui/useSettings';

// The chat's model picker lists the models last picked first, then each provider's registered models
// (all it lists when none is registered), with Show all and a filter over all of them; Settings →
// Providers registers them; the model fields of agents, actions and compaction suggest them.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('wxt/browser', async () => (await import('./fakes/browser')).inertBrowser());
const LISTED: Record<string, string[]> = { a: ['a1', 'a2', 'a3'], b: ['b1', 'b2'] };
const fetchModels = vi.fn(async (p: ProviderConfig) => {
  const ids = LISTED[p.id];
  if (!ids) throw new Error('no /models');
  return ids.map((id) => ({ id }));
});
vi.mock('../src/providers/model-list', () => ({ fetchModels }));
const { ModelPicker } = await import('../src/entrypoints/sidepanel/ModelPicker');
const { PickerModelsField } = await import('../src/ui/PickerModelsField');
const { ModelIdInput } = await import('../src/ui/fields');
const { SettingsContext } = await import('../src/ui/settings-context');
const { applySettingsChange } = await import('../src/ui/useSettings');

const provider = (id: string, extra: Partial<ProviderConfig> = {}): ProviderConfig =>
  ({ id, name: id.toUpperCase(), baseURL: `https://${id}.example.com/v1`, apiKey: '', defaultModel: '', ...extra }) as ProviderConfig;

const box = () => document.body.appendChild(document.createElement('div'));
const groups = (el: HTMLElement) =>
  [...el.querySelectorAll('.model-group')].map((g) => [g.querySelector('.model-group-title')!.firstChild!.textContent, ...[...g.querySelectorAll('.model-option')].map((o) => o.textContent)]);
const type = (el: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const option = (el: HTMLElement, text: string) => [...el.querySelectorAll<HTMLButtonElement>('.model-option')].find((o) => o.textContent === text)!;

// The picker opened, with the settings it changes kept as they would be stored.
async function picker(settings: Partial<Settings>, props: { providerId?: string; model: string; onPick?: (providerId: string, model: string) => void }) {
  const el = box();
  const state = { settings: { systemPrompt: '', ...settings } as Settings };
  const update = vi.fn((change: SettingsChange) => void (state.settings = applySettingsChange(state.settings, change)));
  await act(async () => createRoot(el).render(createElement(SettingsContext.Provider, { value: { settings: state.settings, update, save: async () => {} } }, createElement(ModelPicker, props))));
  await act(async () => el.querySelector<HTMLButtonElement>('.popover > button')!.click());
  return { el, state, update };
}

describe('ModelPicker', () => {
  it('a provider with nothing registered lists all, as before; recent models come first', async () => {
    const { el } = await picker({ providers: [provider('a'), provider('b')], recentModels: ['b|b2', 'gone|x', 'a|a1'] }, { providerId: 'a', model: 'a1' });
    expect(groups(el)).toEqual([
      ['Recent', 'b2 · B', '● a1 · A'],
      ['A', '● a1', 'a2', 'a3'],
      ['B', 'b1', 'b2'],
    ]);
  });

  it('lists only the registered models, the default and the one chosen; Show all lists the rest; the filter looks through all', async () => {
    const { el } = await picker({ providers: [provider('a', { models: ['a3'], defaultModel: 'a1' })] }, { providerId: 'a', model: 'typed-id' });
    expect(groups(el)).toEqual([['A', 'a1', 'a3', '● typed-id']]);
    expect(el.textContent).toContain('1 of 3 registered');
    await act(async () => el.querySelector<HTMLButtonElement>('.model-show-all')!.click());
    expect(groups(el)).toEqual([['A', 'a1', 'a3', 'a2', '● typed-id']]);
    expect(el.querySelector('.model-show-all')!.textContent).toBe('Show registered');
    await act(async () => el.querySelector<HTMLButtonElement>('.model-show-all')!.click());
    await type(el.querySelector('input')!, 'a2');
    expect(groups(el)).toEqual([['A', 'a2']]);
  });

  it('no Show all when the server lists no more than those registered, or cannot list them', async () => {
    const { el } = await picker({ providers: [provider('b', { models: ['b1', 'b2'] }), provider('c', { models: ['c1'] })] }, { providerId: 'b', model: 'b1' });
    expect(el.querySelector('.model-show-all')).toBeNull();
    expect(groups(el)).toEqual([['B', '● b1', 'b2'], ['C', 'c1']]);
    expect(el.textContent).toContain('could not list models · 1 registered');
  });

  it('a pick is the chat’s model and the first recent one; an agent’s pick leaves the chat’s model alone', async () => {
    const chat = await picker({ providers: [provider('a')], activeProviderId: 'a', activeModel: 'a1' }, { providerId: 'a', model: 'a1' });
    await act(async () => option(chat.el, 'a2').click());
    expect(chat.state.settings).toMatchObject({ activeProviderId: 'a', activeModel: 'a2', recentModels: ['a|a2'] });

    const onPick = vi.fn();
    const agent = await picker({ providers: [provider('a')], activeProviderId: 'a', activeModel: 'a1', recentModels: ['a|a1'] }, { providerId: 'a', model: 'a1', onPick });
    await act(async () => option(agent.el, 'a3').click());
    expect(onPick).toHaveBeenCalledWith('a', 'a3');
    expect(agent.state.settings).toMatchObject({ activeModel: 'a1', recentModels: ['a|a3', 'a|a1'] });
  });
});

// The field with the provider's list as Settings → Providers gives it.
async function field(p: ProviderConfig, listed: Parameters<typeof PickerModelsField>[0]['listed'] = { status: 'ok', ids: LISTED[p.id]!, refresh: () => {} }) {
  const el = box();
  const onChange = vi.fn();
  await act(async () => createRoot(el).render(createElement(PickerModelsField, { provider: p, listed, onChange })));
  const boxes = () => [...el.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].map((b) => [b.parentElement!.textContent, b.checked]);
  const filter = el.querySelector<HTMLInputElement>('input.mono')!;
  const enter = () => act(async () => filter.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  return { el, onChange, boxes, filter, enter };
}

describe('PickerModelsField', () => {
  it('a tick registers a model; unticking the last lists all again', async () => {
    const { el, onChange, boxes } = await field(provider('a'));
    expect(el.textContent).toContain('None registered');
    expect(boxes()).toEqual([['a1', false], ['a2', false], ['a3', false]]);
    await act(async () => el.querySelectorAll<HTMLInputElement>('input[type=checkbox]')[1]!.click());
    expect(onChange).toHaveBeenLastCalledWith(['a2']);
    const one = await field(provider('a', { models: ['a2'] }));
    await act(async () => one.el.querySelectorAll<HTMLInputElement>('input[type=checkbox]')[1]!.click());
    expect(one.onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('shows a registered model its server does not list, and leaves it out of the count', async () => {
    const { el, boxes } = await field(provider('a', { models: ['a2', 'gone'] }));
    expect(el.textContent).toContain('1 of 3 registered');
    expect(boxes()).toEqual([['a1', false], ['a2', true], ['a3', false], ['gone (its server does not list it)', true]]);
  });

  it('Enter ticks the model named exactly, registers an id nothing matches, and does nothing on a part of a name', async () => {
    const { onChange, filter, enter } = await field(provider('a', { models: ['a2'] }));
    await type(filter, 'a');
    await enter();
    expect(onChange).not.toHaveBeenCalled();
    await type(filter, 'a3');
    await enter();
    expect(onChange).toHaveBeenLastCalledWith(['a2', 'a3']);
    await type(filter, 'my-model');
    await enter();
    expect(onChange).toHaveBeenLastCalledWith(['a2', 'my-model']);
  });

  it('when the server cannot list its models, still shows and counts those registered', async () => {
    const { el, boxes } = await field(provider('c', { models: ['c1'] }), { status: 'error', refresh: () => {} });
    expect(el.textContent).toContain('1 registered · could not list its models');
    expect(boxes()).toEqual([['c1', true]]);
  });
});

describe('ModelIdInput', () => {
  it('suggests the default and registered models without asking the server', async () => {
    fetchModels.mockClear();
    const el = box();
    await act(async () => createRoot(el).render(createElement(ModelIdInput, { provider: provider('a', { defaultModel: 'a1', models: ['a3'] }), value: '', onChange: () => {} })));
    expect([...el.querySelectorAll('datalist option')].map((o) => (o as HTMLOptionElement).value)).toEqual(['a1', 'a3']);
    expect(el.querySelector('input')!.getAttribute('list')).toBe(el.querySelector('datalist')!.id);
    expect(fetchModels).not.toHaveBeenCalled();
  });
});
