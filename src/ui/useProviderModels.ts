// A provider's models for a field's <datalist> (Settings → Voice, Memory's Semantic search), in the order
// `rank` gives: module-level, as it is a dependency. None while they load, when it lists none or when it
// fails, nor those of another provider: any name can still be typed.
import { useEffect, useState } from 'react';
import { fetchModels } from '../providers/model-list';
import type { ProviderConfig } from '../storage/settings';

export function useProviderModels(provider: ProviderConfig | undefined, rank: (ids: string[]) => string[]): string[] {
  const [models, setModels] = useState<{ of: string; ids: string[] }>();
  // The provider by what fetchModels uses of it: settings give a new object on every change, and a
  // server that failed would be asked again on each.
  const of = provider && JSON.stringify([provider.id, provider.baseURL, provider.apiKey, provider.extraHeaders ?? null]);
  useEffect(() => {
    if (!provider || !of) return;
    let current = true;
    fetchModels(provider).then(
      (list) => current && setModels({ of, ids: rank(list.map((m) => m.id)) }),
      () => current && setModels({ of, ids: [] }),
    );
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `of` stands for the provider, see above
  }, [of, rank]);
  return models && models.of === of ? models.ids : [];
}
