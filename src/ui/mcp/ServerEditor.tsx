// A server's editor: where it is, how it lets you in (headers, a provider's key, or signing in when it
// asks), and how its tools are offered; beside them, a test of what is set here (unsaved), its tools as
// the model sees them, and the checks.
import type { ToolMatchMode } from '../../tools/match';
import { offerChange, offerOf, type Offer } from '../../mcp/config';
import { useState } from 'react';
import { errorText } from '../../core/errors';
import { CHARS_PER_TOKEN } from '../../context/budget';
import { toWireName } from '../../core/tool-registry';
import { MAX_TOOL_TIMEOUT_SECONDS, parseHeaders, serverHeaders, serverName, serverProblems, type McpServerConfig } from '../../mcp/config';
import { connectAndList } from '../../mcp/manager';
import { redirectUrl, SignInNeeded } from '../../mcp/oauth';
import type { ProviderConfig } from '../../storage/settings';
import { allowSite } from '../ask-permission';
import { BackToList, EditorFooter, Switch } from '../Collection';
import { NumberedStep } from '../SectionParts';
import { Segmented } from '../Segmented';

type Access = 'headers' | 'provider' | 'signin';
const ACCESS: { value: Access; label: string }[] = [
  { value: 'headers', label: 'Headers' },
  { value: 'provider', label: "A provider's key" },
  { value: 'signin', label: 'Sign in, if it asks' },
];
const hasAuthorization = (headers: Record<string, string>) => Object.keys(headers).some((h) => h.toLowerCase() === 'authorization');
// How a server lets you in, from what it has: a provider's key, an Authorization header, else signing in
// when the server asks (mcp/oauth: usesOAuth).
const accessOf = (s: McpServerConfig): Access => (s.providerId ? 'provider' : hasAuthorization(s.headers ?? {}) ? 'headers' : 'signin');

type Tried = { tools: { name: string; description?: string; inputSchema?: unknown }[]; transport: string } | { error: string; signIn: boolean };

// The choices of when a server's tools reach the model (mcp/config offerOf), the default named after
// Settings → Tools → Matching's mode as it is set (`mode`).
const MODE_NAMES: Record<ToolMatchMode, string> = { all: 'All tools', recommend: 'Recommended', matching: 'Only matching' };
const HINTS: Record<Exclude<Offer, 'follow'>, string> = {
  always: 'Its tools in every request, whatever your message matches',
  recommend: 'Its tools in every request, and named with your message when it matches them, for the model to prefer them',
  matching: 'Its tools offered only when your message matches them; else listed in tools.load, for the model to load them if needed',
  demand: 'Offered once the model loads them (tools.load), not all of them in every request. For servers with many tools',
};
export const offerChoices = (mode: ToolMatchMode): { id: Offer; label: string; hint: string }[] => [
  { id: 'follow', label: `Same as Tools → Matching (${MODE_NAMES[mode]})`, hint: `As Settings → Tools → Matching is set: ${mode === 'all' ? HINTS.always : HINTS[mode].replace(/^Its/, 'its')}` },
  { id: 'always', label: 'Always offered', hint: HINTS.always },
  { id: 'recommend', label: 'Recommended when it matches', hint: HINTS.recommend },
  { id: 'matching', label: 'Only when it matches', hint: HINTS.matching },
  { id: 'demand', label: 'On demand', hint: HINTS.demand },
];

