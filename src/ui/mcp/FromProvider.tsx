// The servers a provider offers (a LiteLLM gateway): checked when you pick it, ticked and added
// together; the ones already added (the same address) are marked so.
import { useState } from 'react';
import { errorText } from '../../core/errors';
import type { McpServerConfig } from '../../mcp/config';
import { offeredServers, providerServer, type OfferedServer } from '../../mcp/provider';
import type { ProviderConfig } from '../../storage/settings';
import { allowSite } from '../ask-permission';

const GATEWAY = ''; // the key of "all of them": the gateway as one server

// The address a server is reached at, as compared (no trailing slash, any case).
const urlKey = (url: string) => url.trim().replace(/\/+$/, '').toLowerCase();

export function FromProvider({ providers, servers, onAdd, onClose }: { providers: ProviderConfig[]; servers: McpServerConfig[]; onAdd: (servers: McpServerConfig[]) => void; onClose: () => void }) {
  const [providerId, setProviderId] = useState(providers[0]?.id ?? '');
  // What the check found, with the provider it was for: one that ends after another provider is
  // picked is not shown, nor are its servers added with that other provider's key.
  const [checked, setChecked] = useState<{ providerId: string; found: OfferedServer[] | string } | null>(null);
  const found = checked?.providerId === providerId ? checked.found : null;
  const [picked, setPicked] = useState<Set<string>>(new Set()); // offered names, GATEWAY for the gateway
  const provider = providers.find((p) => p.id === providerId);
  const check = async () => {
    if (!provider) return;
    // Only while this provider's check is the one shown (another picked since: none, or its own).
    const setFound = (found: OfferedServer[] | string) => setChecked((c) => (c?.providerId === provider.id ? { providerId: provider.id, found } : c));
    setChecked({ providerId: provider.id, found: 'Checking…' });
    setPicked(new Set());
    try {
      await allowSite(provider.baseURL);
      setFound(await offeredServers(provider));
    } catch (e) {
      setFound(`Error: ${errorText(e)}`);
    }
  };
  const added = new Map(servers.map((s) => [urlKey(s.url), s.name]));
  const configOf = (key: string) => {
    const offered = Array.isArray(found) ? found.find((s) => s.name === key) : undefined;
    return providerServer(provider!, key === GATEWAY ? undefined : offered);
  };
  const addedAs = (key: string) => (provider ? added.get(urlKey(configOf(key).url)) : undefined);
  const toggle = (key: string, on: boolean) => setPicked((p) => {
    const next = new Set(p);
    if (on) next.add(key);
    else next.delete(key);
    return next;
  });
  const row = (key: string, name: string, about?: string) => {
    const already = addedAs(key);
    return (
      <li key={key || 'gateway'} className={already ? 'added' : undefined}>
        <label className="check">
          <input type="checkbox" checked={!!already || picked.has(key)} disabled={!!already} aria-label={`Add ${name}`} onChange={(e) => toggle(key, e.target.checked)} />
          <span><strong>{name}</strong>{about && <span className="muted"> — {about}</span>}</span>
        </label>
        {already && <span className="badge" title={`Added as ${already}`}>added{already !== name ? ` as ${already}` : ''}</span>}
      </li>
    );
  };
  const free = Array.isArray(found) ? [...found.map((s) => s.name), GATEWAY].filter((k) => !addedAs(k)) : [];
  return (
    <div className="card mcp-from-provider">
      <label>Provider
        <select value={providerId} onChange={(e) => {
          setProviderId(e.target.value);
          setChecked(null);
          setPicked(new Set());
        }}>
          {providers.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.baseURL}</option>)}
        </select>
      </label>
      <p className="hint">Asks the provider which MCP servers it offers (a LiteLLM proxy lists them at /v1/mcp/server). They use the provider's API key.</p>
      <div className="row">
        <button onClick={() => void check()} disabled={!provider}>Check this provider</button>
        <span className="spacer" />
        <button onClick={onClose}>Close</button>
      </div>
      {typeof found === 'string' && <p className={found.startsWith('Error') ? 'error-text' : 'muted'}>{found}</p>}
      {Array.isArray(found) && provider && (
        found.length ? (
          <>
            {free.length > 1 && (
              <label className="check mcp-pick-all">
                <input type="checkbox" checked={free.every((k) => picked.has(k))} onChange={(e) => setPicked(e.target.checked ? new Set(free) : new Set())} />
                Select all not added yet
              </label>
            )}
            <ul className="mcp-offered">
              {found.map((s) => row(s.name, s.name, s.description))}
              {row(GATEWAY, 'All of them', 'the gateway, one server with every tool')}
            </ul>
            <div className="row">
              <button className="primary" disabled={!picked.size} onClick={() => onAdd([...picked].map(configOf))}>
                Add {picked.size || ''} {picked.size === 1 ? 'server' : 'servers'}
              </button>
              <span className="hint">They are tested once added.</span>
            </div>
          </>
        ) : (
          <p className="muted">The provider offers no MCP servers to this key.</p>
        )
      )}
    </div>
  );
}
