// Model selector: the models last picked, then those of every provider (its registered ones, or all it
// lists: providers/registered-models), grouped, with a filter over all of them and a custom id field.
import { useEffect, useState } from 'react';
import type { FoundContextWindow, ModelInfo } from '../../core/types';
import { learnedContextWindows, onLearnedContextWindows, pickContextWindow, type ContextWindow } from '../../context/window';
import { createProvider } from '../../providers/registry';
import { fetchModels } from '../../providers/model-list';
import { listsMore, pickerModels, recentModels, registeredCount, withPicked } from '../../providers/registered-models';
import type { ProviderConfig, Settings } from '../../storage/settings';
import { Popover } from '../../ui/Popover';
import type { SettingsUpdate } from '../../ui/useSettings';
import { modelKey } from '../../core/util';
import { useSettingsContext } from '../../ui/settings-context';
import { isEnter } from '../../ui/enter';

type ModelList = { status: 'loading' } | { status: 'ok'; models: ModelInfo[] } | { status: 'error' };

const endpoint = (p: ProviderConfig) => `${p.id}|${p.baseURL}`;
const LOADING: ModelList = { status: 'loading' };

// Each provider's models, asked again only when a provider or its URL changes (settings give new
// objects on every change). One still being asked, or new, is loading.
export function useModelLists(providers: ProviderConfig[]): (p: ProviderConfig) => ModelList {
  const [lists, setLists] = useState<Record<string, ModelList>>({});
  const key = providers.map(endpoint).join('\n');
  useEffect(() => {
    let current = true;
    for (const p of providers) {
      const set = (list: ModelList) => current && setLists((l) => ({ ...l, [endpoint(p)]: list }));
      fetchModels(p).then((models) => set({ status: 'ok', models }), () => set({ status: 'error' }));
    }
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the providers by what is asked of them: settings give a new array on every change
  }, [key]);
  return (p) => lists[endpoint(p)] ?? LOADING;
}

// What the server says of a model's window, asked once per panel session and endpoint.
const found = new Map<string, Promise<FoundContextWindow | undefined>>();
function findWindow(p: ProviderConfig, model: string): Promise<FoundContextWindow | undefined> {
  const key = `${p.id}|${p.baseURL}|${model}`;
  if (!found.has(key)) {
    // A server that did not answer is asked again next time, as fetchModels does, instead of
    // leaving the model without a window for the rest of the session.
    const forget = () => {
      found.delete(key);
      return undefined;
    };
    const request = fetchModels(p).then(
      (ms) => createProvider(p).contextWindow?.(model, ms),
      () => createProvider(p).contextWindow?.(model).then((w) => w ?? forget()),
    );
    found.set(key, request.catch(forget));
  }
  return found.get(key)!;
}

// Context window of a model (context/window pickContextWindow), and setting it for that model (none
// without a provider and model): undefined goes back to as found.
export function useContextWindow(settings: Settings, onChange: SettingsUpdate, provider: ProviderConfig | undefined, model: string): { window: ContextWindow; set?: (tokens: number | undefined) => void } {
  const key = provider ? modelKey(provider.id, model) : '';
  const [fromServer, setFromServer] = useState<FoundContextWindow>();
  const [learned, setLearned] = useState<Record<string, number>>({});
  const set = key ? settings.contextWindows?.[key] : undefined;
  useEffect(() => {
    void learnedContextWindows().then(setLearned);
    return onLearnedContextWindows(setLearned);
  }, []);
  useEffect(() => {
    setFromServer(undefined);
    if (!provider || !model || set) return;
    let current = true;
    void findWindow(provider, model).then((w) => current && setFromServer(w));
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the provider by what findWindow uses of it: settings give a new object on every change
  }, [provider?.id, provider?.baseURL, model, set]);
  const setForModel = (tokens: number | undefined) => {
    onChange((s) => {
      const { [key]: _old, ...others } = s.contextWindows ?? {};
      return { ...s, contextWindows: tokens ? { ...others, [key]: tokens } : others };
    });
  };
  return {
    window: pickContextWindow({ model: set, learned: learned[key], found: fromServer, provider: provider?.contextWindow }),
    ...(provider && model && { set: setForModel }),
  };
}

interface Props {
  providerId?: string;
  model: string;
  onPick?: (providerId: string, model: string) => void; // instead of choosing the chat's model (an agent's)
}

export function ModelPicker({ providerId, model, onPick }: Props) {
  const { settings, update: onChange } = useSettingsContext();
  const current = settings.providers.find((p) => p.id === providerId);
  return (
    <Popover title={current ? `Model: ${model || '(none)'} · ${current.name}` : 'Choose a model'} label={<ModelIcon />}>
      {(close) => (
        <ModelList
          settings={settings}
          selected={{ providerId, model }}
          onSelect={(activeProviderId, activeModel) => {
            // An agent's model is its own (onPick): the chat's stays.
            if (onPick) onPick(activeProviderId, activeModel);
            onChange((s) => withPicked(s, activeProviderId, activeModel, { chat: !onPick }));
            close();
          }}
        />
      )}
    </Popover>
  );
}

