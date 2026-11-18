// Settings → MCP servers: the remote servers whose tools are offered to the model (mcp.<server>.<tool>).
// Added by URL, from a provider that offers them (a LiteLLM gateway, with the provider's key; several at
// once), or imported in the mcpServers format. One line each (on, status, its way in, policy); a click
// opens it in a side panel (test, sign in, its tools, its logs), Edit its editor.
import { toolMatchMode, type ToolMatchMode } from '../../tools/match';
import { useEffect, useState } from 'react';
import { serverPolicyHost } from '../../core/mcp-keys';
import { exportServers, importServers, offerChange, offerOf, type McpServerConfig, type Offer } from '../../mcp/config';
import { latestStatus, type McpLogEntry } from '../../mcp/logs';
import { addServers, removeServer, updateServer, type SaveServers } from '../../mcp/servers';
import { onSignInChanged, signedIn, signOut, usesOAuth } from '../../mcp/oauth';
import { NoSuchItem, Switch } from '../Collection';
import { ModelTextEditor } from '../EditableText';
import { ImportExport, imported } from '../ImportExport';
import { InlineConfirm } from '../InlineConfirm';
import { PageModelTexts } from '../PageModelTexts';
import { PolicySelect } from '../PolicySelect';
import { SectionHead, SectionTabs, StatStrip } from '../SectionParts';
import { useSettingsContext } from '../settings-context';
import { useHashEditor } from '../useCollectionScreen';
import { useMcpLogs } from '../useMcpLogs';
import type { SectionProps as Props } from '../useSettings';
import { useSitePolicies } from '../useSitePolicies';
import { FromProvider } from './FromProvider';
import { offerChoices, ServerEditor } from './ServerEditor';
import { ServerLogs } from './ServerLogs';
import { ServerStatus, SignIn, StatusLine } from './ServerStatus';
import { useMcpServerActions } from './useMcpServerActions';

// One added by URL (#mcp/new).
const newServer = (): McpServerConfig => ({ id: crypto.randomUUID(), name: '', url: '', headers: {}, enabled: true });

// How a server's tools reach the model, on its line: on demand, always, or matched (Settings → Tools →
// Matching, when it is not All tools).
const offerNote = (s: McpServerConfig, mode: ToolMatchMode) => {
  const offer = offerOf(s);
  const now = offer === 'follow' ? (mode === 'all' ? 'always' : mode) : offer;
  return now === 'demand' ? ' · on demand' : now === 'recommend' ? ' · recommended when it matches' : now === 'matching' ? ' · only when it matches' : offer === 'always' && mode !== 'all' ? ' · always offered' : '';
};

// A server's "what it is for": saved on leaving the field (each key would index its text again).
function AboutField({ label, value, onCommit }: { label: string; value: string | undefined; onCommit: (value: string | undefined) => void }) {
  const [typed, setTyped] = useState<string>();
  return (
    <textarea rows={2} aria-label={label} placeholder="e.g. tasks, to-dos, reminders, projects" value={typed ?? value ?? ''} onChange={(e) => setTyped(e.target.value)}
      onBlur={() => {
        if (typed !== undefined && typed.trim() !== (value ?? '')) onCommit(typed.trim() || undefined);
        setTyped(undefined);
      }} />
  );
}

