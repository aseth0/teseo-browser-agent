// A turn's phases (core/phases) as Layers shows them under your message: each with what it did, how
// long it took and a bar of its share of the turn, those of a model call or an agent asked under it.
// Open while the turn goes (the phase going on counts up), folded into one line once it ended.
// PhaseNow: the one going on, for the chat's line while the agent works.
import { useEffect, useState, type ReactNode } from 'react';
import { currentPhase, phaseSummary, phaseTime, phaseTree, type PhaseNode, type TurnPhase } from '../../core/phases';

const TICK_MS = 200;

// Now, again every TICK_MS while `on`.
function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, [on]);
  return on ? now : Date.now();
}

const elapsed = (p: TurnPhase, now: number) => p.ms ?? Math.max(0, now - p.at);

// The phase going on, and for how long; none: `fallback`.
export function PhaseNow({ phases, fallback }: { phases: TurnPhase[]; fallback: ReactNode }) {
  const p = currentPhase(phases);
  const now = useNow(!!p);
  if (!p) return <>{fallback}</>;
  return <span className="phase-now">{p.label}… <span className="phase-time">{phaseTime(elapsed(p, now))}</span></span>;
}

export function TurnPhases({ phases, running }: { phases: TurnPhase[]; running: boolean }) {
  const now = useNow(running);
  const [open, setOpen] = useState<boolean | undefined>(undefined); // none: open while it runs
  if (!phases.length) return null;
  const shown = open ?? running;
  const { count, ms, slowest } = phaseSummary(phases, now);
  const start = Math.min(...phases.map((p) => p.at));
  const total = Math.max(ms, 1);
  const row = (n: PhaseNode, depth: number) => {
    const p = n.phase;
    const took = elapsed(p, now);
    const going = p.ms === undefined;
    const unfinished = going && !running;
    return (
      <li key={p.id} className={`phase phase-${p.kind}${going && running ? ' going' : ''}`}>
        <div className="phase-row" style={{ paddingLeft: depth * 12 }}>
          <span className="phase-label">{p.label}</span>
          {p.detail && <span className="phase-detail" title={p.detail}>{p.detail}</span>}
          <span className="phase-time">{unfinished ? 'not ended' : phaseTime(took)}</span>
        </div>
        <div className="phase-bar" aria-hidden="true">
          <span style={{ marginLeft: `${((p.at - start) / total) * 100}%`, width: `${Math.max(0.5, (took / total) * 100)}%` }} />
        </div>
        {n.children.length > 0 && <ul>{n.children.map((c) => row(c, depth + 1))}</ul>}
      </li>
    );
  };
  return (
    <div className="turn-phases">
      <button type="button" className="turn-phases-head" aria-expanded={shown} onClick={() => setOpen(!shown)}>
        <span aria-hidden="true">{shown ? '▾' : '▸'}</span> Phases of the turn · {count} · {phaseTime(ms)}
        {slowest && !running && <span className="muted"> · slowest: {slowest.label} {phaseTime(slowest.ms!)}</span>}
      </button>
      {shown && <ul>{phaseTree(phases).map((n) => row(n, 0))}</ul>}
    </div>
  );
}
