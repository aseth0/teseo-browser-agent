// Settings → Providers' models in the picker: those of its server's list ticked (and any id typed) are
// the only ones the model pickers list for it, besides its default; none ticked, all are listed
// (providers/registered-models).
import { useMemo, useState } from 'react';
import { registeredCount, toggleRegistered } from '../providers/registered-models';
import type { ProviderConfig } from '../storage/settings';
import { allowSite } from './ask-permission';
import { isEnter } from './enter';
import { InlineConfirm } from './InlineConfirm';
import type { ListedModels } from './useListedModels';

// What Enter does with the text typed in the filter: ticks the model named exactly; registers it when
// no model matches; nothing when some match without one named exactly (a part of a name).
export function enterInFilter(typed: string, shown: string[], registered: string[]): string[] | undefined {
  const id = typed.trim();
  if (!id) return undefined;
  if (shown.includes(id)) return registered.includes(id) ? undefined : toggleRegistered(registered, id);
  return shown.length ? undefined : toggleRegistered(registered, id);
}

// `listed`: the models its server lists (ui/useListedModels), asked by the provider's section.
export function PickerModelsField({ provider, listed, onChange }: { provider: ProviderConfig; listed: ListedModels & { refresh: () => void }; onChange: (models: string[] | undefined) => void }) {
  const [filter, setFilter] = useState('');
  const registered = useMemo(() => provider.models ?? [], [provider.models]);
  const ids = listed.status === 'ok' ? listed.ids : undefined;
  const q = filter.trim().toLowerCase();
  // The server's models, then those registered it does not list (typed, or no longer there).
  const { shown, unlisted } = useMemo(() => {
    const there = new Set(ids ?? []);
    const all = [...new Set([...(ids ?? []), ...registered])];
    return {
      shown: q ? all.filter((m) => m.toLowerCase().includes(q)) : all,
      unlisted: ids ? new Set(registered.filter((m) => !there.has(m))) : new Set<string>(),
    };
  }, [ids, registered, q]);
  const ticked = useMemo(() => new Set(registered), [registered]);
  const refresh = async () => {
    // From a click: the site's permission can be asked for.
    await allowSite(provider.baseURL).catch(() => undefined);
    listed.refresh();
  };
  return (
    <div className="picker-models">
      <div className="picker-models-bar">
        <input aria-label="Filter models, or type a model id and press Enter to register it" className="mono" placeholder="Filter, or type a model id and press Enter" value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (!isEnter(e)) return;
            const next = enterInFilter(filter, shown, registered);
            if (!next) return;
            onChange(next);
            setFilter('');
          }} />
        <button type="button" onClick={() => void refresh()} disabled={!provider.baseURL} title="Asks its server for its models again">↻ Refresh from provider</button>
        {registered.length > 0 && (
          <InlineConfirm question="Unregister them all? The picker lists all its models again." action="Unregister all" label={`Confirm: unregister the models of ${provider.name}`} onConfirm={() => onChange(undefined)}>
            {(ask) => <button type="button" onClick={ask}>Unregister all</button>}
          </InlineConfirm>
        )}
      </div>
      <span className="hint" role="status">
        {registered.length ? registeredCount(provider, ids) : 'None registered: the picker lists all of them'}
        {listed.status === 'loading' && ' · loading its models…'}
        {listed.status === 'error' && ' · could not list its models: type an id and press Enter'}
      </span>
      {shown.length > 0 && (
        <div className="picker-models-list" role="group" aria-label={`${provider.name}: models in the picker`}>
          {shown.map((m) => (
            <label key={m}>
              <input type="checkbox" checked={ticked.has(m)} onChange={() => onChange(toggleRegistered(registered, m))} />
              {m}
              {m === provider.defaultModel && <span className="muted"> (default, always listed)</span>}
              {unlisted.has(m) && <span className="muted"> (its server does not list it)</span>}
            </label>
          ))}
        </div>
      )}
      {!shown.length && q && listed.status !== 'loading' && <span className="hint">No match: Enter registers “{filter.trim()}”</span>}
    </div>
  );
}