export function McpSection({ settings, onChange }: Props) {
  const servers = settings.mcpServers ?? [];
  const actions = useMcpServerActions(settings.providers);
  const { testing, test } = actions;
  const logs = useMcpLogs();
  // The server whose editor is open lives in the hash (#mcp/<id>; #mcp/new: one added by URL), as on the
  // other screens of stored items: Back closes the editor, and it can be linked.
  const { target, editing, open: openEditor, close: closeEditor } = useHashEditor('mcp', servers, true, newServer);
  const [adding, setAdding] = useState(false); // from a provider
  const [withKeys, setWithKeys] = useState(false); // the export with the headers' values
  const [panel, setPanel] = useState<string | null>(null); // the server open in the side panel
  const [policies, setPolicy] = useSitePolicies();
  const [signed, setSigned] = useState<Set<string>>(new Set()); // server ids signed in with OAuth
  const signedKey = servers.map((s) => `${s.id} ${s.url}`).join('\n'); // `servers` is a new list on every render
  useEffect(() => {
    const load = () => void signedIn(servers).then(setSigned);
    load();
    return onSignInChanged(load);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by signedKey (servers' content)
  }, [signedKey]);

  const { save } = useSettingsContext();
  const saveServers: SaveServers = (change) => save((prev) => ({ ...prev, mcpServers: change(prev.mcpServers ?? []) }));
  const patch = (id: string, change: Partial<McpServerConfig>) => onChange((prev) => ({ ...prev, mcpServers: (prev.mcpServers ?? []).map((s) => (s.id === id ? { ...s, ...change } : s)) }));
  const failed = (e: unknown) => console.error('[mcp]', e);

  if (editing) {
    const isNew = !servers.some((s) => s.id === editing.id);
    return (
      <ServerEditor key={editing.id} server={editing} servers={servers} providers={settings.providers} isNew={isNew} matchMode={toolMatchMode(settings)} onClose={closeEditor}
        // Closed once saved; one not saved stays open (the page says why).
        onSave={(s) => void (isNew ? addServers(saveServers, [s]) : updateServer(saveServers, s)).then(closeEditor, failed)} />
    );
  }
  if (target) return <NoSuchItem route="mcp" noun="MCP server" target={target} />;

  const statusOf = (s: McpServerConfig) => latestStatus(logs, s.name);
  const on = servers.filter((s) => s.enabled);
  const ok = on.filter((s) => statusOf(s)?.ok);
  const toSignIn = on.filter((s) => statusOf(s)?.signIn);
  const tools = (s: McpServerConfig) => (statusOf(s)?.ok ? statusOf(s)?.tools?.length ?? 0 : 0);
  const allTools = on.reduce((n, s) => n + tools(s), 0);
  const onDemandTools = on.filter((s) => s.onDemand).reduce((n, s) => n + tools(s), 0);
  const open = servers.find((s) => s.id === panel);

  const list = (
    <>
      {/* Imported ones start off, under a name no other server has: test them first. */}
      <ImportExport noun="MCP servers" label="mcpServers" fileName="mcp-servers.json" count={servers.length} exportJson={() => exportServers(servers, withKeys)}
        exportItems={[{ label: 'Include keys and header values', checked: withKeys, onToggle: setWithKeys }]}
        placeholder={'{ "mcpServers": { "name": { "url": "https://…/mcp", "headers": { … } } } }'}
        importJson={async (json) => {
          const { servers: read, skipped } = importServers(json, servers);
          const named = await addServers(saveServers, read);
          return imported(named.map((s) => s.name), skipped.map((n) => `${n}: local servers (command) are not supported yet.`), 'MCP servers', 'test them first');
        }}>
        <button className="primary" onClick={() => openEditor('new')}>＋ By URL</button>
        <button onClick={() => setAdding(!adding)} aria-expanded={adding}>＋ From a provider…</button>
      </ImportExport>
      {adding && (
        <FromProvider providers={settings.providers} servers={servers} onClose={() => setAdding(false)} onAdd={(list) => {
          void addServers(saveServers, list).then((named) => Promise.all(named.map(test))).catch(failed);
          setAdding(false);
        }} />
      )}
      <div className="mcp-servers">
        {servers.map((s) => (
          <div key={s.id} className={`mcp-server${s.enabled ? '' : ' off'}${panel === s.id ? ' open' : ''}`} role="button" tabIndex={0} aria-label={`${s.name}: open`}
            onClick={() => setPanel(s.id)} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setPanel(s.id); } }}>
            <span onClick={(e) => e.stopPropagation()}><Switch checked={s.enabled} label={`${s.name}: on`} onChange={(enabled) => patch(s.id, { enabled })} /></span>
            <span className="mcp-server-main">
              <strong>{s.name}</strong>
              <span className="mono small muted">{s.url}{offerNote(s, toolMatchMode(settings))}</span>
            </span>
            <StatusLine entry={statusOf(s)} testing={testing.has(s.id)} />
            <span onClick={(e) => e.stopPropagation()}>
              {statusOf(s)?.signIn && usesOAuth(s) && !testing.has(s.id)
                ? <button className="primary" onClick={() => void actions.signInTo(s, actions.needsAccess[s.id])}>Sign in</button>
                : <span className="badge">{accessLabel(s, settings.providers)}</span>}
            </span>
            <span onClick={(e) => e.stopPropagation()}>
              <PolicySelect label={`${s.name} policy`} value={policies[serverPolicyHost(s.name)]} onChange={(p) => setPolicy(serverPolicyHost(s.name), p)} />
            </span>
            <span className="tool-line-open" aria-hidden="true">›</span>
          </div>
        ))}
        {!servers.length && <p className="hint">No servers yet: <strong>＋ By URL</strong>, or <strong>＋ From a provider…</strong> that offers them.</p>}
      </div>
      <p className="hint">Local servers (a command) are not supported yet: an import says which it left out.</p>
    </>
  );

  return (
    <section className="mcp-settings">
      <SectionHead title="MCP servers" about={<>
        Remote MCP servers (Streamable HTTP, or SSE): their tools are offered to the model as <code>mcp.&lt;server&gt;.&lt;tool&gt;</code>, grouped in the
        tools menu, and follow the server's policy, like a website's actions.
      </>} />
      <StatStrip stats={[
        { label: 'Servers', value: <>{servers.length} <span className="stat-of">· {on.length} on</span></>, sub: `${servers.filter((s) => s.providerId).length} from a provider` },
        { label: 'Connected', value: <>{ok.length} <span className="stat-of">/ {on.length} on</span></>, sub: toSignIn.length ? <span className="error-text">{toSignIn.length} {toSignIn.length === 1 ? 'needs' : 'need'} you to sign in</span> : 'As last tested or used' },
        { label: 'Tools', value: allTools, sub: `${allTools - onDemandTools} in every request · ${onDemandTools} on demand` },
        { label: 'Without asking', value: servers.filter((s) => s.trustReadOnlyHints).length, sub: 'Servers trusting their read-only hints' },
      ]} />
      <SectionTabs label="MCP servers" tabs={[
        { id: 'servers', label: 'Servers', render: () => list },
        {
          id: 'texts', label: 'Texts', render: () => (
            <>
              <p className="hint">What the model reads about MCP tools, and what wraps what a server returns.</p>
              <PageModelTexts page="mcp" />
              <ModelTextEditor id="mcp.description" />
              <ModelTextEditor id="result.mcp" />
              <ModelTextEditor id="system.mcp" />
            </>
          ),
        },
      ]} />
      {open && (
        <ServerPanel server={open} logs={logs.filter((e) => e.server === open.name)} status={statusOf(open)} testing={testing.has(open.id)}
          signedIn={signed.has(open.id)} needsAccess={actions.needsAccess[open.id]} policy={policies[serverPolicyHost(open.name)]}
          onPolicy={(p) => setPolicy(serverPolicyHost(open.name), p)} onEnable={(enabled) => patch(open.id, { enabled })}
          matchMode={toolMatchMode(settings)} onOffer={(offer) => patch(open.id, offerChange(offer))} onAbout={(about) => patch(open.id, { about })}
          onTest={() => void test(open)} onSignIn={() => void actions.signInTo(open, actions.needsAccess[open.id])} onSignOut={() => void signOut(open).then(() => test(open))}
          onEdit={() => openEditor(open.id)} onRemove={() => { setPanel(null); void removeServer(saveServers, open).catch(failed); }} onClose={() => setPanel(null)} />
      )}
    </section>
  );
}

