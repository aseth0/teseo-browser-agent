// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { ProviderConfig } from '../src/storage/settings';

// The model picker asks a provider's server again only when the provider or its URL changes: not on
// every change of the settings, which give new objects each time.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const asked: { url: string; answer: (ids: string[]) => void }[] = [];
const fetchModels = vi.fn((p: ProviderConfig) => new Promise((resolve) => asked.push({ url: p.baseURL, answer: (ids) => resolve(ids.map((id) => ({ id }))) })));
vi.mock('../src/providers/model-list', () => ({ fetchModels }));
const { useModelLists } = await import('../src/entrypoints/sidepanel/ModelPicker');

let listOf: ReturnType<typeof useModelLists>;
function Probe({ providers }: { providers: ProviderConfig[] }) {
  listOf = useModelLists(providers);
  return null;
}
const provider = (id: string, baseURL: string) => ({ id, name: id, baseURL, apiKey: '' }) as ProviderConfig;

describe('useModelLists', () => {
  it('asks once per provider and URL, each loading until it answers; a late answer for an old URL is dropped', async () => {
    const root = createRoot(document.createElement('div'));
    const a = provider('a', 'https://a.example.com/v1');
    await act(async () => root.render(createElement(Probe, { providers: [a] })));
    expect(listOf(a)).toEqual({ status: 'loading' });
    await act(async () => asked[0]!.answer(['m1']));
    expect(listOf(a)).toEqual({ status: 'ok', models: [{ id: 'm1' }] });
    // Other settings changed: the same providers, as new objects.
    await act(async () => root.render(createElement(Probe, { providers: [{ ...a }] })));
    expect(fetchModels).toHaveBeenCalledTimes(1);
    // A new provider: only it loads (the first is asked again, from fetchModels' cache).
    const b = provider('b', 'https://b.example.com/v1');
    await act(async () => root.render(createElement(Probe, { providers: [a, b] })));
    expect(listOf(a).status).toBe('ok');
    expect(listOf(b)).toEqual({ status: 'loading' });
    // b's URL changes before it answers: its old answer does not land on the new URL, nor anywhere.
    const b2 = provider('b', 'https://b2.example.com/v1');
    await act(async () => root.render(createElement(Probe, { providers: [a, b2] })));
    await act(async () => asked.find((q) => q.url === b.baseURL)!.answer(['old']));
    expect(listOf(b)).toEqual({ status: 'loading' });
    expect(listOf(b2)).toEqual({ status: 'loading' });
    await act(async () => asked.findLast((q) => q.url === b2.baseURL)!.answer(['new']));
    expect(listOf(b2)).toEqual({ status: 'ok', models: [{ id: 'new' }] });
    act(() => root.unmount());
  });
});
