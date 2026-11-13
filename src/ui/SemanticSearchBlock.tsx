// Settings → Memory → Semantic search (memory/semantic): an embeddings model of a configured provider (its
// /models listed with the embeddings looking ones first; any name can be typed, for a server that lists none), its
// match needed, and how far the index went. It says what goes before anything can: the switch waits for
// Test to pass for this provider and model, and turning it on is what starts the first indexing.
import { useEffect, useId, useState } from 'react';
import { MEMORY_INDEX_STATUS_KEY, MEMORY_INDEX_TIMEOUT_MS, type IndexStatus } from '../memory/indexer';
import { MEANING_THRESHOLD } from '../memory/semantic';
import { MatchCard } from './SectionParts';
import { embedTexts, rankEmbeddingModels } from '../providers/embeddings';
import { humanizeError } from '../providers/connection-test';
import { storageGet } from '../storage/area';
import type { SemanticSettings, Settings } from '../storage/settings-types';
import { watchKey } from '../storage/watch';
import { allowSite } from './ask-permission';
import { useProviderModels } from './useProviderModels';
import type { SettingsUpdate } from './useSettings';

interface Props {
  settings: Settings;
  onChange: SettingsUpdate;
}

function useIndexStatus(): IndexStatus | undefined {
  const [status, setStatus] = useState<IndexStatus>();
  useEffect(() => {
    let live = true;
    void storageGet<IndexStatus>('local', MEMORY_INDEX_STATUS_KEY).then((s) => live && setStatus(s));
    const stop = watchKey('local', MEMORY_INDEX_STATUS_KEY, (c) => setStatus(c.newValue as IndexStatus | undefined));
    return () => {
      live = false;
      stop();
    };
  }, []);
  return status;
}

// Saved on leaving the field: another document prefix sends every item again, so not on each key.
function PrefixField({ label, placeholder, value, onCommit }: { label: string; placeholder: string; value: string | undefined; onCommit: (value: string | undefined) => void }) {
  const [typed, setTyped] = useState<string>();
  return (
    <input type="text" aria-label={label} placeholder={placeholder} value={typed ?? value ?? ''} onChange={(e) => setTyped(e.target.value)}
      onBlur={() => {
        if (typed !== undefined && typed !== (value ?? '')) onCommit(typed || undefined);
        setTyped(undefined);
      }} />
  );
}

// The settings with these semantic search settings changed.
const withSemantic = (settings: Settings, change: SemanticSettings): Settings => ({ ...settings, memory: { ...settings.memory, semantic: { ...settings.memory?.semantic, ...change } } });

export function SemanticSearchBlock({ settings, onChange }: Props) {
  const semantic = settings.memory?.semantic ?? {};
  const { providerId, model = '', enabled = false } = semantic;
  const provider = settings.providers.find((p) => p.id === providerId);
  // On the settings as they are by then: Test sets the dimensions after an await.
  const set = (change: SemanticSettings) => onChange((s) => withSemantic(s, change));
  const status = useIndexStatus();
  const models = useProviderModels(provider, rankEmbeddingModels);
  const listId = useId();
  // What Test said, for this provider and model only.
  const key = `${providerId}|${model}`;
  const [test, setTest] = useState<{ key: string; dimensions?: number; message?: string }>();
  const shown = test?.key === key ? test : undefined;
  const canTurnOn = shown?.dimensions !== undefined;
  // Another model has not been tested: it does not go on by itself.
  const setTarget = (change: SemanticSettings) => set({ ...change, enabled: false, dimensions: undefined });
  // Called from a click (user gesture), required by permissions.request.
  const runTest = async () => {
    if (!provider) return;
    setTest({ key, message: 'Testing…' });
    try {
      await allowSite(provider.baseURL);
      const [vector] = await embedTexts(provider, model.trim(), ['test'], AbortSignal.timeout(MEMORY_INDEX_TIMEOUT_MS));
      setTest({ key, dimensions: vector!.length });
      set({ dimensions: vector!.length });
    } catch (e) {
      setTest({ key, message: `Error: ${humanizeError(e, provider.baseURL)}` });
    }
  };
  return (
    <div className="semantic-search">
      <label className="check" title={enabled || canTurnOn ? undefined : 'Test the model first'}>
        <input type="checkbox" checked={enabled} disabled={!enabled && !canTurnOn} onChange={(e) => set({ enabled: e.target.checked })} />
        Also match memory items by meaning
      </label>
      <div className="row semantic-target">
        <label className="inline-label">Provider
          <select aria-label="Embeddings provider" value={provider ? providerId : ''} onChange={(e) => setTarget({ providerId: e.target.value })}>
            {!provider && <option value="" disabled>Choose…</option>}
            {settings.providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="inline-label grow">Embeddings model
          <input type="text" className="mono" list={listId} aria-label="Embeddings model" value={model} onChange={(e) => setTarget({ model: e.target.value })} />
          <datalist id={listId}>{models.map((m) => <option key={m} value={m} />)}</datalist>
        </label>
        <button type="button" disabled={!provider || !model.trim()} onClick={() => void runTest()}>Test</button>
        {shown?.dimensions !== undefined && <span className="badge accent">{shown.dimensions} dimensions</span>}
      </div>
      <p className="hint">Models that look like embeddings are listed first.</p>
      {shown?.message && <p className={shown.message.startsWith('Error') ? 'error-text' : 'muted'}>{shown.message}</p>}
      {providerId && !provider && <p className="error-text">The provider chosen is gone: choose another.</p>}
      <p className="hint">The text of your memory items, and each message you send while this is on, go to this provider. Pinned items don't need it and stay out.</p>
      {enabled && status && <p className="muted small">{status.indexed} of {status.total} items indexed</p>}
      {enabled && status?.error && <p className="error-text">Couldn't index: {status.error}</p>}
      <details className="settings-fold">
        <summary>Model prefixes (optional)</summary>
        <div className="row">
          <label className="inline-label grow">Query prefix
            <PrefixField label="Query prefix" placeholder="query: " value={semantic.queryPrefix} onCommit={(queryPrefix) => set({ queryPrefix })} />
          </label>
          <label className="inline-label grow">Document prefix
            <PrefixField label="Document prefix" placeholder="passage: " value={semantic.documentPrefix} onCommit={(documentPrefix) => set({ documentPrefix })} />
          </label>
        </div>
      </details>
    </div>
  );
}

// How close in meaning an item must be to go, on a card of Settings → Memory's Matching tab.
export function MeaningCard({ settings, onChange }: Props) {
  const semantic = settings.memory?.semantic ?? {};
  const threshold = semantic.threshold ?? MEANING_THRESHOLD;
  return (
    <MatchCard title="Meaning needed" about="How close in meaning, on the embeddings model's own scale" value={`${threshold}%`} off={!semantic.enabled}>
      <input type="range" min={20} max={95} step={5} value={threshold} aria-label="Meaning needed"
        onChange={(e) => { const threshold = Number(e.target.value); onChange((s) => withSemantic(s, { threshold })); }} />
      <p className="hint">{semantic.enabled ? 'Set it by trying messages below: its scale changes from model to model.' : 'Semantic search is off: switch it on in its tab.'}</p>
    </MatchCard>
  );
}
