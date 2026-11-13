// Context usage of the session: a compact ring with the percentage, details on click. The details
// split the last request into what every call sends again (the system prompt, the tool definitions,
// by group) and what grows with the conversation, with what each part changed since the call before,
// how the context grew call by call, and where to make each part smaller.
import { Icon } from '../../ui/chat-icons';
import { useMemo, useState } from 'react';
import { callTokens, contextUsed } from '../../context/usage';
import type { ContextWindow } from '../../context/window';
import type { ToolInfo } from '../../core/protocol';
import { CutMark } from '../../ui/LimitMark';
import { Popover } from '../../ui/Popover';
import { openOptions } from '../../ui/open-options';
import { fmtTokens as fmt, shortTokens as short, SourceBar, sourceRows, Swatch } from '../../ui/Usage';
import { contextParts, growth, measured, sentToolGroups, type ContextPart } from './context-parts';
import type { UsageTimeline } from './agent-state';
import type { SessionUsage } from './useAgent';
import { isEnter } from '../../ui/enter';

const WARN_PCT = 80; // the ring warns from this full
const RATIO_SHOWN = 0.05; // a correction this far from ×1 is told
const TOOLS_SHOWN = 5; // of a group, its heaviest tools listed
const CALLS_DRAWN = 100; // the chart's latest calls

interface Props {
  usage: SessionUsage;
  window: ContextWindow;
  model: string;
  cuts: string[]; // what was cut to a size limit in the last turn
  catalog?: ToolInfo[]; // the tools of this tab, to weigh the ones the last request sent by group
  onSetWindow?: (tokens: number | undefined) => void; // sets this model's window (none: as found)
  // "Compact now" (sidepanel/useCompaction); wouldFree: what it would trim, estimated
  compaction?: { busy: boolean; note: string; onCompact?: () => void; wouldFree?: () => number };
  ratio?: number; // the model's estimates corrected by it (context/token-ratio)
  assumed?: number; // the window runs count on when the model's is unknown (Settings → Compaction)
}

export function ContextMeter(props: Props) {
  const { usage, window, cuts } = props;
  const used = usage.last ? contextUsed(usage.last) : 0;
  const pct = window.tokens ? Math.min(100, (used / window.tokens) * 100) : undefined;
  const label = pct !== undefined ? `${Math.round(pct)}%` : short(used);
  return (
    <Popover title={`Context: ${label}${cuts.length ? ` · ${cuts.length} cut this turn` : ''}`} className={pct !== undefined && pct >= WARN_PCT ? 'warn' : ''} label={<><Ring pct={pct ?? 0} />{label}{cuts.length > 0 && <> <Icon name="cut" size={12} /></>}</>}>
      {() => <Details {...props} used={used} pct={pct} />}
    </Popover>
  );
}

const signed = (n: number) => `${n > 0 ? '+' : '−'}${short(Math.abs(n))}`;
const share = (n: number, of: number) => (of > 0 ? ` (${Math.round((n / of) * 100)}%)` : '');
const SettingsLink = ({ at, children }: { at: string; children: string }) => (
  <button className="link-button" onClick={() => void openOptions(at)} title={`Opens Settings → ${children}`}>{children}</button>
);

