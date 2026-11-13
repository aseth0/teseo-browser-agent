// A server in Settings → MCP servers: its status (a line on its row, its tools in its panel) and signing in.
import type { McpLogEntry } from '../../mcp/logs';

// Signing in with OAuth: needed (the server said so), a site to allow first, or signed in.
export function SignIn({ host, needed, signedIn, onSignIn, onSignOut }: { host?: string; needed: boolean; signedIn: boolean; onSignIn: () => void; onSignOut: () => void }) {
  if (host) return <div className="row small">Signing in needs access to {host}. <button className="primary" onClick={onSignIn}>Allow and sign in</button></div>;
  if (needed) return <div className="row small"><button className="primary" onClick={onSignIn}>Sign in</button></div>;
  if (signedIn) return <div className="row small"><span className="muted">Signed in</span> <button onClick={onSignOut}>Sign out</button></div>;
  return null;
}

const ago = (at: number) => {
  const s = Math.round((Date.now() - at) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};

const STATUS_FROM: Record<McpLogEntry['kind'], string> = { test: 'tested', 'sign-in': 'signing in', connect: 'connected', call: 'called' };

// On a server's line: a colored dot, and how many tools or that it needs signing in, or the error.
export function StatusLine({ entry, testing }: { entry?: McpLogEntry; testing: boolean }) {
  if (testing) return <span className="mcp-status-line"><span className="status-dot busy" /> Connecting…</span>;
  if (!entry) return <span className="mcp-status-line muted"><span className="status-dot" /> Not tested yet</span>;
  if (!entry.ok) {
    return (
      <span className="mcp-status-line error-text" title={entry.detail}>
        <span className="status-dot error" /> {entry.signIn ? 'Sign in needed' : <span className="mcp-error">{entry.detail}</span>}
      </span>
    );
  }
  return <span className="mcp-status-line"><span className="status-dot ok" /> {entry.tools?.length ?? 0} tools · {ago(entry.at)}</span>;
}

// A colored dot and one line: its tools (folded; `open`, unfolded), or the error; from its latest test
// or connection.
export function ServerStatus({ entry, testing, open }: { entry?: McpLogEntry; testing: boolean; open?: boolean }) {
  if (testing) return <div className="mcp-status"><span className="status-dot busy" /> Connecting…</div>;
  if (!entry) return <div className="mcp-status muted"><span className="status-dot" /> Not tested yet</div>;
  const when = `${STATUS_FROM[entry.kind]} ${ago(entry.at)}`;
  if (!entry.ok) {
    return (
      <div className="mcp-status error-text" title={entry.detail}>
        <span className="status-dot error" /> <span className="mcp-error">{entry.detail}</span> <span className="muted">· {when}</span>
      </div>
    );
  }
  const tools = entry.tools ?? [];
  return (
    <details className="mcp-status mcp-tools" open={open}>
      <summary>
        <span className="status-dot ok" /> {entry.detail} <span className="muted">· {when}</span>
      </summary>
      <div className="mcp-tool-chips">{tools.map((t) => <code key={t}>{t}</code>)}</div>
    </details>
  );
}
