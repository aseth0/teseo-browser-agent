// The models a provider's server lists, for Settings → Providers' fields (its default model, its models in
// the picker): asked once for the provider shown, again by `refresh` (Test connection, Refresh from
// provider), which skips what was kept.
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchModels } from '../providers/model-list';
import type { ProviderConfig } from '../storage/settings';

export type ListedModels = { status: 'loading' } | { status: 'ok'; ids: string[] } | { status: 'error' };
const LOADING: ListedModels = { status: 'loading' };

export function useListedModels(provider: ProviderConfig | undefined): ListedModels & { refresh: () => void } {
  // The provider by what fetchModels uses of it: settings give a new object on every change.
  const of = provider && JSON.stringify([provider.id, provider.baseURL, provider.apiKey, provider.extraHeaders ?? null]);
  const [listed, setListed] = useState<{ id?: string; list: ListedModels }>({ list: LOADING });
  const latest = useRef(provider);
  latest.current = provider;
  const request = useRef(0); // only the latest answer is shown
  // `alive`: false once the provider asked for has changed.
  const ask = useCallback((p: ProviderConfig, fresh: boolean, alive: () => boolean = () => true) => {
    const n = ++request.current;
    const set = (list: ListedModels) => n === request.current && alive() && setListed({ id: p.id, list });
    if (!p.baseURL) return set({ status: 'error' });
    fetchModels(p, { fresh }).then((ms) => set({ status: 'ok', ids: ms.map((m) => m.id) }), () => set({ status: 'error' }));
  }, []);
  useEffect(() => {
    if (!latest.current) return;
    const p = latest.current;
    // Not on every key typed in the base URL or the API key.
    let current = true;
    const timer = setTimeout(() => ask(p, false, () => current), 400);
    return () => {
      current = false; // an answer for the provider as it was is dropped
      clearTimeout(timer);
    };
  }, [of, ask]);
  const refresh = useCallback(() => latest.current && ask(latest.current, true), [ask]);
  // Another provider's list is never shown; this one's stays while it is asked again (its key typed).
  return { ...(listed.id === provider?.id ? listed.list : LOADING), refresh };
}