// How a server lets you in, as its line says it.
function accessLabel(s: McpServerConfig, providers: Props['settings']['providers']): string {
  if (s.providerId) return `${providers.find((p) => p.id === s.providerId)?.name ?? 'missing provider'}'s key`;
  if (Object.keys(s.headers ?? {}).length) return 'headers';
  return usesOAuth(s) ? 'sign in if asked' : 'none';
}

// A server in the side panel: test it, sign in, on or off, its policy, its tools and its logs; Edit opens
// its editor. Escape or × closes it.
function ServerPanel(props: {
  server: McpServerConfig;
  logs: McpLogEntry[];
  status?: McpLogEntry;
  testing: boolean;
  signedIn: boolean;
  needsAccess?: string;
  policy: Parameters<typeof PolicySelect>[0]['value'];
  matchMode: ToolMatchMode;
  onOffer: (offer: Offer) => void;
  onAbout: (about: string | undefined) => void;
  onPolicy: (p: NonNullable<Parameters<typeof PolicySelect>[0]['value']>) => void;
  onEnable: (on: boolean) => void;
  onTest: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { server: s, onClose } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <aside className="tool-drawer mcp-drawer" role="dialog" aria-label={s.name}>
      <header className="tool-drawer-head">
        <div>
          <h4>{s.name}</h4>
          <span className="mono small muted">{s.url}</span>
        </div>
        <button className="icon-button" title="Close" aria-label={`Close ${s.name}`} onClick={onClose}>✕</button>
      </header>
      <div className="row">
        <button className="primary" onClick={props.onTest} disabled={props.testing}>{props.testing ? 'Connecting…' : 'Test connection'}</button>
        <button onClick={props.onEdit}>Edit</button>
        <InlineConfirm question="Remove?" action="Remove" label={`Confirm: remove the MCP server ${s.name}`} onConfirm={props.onRemove}>
          {(ask) => <button className="danger" onClick={ask}>Remove</button>}
        </InlineConfirm>
      </div>
      {usesOAuth(s) && !props.testing && (
        <SignIn host={props.needsAccess && new URL(props.needsAccess).host} needed={!!props.status?.signIn} signedIn={props.signedIn} onSignIn={props.onSignIn} onSignOut={props.onSignOut} />
      )}
      <ul className="switch-rows" aria-label={`${s.name}: on, policy and when offered`}>
        <li><div><strong>On</strong><span className="hint">Its tools offered to the model</span></div><Switch checked={s.enabled} label={`${s.name}: on`} onChange={props.onEnable} /></li>
        <li><div><strong>Policy</strong><span className="hint">As a website's actions</span></div><PolicySelect label={`${s.name} policy`} value={props.policy} onChange={props.onPolicy} /></li>
        <li>
          <div><strong>Offered</strong><span className="hint">{offerChoices(props.matchMode).find((o) => o.id === offerOf(s))!.hint}</span></div>
          <select aria-label={`${s.name}: when its tools are offered`} value={offerOf(s)} onChange={(e) => props.onOffer(e.target.value as Offer)}>
            {offerChoices(props.matchMode).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </li>
        <li className="mcp-about">
          <div>
            <strong>What it is for</strong>
            <span className="hint">Optional, in your words and language (tasks, reminders, projects…). Tool matching compares it with your message along with its tools, by words and by meaning; it is never sent to the model.</span>
          </div>
          <AboutField key={s.id} label={`${s.name}: what it is for`} value={s.about} onCommit={props.onAbout} />
        </li>
      </ul>
      <div className="section-subhead"><h4>Its tools{props.status?.ok ? ` · ${props.status.tools?.length ?? 0}` : ''}</h4></div>
      <ServerStatus entry={props.status} testing={props.testing} open />
      <ServerLogs server={s.name} logs={props.logs} />
    </aside>
  );
}
