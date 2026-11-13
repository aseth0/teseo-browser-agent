// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { ProviderConfig } from '../src/storage/settings';

// Settings → Providers asks a provider's models once for both its fields, and again, skipping what was
// kept, only when refreshed.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const fetchModels = vi.fn(async (_p: ProviderConfig, _o?: { fresh?: boolean }) => [{ id: 'm1' }]);
vi.mock('../src/providers/model-list', () => ({ fetchModels }));
const { useListedModels } = await import('../src/ui/useListedModels');

let listed: ReturnType<typeof useListedModels>;
function Probe({ provider }: { provider: ProviderConfig }) {
  listed = useListedModels(provider);
  return null;
}
const provider = { id: 'a', name: 'A', baseURL: 'https://a.example.com/v1', apiKey: '', defaultModel: '' } as ProviderConfig;

describe('useListedModels', () => {
  it('asks once after a pause, again only on refresh (fresh) or when the key changes', async () => {
    vi.useFakeTimers();
    try {
      const root = createRoot(document.createElement('div'));
      await act(async () => root.render(createElement(Probe, { provider })));
      expect(listed.status).toBe('loading');
      await act(async () => void (await vi.advanceTimersByTimeAsync(500)));
      expect(listed).toMatchObject({ status: 'ok', ids: ['m1'] });
      await act(async () => root.render(createElement(Probe, { provider: { ...provider } })));
      await act(async () => void (await vi.advanceTimersByTimeAsync(500)));
      expect(fetchModels).toHaveBeenCalledTimes(1);
      await act(async () => listed.refresh());
      expect(fetchModels).toHaveBeenLastCalledWith(provider, { fresh: true });
      await act(async () => root.render(createElement(Probe, { provider: { ...provider, apiKey: 'k' } })));
      expect(listed.status).toBe('ok'); // the list shown stays while it is asked again
      await act(async () => void (await vi.advanceTimersByTimeAsync(500)));
      expect(fetchModels).toHaveBeenCalledTimes(3);
      expect(fetchModels).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: 'k' }), { fresh: false });
    } finally {
      vi.useRealTimers();
    }
  });
});