// The model Enter picks in the filter: the one named exactly, else the first that matches; none when
// nothing matches (the text typed is then a model id of its own, on the current provider).
export function modelOnEnter(groups: { providerId: string; shown: string[] }[], typed: string): [string, string] | undefined {
  const exact = groups.find((g) => g.shown.includes(typed));
  if (exact) return [exact.providerId, typed];
  const first = groups.find((g) => g.shown.length);
  return first && [first.providerId, first.shown[0]!];
}

function ModelList({
  settings,
  selected,
  onSelect,
}: {
  settings: Settings;
  selected: { providerId?: string; model: string };
  onSelect: (providerId: string, model: string) => void;
}) {
  const [filter, setFilter] = useState('');
  const [allOf, setAllOf] = useState<string[]>([]); // the providers whose models are all shown, registered or not
  const listOf = useModelLists(settings.providers);
  const q = filter.trim().toLowerCase();

  if (!settings.providers.length) return <p className="hint">Add a provider in Settings.</p>;
  const groups = settings.providers.map((p) => {
    const list = listOf(p);
    const listed = list.status === 'ok' ? list.models.map((m) => m.id) : [];
    // The filter looks through all of a provider's models, registered or not.
    const all = Boolean(q) || allOf.includes(p.id);
    const models = pickerModels(p, listed, { all, ...(p.id === selected.providerId && { selected: selected.model }) });
    return { p, list, listed, all, shown: models.filter((m) => !q || m.toLowerCase().includes(q)) };
  });
  const nameOf = (id: string) => settings.providers.find((p) => p.id === id)?.name ?? '';
  const recent = q ? [] : recentModels(settings.recentModels, settings.providers);
  const option = (providerId: string, m: string, provider?: string) => {
    const isSelected = providerId === selected.providerId && m === selected.model;
    return (
      <button key={`${providerId}|${m}`} className={`model-option ${isSelected ? 'selected' : ''}`} onClick={() => onSelect(providerId, m)}>
        {isSelected ? '● ' : ''}{m}{provider && <span className="muted"> · {provider}</span>}
      </button>
    );
  };
  return (
    <div className="model-list">
      <input autoFocus placeholder="Filter models, or type a model id and press Enter" value={filter} onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => {
          const id = filter.trim();
          if (!isEnter(e) || !id) return;
          const [providerId, model] = modelOnEnter(groups.map(({ p, shown }) => ({ providerId: p.id, shown })), id) ?? [selected.providerId ?? settings.providers[0]!.id, id];
          onSelect(providerId, model);
        }}
      />
      {recent.length > 0 && (
        <div className="model-group">
          <div className="model-group-title">Recent</div>
          {recent.map((r) => option(r.providerId, r.model, nameOf(r.providerId)))}
        </div>
      )}
      {groups.map(({ p, list, listed, all, shown }) => {
        const registered = p.models?.length ?? 0;
        return (
          <div key={p.id} className="model-group">
            <div className="model-group-title">
              {p.name}
              {list.status === 'loading' && <span className="muted"> · loading…</span>}
              {list.status === 'error' && <span className="muted"> · could not list models</span>}
              {registered > 0 && !q && <span className="muted"> · {registeredCount(p, list.status === 'ok' ? listed : undefined)}</span>}
              {/* Only when the server lists more than those registered: else it would do nothing. */}
              {!q && listsMore(p, listed) && (
                <button type="button" className="link-button model-show-all" aria-pressed={all}
                  onClick={() => setAllOf((ids) => (all ? ids.filter((id) => id !== p.id) : [...ids, p.id]))}>
                  {all ? 'Show registered' : 'Show all'}
                </button>
              )}
            </div>
            {shown.map((m) => option(p.id, m))}
            {!shown.length && list.status !== 'loading' && <div className="muted model-empty">{q ? 'No match' : 'No models'}</div>}
          </div>
        );
      })}
    </div>
  );
}

function ModelIcon() {
  // A small "chip" glyph, drawn with currentColor so it follows the theme.
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="4" y="4" width="8" height="8" rx="1.5" />
      <rect x="6.5" y="6.5" width="3" height="3" rx="0.5" fill="currentColor" stroke="none" />
      <path d="M6 1.5v2M10 1.5v2M6 12.5v2M10 12.5v2M1.5 6h2M1.5 10h2M12.5 6h2M12.5 10h2" strokeLinecap="round" />
    </svg>
  );
}
