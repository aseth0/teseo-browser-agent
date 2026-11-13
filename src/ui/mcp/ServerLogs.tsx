import { clearMcpLogs, type McpLogEntry } from '../../mcp/logs';
import { downloadText, fileStamp } from '../download';

// A server's logs as a JSON file (all of them, with the action log: Settings → Logs).
const exportServerLogs = (server: string, logs: McpLogEntry[]) =>
  downloadText(`teseo-mcp-${server.replace(/[^\w.-]+/g, '_')}-${fileStamp()}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), server, logs }, null, 2));

// The server's tests, connections and tool calls in this browser session, the latest first.
export function ServerLogs({ server, logs }: { server: string; logs: McpLogEntry[] }) {
  return (
    <div className="mcp-logs" aria-label={`Connection logs of ${server}`}>
      <div className="row">
        <strong>Connection logs</strong>
        <span className="muted small">this browser session</span>
        <span className="spacer" />
        <button onClick={() => exportServerLogs(server, logs)} disabled={!logs.length}>Export</button>
        <button onClick={() => void clearMcpLogs(server)} disabled={!logs.length}>Clear</button>
      </div>
      {logs.length ? (
        <table className="mcp-log-table">
          <tbody>
            {logs.map((e, i) => (
              <tr key={i}>
                <td><span className={`status-dot ${e.ok ? 'ok' : 'error'}`} /></td>
                <td className="mono small">{new Date(e.at).toLocaleTimeString()}</td>
                <td className="small">{e.kind}</td>
                <td className={`small ${e.ok ? '' : 'error-text'}`}>{e.detail}</td>
                <td className="small muted">{e.ms !== undefined ? `${e.ms} ms` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted small">Nothing yet: test it, or use its tools from the chat.</p>
      )}
    </div>
  );
}