function Details(props: Props & { used: number; pct?: number }) {
  const { usage, window, model, cuts, used, pct } = props;
  const last = usage.last;
  const parts = contextParts(last, usage.previous);
  const fixed = parts.filter((p) => p.fixed);
  const growing = parts.filter((p) => !p.fixed);
  const sum = (ps: ContextPart[]) => ps.reduce((n, p) => n + p.tokens, 0);
  const total = sum(parts);
  const { first, delta } = growth(usage.timeline);
  const cached = last?.reported?.cached;
  // The meter's fixed share: the estimate's share of the request, over the request's input (the rest
  // of what is used grows: the conversation and the answer sent back).
  const fixedPct = pct !== undefined && window.tokens && last && total ? Math.min(pct, (callTokens(last).input * sum(fixed)) / total / window.tokens * 100) : undefined;
  return (
    <div className="context-details">
      <div className="context-head">
        <strong>Context</strong> <span className="muted">· {model || 'no model'}</span>
      </div>
      <div className="context-total">
        <span>{window.tokens && pct !== undefined ? `${fmt(used)} / ${fmt(window.tokens)} tokens (${pct.toFixed(1)}%)` : `${fmt(used)} tokens`}</span>
        {delta !== undefined && delta !== 0 && <span className="muted small" title="The last request against the one before">{signed(delta)} since the call before</span>}
      </div>
      {pct !== undefined && (
        <div className="meter" title={fixedPct !== undefined ? 'Darker: sent again with every call; lighter: grows with the conversation' : undefined}>
          {fixedPct !== undefined ? <><div className="meter-fill fixed" style={{ width: `${fixedPct}%` }} /><div className="meter-fill" style={{ width: `${pct - fixedPct}%` }} /></>
            : <div className="meter-fill" style={{ width: `${pct}%` }} />}
        </div>
      )}
      {usage.timeline && <Timeline timeline={usage.timeline} window={window.tokens} first={first} />}
      <div className="muted small">
        {!last
          ? 'No model calls yet in this conversation.'
          : last.reported
            ? `Reported by the server for the last call${cached ? `, ${fmt(cached)} of it from its prompt cache` : ''}; the split below is estimated.`
            : 'Estimated: about 4 characters a token (1 a character in Chinese, Japanese and Korean); the server did not report usage.'}
      </div>
      {props.ratio && Math.abs(props.ratio - 1) >= RATIO_SHOWN && (
        <div className="muted small">Estimates for this model corrected ×{props.ratio.toFixed(1)} from what the server reported.</div>
      )}
      <WindowLine window={window} onSet={props.onSetWindow} assumed={props.assumed} />

      {last && !measured(last) && <div className="muted small">How the request splits shows after the next call.</div>}
      {fixed.length > 0 && (
        <>
          <div className="context-section">Sent again with every call · ~{short(sum(fixed))}{share(sum(fixed), total)}</div>
          {fixed.map((p) => (p.key === 'tools' ? <ToolsPart key={p.key} part={p} names={last!.toolNames} catalog={props.catalog ?? []} /> : <PartRow key={p.key} part={p} />))}
          {fixed.some((p) => p.key === 'tools') && <div className="muted small">Fewer tools offered: <SettingsLink at="tools">Tools</SettingsLink></div>}
        </>
      )}
      {growing.length > 0 && (
        <>
          <div className="context-section">Grows with the conversation · ~{short(sum(growing))}{share(sum(growing), total)}</div>
          {growing.map((p) => <PartRow key={p.key} part={p} />)}
          {!!last?.estimatedImages && <div className="muted small">Of it, images: ~{fmt(last.estimatedImages)}</div>}
          <div className="muted small">Shorter page blocks and tool results: <SettingsLink at="limits">Limits</SettingsLink></div>
        </>
      )}
      {props.compaction && <CompactLine compaction={props.compaction} />}

      {last?.sources && sourceRows(last.sources).length > 0 && (
        <details className="context-origins">
          <summary>By origin (Layers colors)</summary>
          <SourceBar sources={last.sources} className="wide" />
          <table className="context-table">
            <tbody>
              {sourceRows(last.sources).map((r) => (
                <tr key={r.source}>
                  <td><Swatch source={r.source} /> {r.label}</td>
                  <td>{fmt(r.tokens)}</td>
                </tr>
              ))}
              <tr className="muted">
                <td>Last response</td>
                <td>{fmt(last.estimatedOutput)}</td>
              </tr>
            </tbody>
          </table>
        </details>
      )}

      {cuts.length > 0 && (
        <>
          <div className="context-section">Cut this turn (Settings → Limits)</div>
          {cuts.map((c, i) => <div key={i}><CutMark detail={c} /> {c}</div>)}
        </>
      )}

      <div className="context-section">Session</div>
      <table className="context-table">
        <tbody>
          <tr><td>Model calls</td><td>{fmt(usage.calls)}</td></tr>
          <tr><td>Input tokens (all calls)</td><td>{fmt(usage.input)}</td></tr>
          {!!usage.cached && <tr className="muted"><td>of it, from the prompt cache</td><td>{fmt(usage.cached)}{share(usage.cached, usage.input)}</td></tr>}
          <tr><td>Output tokens (all calls)</td><td>{fmt(usage.output)}</td></tr>
          {!!usage.reasoning && <tr className="muted"><td>of it, reasoning</td><td>{fmt(usage.reasoning)}{share(usage.reasoning, usage.output)}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function Delta({ n }: { n?: number }) {
  if (!n) return null;
  return <span className={`context-delta ${n > 0 ? 'up' : ''}`} title="Since the call before">{signed(n)}</span>;
}

function PartRow({ part }: { part: ContextPart }) {
  return (
    <div className="context-row">
      <span>{part.label}</span>
      <span>~{fmt(part.tokens)} <Delta n={part.delta} /></span>
    </div>
  );
}

// The tool definitions, unfolding into their groups, and each group into its heaviest tools.
function ToolsPart({ part, names, catalog }: { part: ContextPart; names?: string[]; catalog: ToolInfo[] }) {
  // Not again on every streamed piece while the popover is open.
  const { groups, others } = useMemo(() => sentToolGroups(catalog, names, part.tokens), [catalog, names, part.tokens]);
  const count = names?.length ?? 0;
  if (!groups.length) return <PartRow part={{ ...part, label: `${part.label}${count ? ` · ${count}` : ''}` }} />;
  return (
    <details className="context-tools">
      <summary className="context-row">
        <span>{part.label} · {count}</span>
        <span>~{fmt(part.tokens)} <Delta n={part.delta} /></span>
      </summary>
      {groups.map((g) => (
        <details key={g.group} className="context-group">
          <summary className="context-row">
            <span>{g.label} <span className="muted">· {g.count}</span></span>
            <span>~{fmt(g.tokens)}</span>
          </summary>
          {(g.tools ?? []).slice(0, TOOLS_SHOWN).map((t) => (
            <div key={t.name} className="context-row context-tool">
              <button className="link-button" onClick={() => void openOptions(`tools/${t.name}`)} title={`Settings → Tools: ${t.name}`}>{t.name}</button>
              <span>~{fmt(t.tokens)}</span>
            </div>
          ))}
          {g.count > TOOLS_SHOWN && <div className="muted small context-tool">and {g.count - TOOLS_SHOWN} more</div>}
        </details>
      ))}
      <div className="muted small context-tool">By group as this tab lists its tools now{others > 0 ? `; ${others} sent are not in that list` : ''}.</div>
    </details>
  );
}

function CompactLine({ compaction }: { compaction: NonNullable<Props['compaction']> }) {
  const free = compaction.onCompact && !compaction.busy ? compaction.wouldFree?.() : undefined;
  return (
    <div className="context-compact">
      <button onClick={compaction.onCompact} disabled={!compaction.onCompact || compaction.busy}
        title="The turns before the latest ones go to the model with their page blocks, tool results, screenshots and other long parts left out, summarized if that is not enough (Settings → Compaction)">
        {compaction.busy ? 'Compacting…' : 'Compact now'}
      </button>
      {free !== undefined && <span className="muted small">{free > 0 ? `trimming takes out ~${short(free)}, a summary more` : 'nothing earlier to trim yet'}</span>}
      <SettingsLink at="compaction">Compaction</SettingsLink>
      {compaction.note && <div className="muted small">{compaction.note}</div>}
    </div>
  );
}

// The input of each call of this conversation, the compactions marked between calls, and the
// window when it is in sight.
function Timeline({ timeline, window, first }: { timeline: UsageTimeline; window?: number; first?: number }) {
  const skipped = Math.max(0, timeline.inputs.length - CALLS_DRAWN); // the latest calls only
  const inputs = timeline.inputs.slice(skipped);
  if (inputs.length < 2) return null;
  const W = 200;
  const H = 32;
  const top = Math.max(...inputs, 1) * 1.15;
  const x = (i: number) => (i / (inputs.length - 1)) * W;
  const y = (n: number) => H - (n / top) * (H - 2);
  const compactions = timeline.compactedAt.map((at) => at - skipped).filter((at) => at > 0 && at < inputs.length);
  const label = `Input of each of the ${inputs.length} ${skipped ? 'latest ' : ''}calls, from ${fmt(inputs[0]!)} to ${fmt(inputs.at(-1)!)} tokens${compactions.length ? `, compacted ${compactions.length === 1 ? 'once' : `${compactions.length} times`}` : ''}`;
  return (
    <div className="context-timeline">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
        {window && window <= top && <line className="window" x1={0} x2={W} y1={y(window)} y2={y(window)} />}
        {compactions.map((at) => <line key={at} className="compacted" x1={x(at - 0.5)} x2={x(at - 0.5)} y1={0} y2={H} />)}
        <polyline points={inputs.map((n, i) => `${x(i)},${y(n)}`).join(' ')} />
        {inputs.map((n, i) => (
          <rect key={i} x={x(i - 0.5)} width={W / (inputs.length - 1)} y={0} height={H} fill="transparent">
            <title>{`Call ${skipped + i + 1}: ${fmt(n)} tokens in`}</title>
          </rect>
        ))}
      </svg>
      <div className="muted small">
        {timeline.inputs.length} calls{skipped > 0 && <> (the latest {inputs.length} drawn)</>}{first !== undefined && <> · first request {fmt(first)}</>}{compactions.length > 0 && <> · <span className="context-legend-compacted" aria-hidden="true" /> compacted</>}
      </div>
    </div>
  );
}

// Progress ring drawn with currentColor; the filled arc is the used fraction.
function Ring({ pct }: { pct: number }) {
  const r = 6;
  const c = 2 * Math.PI * r;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r={r} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <circle cx="8" cy="8" r={r} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90 8 8)" />
    </svg>
  );
}

const WINDOW_SOURCE: Record<ContextWindow['source'], string> = {
  'model-settings': 'set by you for this model',
  error: 'learned from the server, which refused a longer request',
  server: 'published by the server',
  settings: 'set for this provider in Settings → Providers',
  'model-max': 'the most the model takes: the server may run it with less',
  unknown: 'unknown',
};

// The model's context window, where it comes from, and setting it for this model.
function WindowLine({ window, onSet, assumed }: { window: ContextWindow; onSet?: (tokens: number | undefined) => void; assumed?: number }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  if (editing && onSet) {
    const save = () => {
      const tokens = Math.round(Number(draft));
      onSet(tokens >= 1 ? tokens : undefined);
      setEditing(false);
    };
    return (
      <div className="context-window-edit">
        <label>Context window of this model, tokens
          <input type="number" min={1} value={draft} autoFocus placeholder="e.g. 128000" onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (isEnter(e)) save();
              if (e.key !== 'Escape') return;
              e.stopPropagation(); // leaves the field, not the whole popover
              setEditing(false);
            }} />
        </label>
        <button onClick={save}>Save</button>
        {window.source === 'model-settings' && <button onClick={() => (onSet(undefined), setEditing(false))}>As found</button>}
        <button onClick={() => setEditing(false)}>Cancel</button>
      </div>
    );
  }
  return (
    <div className="muted small">
      Context window: {window.tokens ? `${fmt(window.tokens)} tokens, ${WINDOW_SOURCE[window.source]}`
        : assumed ? `unknown: a turn counts on ${fmt(assumed)} tokens (Settings → Compaction) and shortens its requests less on it; set it for this model`
          : 'unknown: set it for this model'}.
      {onSet && <> <button className="link-button" onClick={() => (setDraft(String(window.tokens ?? '')), setEditing(true))}>{window.tokens ? 'Change' : 'Set it'}</button></>}
    </div>
  );
}
