// Settings → Logs: how long the action log is kept, the calls in it (filtered), and an export of it
// with the MCP servers' connection logs.
import { useMemo, useState } from 'react';
import { browser } from 'wxt/browser';
import { clearActionLog, DEFAULT_LOG_MODE, loadActionLog, onActionLogChanged, type ActionDecision, type ActionLogEntry, type ActionLogMode, type ActionSource } from '../logs/actions';
import { loadMcpLogs } from '../mcp/logs';
import { downloadText, fileStamp } from './download';
import type { PatchSectionProps as Props } from './useSettings';
import { InlineConfirm } from './InlineConfirm';
import { FilterChips, SectionHead, StatStrip } from './SectionParts';
import { Segmented } from './Segmented';
import { useReload } from './useLive';
import { useAttempt } from './useAttempt';

const SOURCES: Record<ActionSource, string> = { chat: 'Chat', 'sub-agent': 'Sub-agent', widget: 'Page widget' };
const DECISIONS: Record<ActionDecision, string> = {
  free: 'Without asking',
  allow: 'Allowed',
  always: 'Always on the site',
  session: 'For this conversation',
  deny: 'Denied',
  refused: 'Refused',
};
type Show = 'all' | 'asked' | 'stopped' | 'failed';
const SHOWN: Record<Show, (e: ActionLogEntry) => boolean> = {
  all: () => true,
  asked: (e) => e.decision !== 'free' && e.decision !== 'refused',
  stopped: (e) => e.decision === 'deny' || e.decision === 'refused',
  failed: (e) => !e.ok && e.decision !== 'deny' && e.decision !== 'refused',
};
const NO_ENTRIES: ActionLogEntry[] = [];
const LISTED = 200; // rows shown; the export has them all
const MODES: Record<ActionLogMode, string> = { off: 'Off', session: 'This session', kept: 'In this browser' };

// The action log and the MCP servers' logs, as one JSON file.
async function exportLogs(): Promise<void> {
  const [actions, mcp] = await Promise.all([loadActionLog(), loadMcpLogs()]);
  const file = { exportedAt: new Date().toISOString(), version: browser.runtime.getManifest().version, actions, mcp };
  downloadText(`teseo-logs-${fileStamp()}.json`, JSON.stringify(file, null, 2));
}

export function LogsSection({ settings, onChange }: Props) {
  const mode = settings.logs?.actions ?? DEFAULT_LOG_MODE;
  const { failed, attempt } = useAttempt();
  const log = useReload(loadActionLog, onActionLogChanged, NO_ENTRIES, '[action log]');
  const [show, setShow] = useState<Show>('all');
  const [source, setSource] = useState<ActionSource | ''>('');
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const words = query.trim().toLowerCase();
    return log.filter((e) => SHOWN[show](e) && (!source || e.source === source) && (!words || [e.tool, e.agent, e.host, e.summary, e.error].some((v) => v?.toLowerCase().includes(words))));
  }, [log, show, source, query]);

  const count = (f: Show) => log.filter(SHOWN[f]).length;
  return (
    <section className="logs-settings">
      <SectionHead title="Logs" about={<>
        Every tool call of the chat, its sub-agents and the page widget: what it was, where, what was decided and how it ended. Only what the
        confirmation card would show of it, never its arguments, keys, page contents or results.
      </>} />
      <StatStrip stats={[
        { label: 'Kept', value: <span className="stat-text">{MODES[mode]}</span>, sub: mode === 'kept' ? 'The last 1000 calls' : mode === 'session' ? 'Until the browser closes' : 'Nothing is written' },
        { label: 'Calls', value: log.length, sub: `${count('asked')} asked in a card` },
        { label: 'Stopped', value: count('stopped'), sub: 'Denied or refused' },
        { label: 'Failed', value: count('failed'), sub: 'Ran, and ended in an error' },
      ]} />
      <ul className="switch-rows" aria-label="The action log">
        <li>
          <div><strong>Keep the action log</strong><span className="hint">Export takes it with the MCP servers&apos; connection logs</span></div>
          <span className="row logs-keep">
            <Segmented label="Keep the action log" className="compact" value={mode} onChange={(actions) => onChange({ logs: { ...settings.logs, actions } })}
              options={(Object.keys(MODES) as ActionLogMode[]).map((value) => ({ value, label: MODES[value] }))} />
            <button onClick={() => attempt(exportLogs())}>Export</button>
            <InlineConfirm question="Clear the action log?" action="Clear" label="Confirm: clear the action log" onConfirm={clearActionLog}>
              {(ask) => <button onClick={ask} disabled={!log.length}>Clear</button>}
            </InlineConfirm>
          </span>
        </li>
      </ul>
      {failed && <p className="error-text" role="alert">{failed}</p>}
      <div className="row logs-toolbar">
        <input type="search" className="grow" aria-label="Filter" placeholder="Tool, agent, site…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select aria-label="From" value={source} onChange={(e) => setSource(e.target.value as ActionSource | '')}>
          <option value="">From anywhere</option>
          {Object.entries(SOURCES).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
        <FilterChips<Exclude<Show, 'all'>> label="Show" value={show} onChange={setShow} total={log.length} filters={[
          { id: 'asked', label: 'Asked in a card', tone: 'site', count: count('asked') },
          { id: 'stopped', label: 'Denied or refused', tone: 'always', count: count('stopped') },
          { id: 'failed', label: 'Failed', tone: 'plain', count: count('failed') },
        ]} />
      </div>
      {shown.length ? (
        <table className="mcp-log-table action-log">
          <thead>
            <tr><th /><th>When</th><th>From</th><th>Agent</th><th>Tool</th><th>Site</th><th>Decision</th><th /></tr>
          </thead>
          <tbody>
            {shown.slice(0, LISTED).map((e, i) => (
              <tr key={i}>
                <td><span className={`status-dot ${e.ok ? 'ok' : 'error'}`} /></td>
                <td className="mono small" title={new Date(e.at).toLocaleString()}>{new Date(e.at).toLocaleTimeString()}</td>
                <td className="small">{SOURCES[e.source]}</td>
                <td className="small">{e.agent}</td>
                <td className="small">
                  <span className="mono">{e.tool}</span>
                  {e.summary && <div className="muted">{e.summary}</div>}
                  {e.error && <div className="error-text">{e.error}</div>}
                </td>
                <td className="small">{e.host}</td>
                <td className="small">{DECISIONS[e.decision]}</td>
                <td className="small muted">{e.ms} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted small">{log.length ? 'No call matches.' : mode === 'off' ? 'The action log is off.' : 'Nothing yet: calls show here as the agent makes them.'}</p>
      )}
      {shown.length > LISTED && <p className="muted small">The latest {LISTED} of {shown.length}: the export has them all.</p>}
    </section>
  );
}
