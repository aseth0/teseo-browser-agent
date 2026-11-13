import { describe, expect, it, vi } from 'vitest';
import type { ProviderConfig } from '../src/storage/settings';

const listModels = vi.fn(async () => [{ id: 'm1' }]);
vi.mock('../src/providers/registry', () => ({ createProvider: () => ({ listModels }) }));
const { fetchModels } = await import('../src/providers/model-list');
const { modelOnEnter } = await import('../src/entrypoints/sidepanel/ModelPicker');

describe('the model Enter picks in the filter', () => {
  const groups = [
    { providerId: 'a', shown: [] },
    { providerId: 'b', shown: ['gpt-4o-mini', 'gpt-4o'] },
  ];
  it('is the one named exactly, else the first match, else none (the text is then an id)', () => {
    expect(modelOnEnter(groups, 'gpt-4o')).toEqual(['b', 'gpt-4o']);
    expect(modelOnEnter(groups, '4o')).toEqual(['b', 'gpt-4o-mini']);
    expect(modelOnEnter([{ providerId: 'a', shown: [] }], 'custom-1')).toBeUndefined();
  });
});

describe('fetchModels', () => {
  const p = { id: 'p', name: 'P', baseURL: 'https://api.example.com/v1', apiKey: 'k1' } as ProviderConfig;
  it('asks once per endpoint and key, and again when the key changes', async () => {
    await fetchModels(p);
    await fetchModels(p);
    expect(listModels).toHaveBeenCalledTimes(1);
    await fetchModels({ ...p, apiKey: 'k2' });
    expect(listModels).toHaveBeenCalledTimes(2);
  });
});