export function ServerEditor(props: { server: McpServerConfig; servers: McpServerConfig[]; providers: ProviderConfig[]; isNew: boolean; matchMode?: ToolMatchMode; onSave: (s: McpServerConfig) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(props.server);
  const [access, setAccess] = useState<Access>(() => accessOf(props.server));
  const [headers, setHeaders] = useState(JSON.stringify(props.server.headers ?? {}, null, 2));
  const [tried, setTried] = useState<Tried | null>(null);
  const [testing, setTesting] = useState(false);
  const parsed = parseHeaders(headers);
  const setOAuth = (change: NonNullable<McpServerConfig['oauth']>) => {
    const oauth = { ...draft.oauth, ...change };
    setDraft({ ...draft, oauth: Object.values(oauth).some(Boolean) ? oauth : undefined });
  };
  // A provider's key goes in a header: one is suggested when there is none yet.
  const chooseAccess = (a: Access) => {
    setAccess(a);
    if (a === 'provider' && ['', '{}'].includes(headers.replace(/\s/g, ''))) setHeaders(JSON.stringify({ Authorization: 'Bearer {{apiKey}}' }, null, 2));
  };
  // The server as it is saved: only what its way in uses.
  const built = (headers: Record<string, string>): McpServerConfig => ({
    ...draft,
    headers,
    providerId: access === 'provider' ? draft.providerId : undefined,
    oauth: access === 'signin' ? draft.oauth : undefined,
  });
  const problems = [
    ...serverProblems(draft, props.servers),
    ...('problem' in parsed ? [parsed.problem] : []),
    ...(access === 'provider' && !draft.providerId ? ['Choose the provider whose key it uses.'] : []),
    ...(access === 'signin' && 'headers' in parsed && hasAuthorization(parsed.headers) ? ['An Authorization header would take the place of signing in: use Headers instead.'] : []),
  ];

  // Connects with what is set here, unsaved, and lists its tools (nothing is logged or kept).
  const test = async () => {
    if (!('headers' in parsed)) return;
    const server = built(parsed.headers);
    setTesting(true);
    setTried(null);
    try {
      await allowSite(server.url);
      const { tools, transport, client } = await connectAndList(server, serverHeaders(server, props.providers));
      void client.close();
      setTried({ tools, transport });
    } catch (e) {
      setTried({ error: errorText(e), signIn: e instanceof SignInNeeded });
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="editor mcp-editor">
      <BackToList route="mcp" title="MCP servers" />
      <div className="custom-editor-head">
        <h3>{props.isNew ? 'New MCP server' : props.server.name}</h3>
        <span className="section-head-switch" title="Its tools offered to the model">
          On <Switch checked={draft.enabled} label="On: its tools offered to the model" onChange={(enabled) => setDraft({ ...draft, enabled })} />
        </span>
      </div>
      <div className="custom-editor-layout">
        <ol className="numbered-steps">
          <NumberedStep n={1} title="Where">
            <label>Name: its tools are mcp.&lt;name&gt;.&lt;tool&gt;
              <input className="mono" value={draft.name} placeholder="github" onChange={(e) => setDraft({ ...draft, name: serverName(e.target.value) })} />
            </label>
            <label>URL
              <input className="mono" value={draft.url} placeholder="https://example.com/mcp" onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
            </label>
          </NumberedStep>
          <NumberedStep n={2} title="How it lets you in">
            <Segmented label="How it lets you in" className="compact" value={access} onChange={chooseAccess} options={ACCESS} />
            {access === 'provider' && (
              <label>Use the API key of
                <select value={draft.providerId ?? ''} onChange={(e) => setDraft({ ...draft, providerId: e.target.value || undefined })}>
                  <option value="">Choose a provider…</option>
                  {props.providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            )}
            {access === 'signin' && (
              <>
                <p className="hint">
                  A server that wants you signed in shows <strong>Sign in</strong> once tested. Most register the extension themselves; for
                  one that does not, give the client it gave you (its redirect URL: <code>{redirectUrl()}</code>).
                </p>
                <label>Client ID<input value={draft.oauth?.clientId ?? ''} placeholder="(registered by the server)" onChange={(e) => setOAuth({ clientId: e.target.value.trim() || undefined })} /></label>
                <label>Client secret<input type="password" value={draft.oauth?.clientSecret ?? ''} placeholder="(none)" onChange={(e) => setOAuth({ clientSecret: e.target.value.trim() || undefined })} /></label>
                <label>Scope<input value={draft.oauth?.scope ?? ''} placeholder="(what the server asks for)" onChange={(e) => setOAuth({ scope: e.target.value.trim() || undefined })} /></label>
              </>
            )}
            <label>
              {access === 'headers' ? 'Headers (JSON): its key, as Authorization or the header it asks for'
                : access === 'provider' ? "Headers (JSON): {{apiKey}} is the provider's key"
                : 'Other headers (JSON, optional)'}
              <textarea rows={4} className="mono" value={headers} onChange={(e) => setHeaders(e.target.value)} />
            </label>
          </NumberedStep>
          <NumberedStep n={3} title="How its tools are offered">
            <ul className="switch-rows" aria-label="How its tools are offered">
              <li>
                <fieldset className="mcp-offer" aria-label="When its tools reach the model">
                  {offerChoices(props.matchMode ?? 'all').map((o) => (
                    <label key={o.id} className="check">
                      <input type="radio" name="mcp-offer" checked={offerOf(draft) === o.id} onChange={() => setDraft({ ...draft, ...offerChange(o.id) })} />
                      <span><strong>{o.label}</strong><span className="hint">{o.hint}</span></span>
                    </label>
                  ))}
                </fieldset>
              </li>
              <li>
                <div><strong>Trust its read-only hints</strong><span className="hint">The tools it marks read-only run without asking. Off, every tool follows its policy: the hints come from the server itself</span></div>
                <Switch checked={draft.trustReadOnlyHints ?? false} label="Trust its read-only hints" onChange={(on) => setDraft({ ...draft, trustReadOnlyHints: on || undefined })} />
              </li>
              <li>
                <div><strong>Tool timeout</strong><span className="hint">How long a call may take before it is given up on (the server may keep working)</span></div>
                <span className="mcp-timeout">
                  <input type="number" aria-label="Tool timeout (seconds)" min={1} max={MAX_TOOL_TIMEOUT_SECONDS} step={1} value={draft.toolTimeoutSeconds ?? ''} placeholder="60"
                    onChange={(e) => setDraft({ ...draft, toolTimeoutSeconds: e.target.value === '' ? undefined : Number(e.target.value) })} />
                  <span className="hint">s</span>
                </span>
              </li>
            </ul>
          </NumberedStep>
        </ol>
        <aside className="custom-editor-side">
          <div className="custom-side-card">
            <h4>Test it</h4>
            <p className="hint">With what is set here, unsaved.</p>
            <button className="primary mcp-test" onClick={() => void test()} disabled={testing || !draft.url.trim() || !('headers' in parsed)}>{testing ? 'Connecting…' : 'Test connection'}</button>
            {tried && ('error' in tried ? (
              <p className="error-text" role="status">
                {tried.error}
                {tried.signIn && <> Save it, then <strong>Sign in</strong> from its panel.</>}
              </p>
            ) : (
              <p className="try-status good" role="status">✓ {tried.tools.length} tools ({tried.transport})</p>
            ))}
          </div>
          <div className="custom-side-card">
            <h4>As the model sees them</h4>
            {tried && 'tools' in tried ? (
              <>
                <span className="mono small mcp-wire-names">{tried.tools.map((t) => toWireName(`mcp.${draft.name || 'name'}.${t.name}`)).join(', ') || 'No tools'}</span>
                <span className="hint">
                  {draft.onDemand ? 'Loaded on demand: ' : 'In every request: '}~{(Math.round(JSON.stringify(tried.tools).length / CHARS_PER_TOKEN / 100) * 100).toLocaleString('en-US')} tokens
                </span>
              </>
            ) : <span className="hint">Test it to list them: <code>{toWireName(`mcp.${draft.name || 'name'}.tool`)}</code></span>}
          </div>
          <div className="custom-side-card">
            <h4>Checks</h4>
            {problems.length ? <ul className="problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul> : <p className="custom-checks-ok">✓ Ready to save</p>}
          </div>
        </aside>
      </div>
      <div className="editor-sticky-footer">
        <EditorFooter problems={problems} quiet isNew={props.isNew} onClose={props.onClose}
          onSave={() => 'headers' in parsed && props.onSave(built(parsed.headers))} />
      </div>
    </section>
  );
}
