// A turn's steps drawn as a diagram above its answer (the Diagrams view: Show the chat as),
// of the kind picked on its box, with the steps themselves under it, folded (`children`). pele draws
// it: its core and the sequence diagram are bundled; the other kinds load the first time one is picked.
import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { register, render, type DiagramType } from 'pele/core';
import sequence from 'pele/diagrams/sequence';
import type { LiveSegment } from '../../core/live';
import type { Message } from '../../core/types';
import { Icon } from '../chat-icons';
import { DiagramSvg, drawSvg, SAFE_RENDER, useDiagramType, useZoom, ZoomControls } from '../DiagramView';
import { Segmented } from '../Segmented';
import type { TurnDiagramKind } from '../../storage/settings-types';
import { ChatActionsContext, ChatViewContext, LiveContext } from './contexts';
import { diagramKindOf, TURN_DIAGRAM_KINDS, turnDiagramOf } from './turn-diagram';
import type { DiagramCounts } from './turn-steps';
import type { ToolResultPart } from './turns';
import { plural } from '../../core/util';
import { DotLine, stepCounts } from './step-counts';

register(sequence);

// The diagram type pele names each kind; but the sequence, they load the first time one is picked.
const PELE_TYPE: Record<TurnDiagramKind, DiagramType> = { sequence: 'sequence', flowchart: 'flowchart', mindmap: 'mindmap', gantt: 'gantt', pie: 'pie' };

// How often the diagram of a running turn takes in what streams (not every token).
const LIVE_EVERY_MS = 250;

const RENDER = { ...SAFE_RENDER, maxWidth: 360, fontSize: 12, config: { sequence: { mirrorActors: false } } };

// The svg of a diagram's source, or why it could not be drawn.
const draw = (source: string, id: string): { svg?: string; error?: string } => drawSvg(() => render(source, { ...RENDER, idPrefix: id }));


// The counts in words, for screen readers.
const countsText = (c: DiagramCounts) =>
  [plural(c.thoughts, 'thought'), plural(c.tools, 'tool call'), c.agents > 0 && plural(c.agents, 'agent'), c.errors > 0 && plural(c.errors, 'error')].filter(Boolean).join(', ');

const countsLine = (c: DiagramCounts, running: boolean): ReactNode[] => [...(running ? ['Working…'] : []), ...stepCounts(c)];

// What streams now, taken every LIVE_EVERY_MS while the turn runs (none otherwise): the diagram is
// drawn again a few times a second, not on every token.
function useLiveSampled(running: boolean): LiveSegment[] | undefined {
  const source = useContext(LiveContext);
  const [sampled, setSampled] = useState<LiveSegment[]>();
  useEffect(() => {
    if (!running || !source) return;
    const take = () => setSampled(source.get().segments);
    take();
    const timer = setInterval(take, LIVE_EVERY_MS);
    return () => {
      clearInterval(timer);
      setSampled(undefined);
    };
  }, [running, source]);
  return running ? sampled : undefined;
}

// `latest`: the last turn, open; older ones start folded. `children`: the turn's steps as the chat
// shows them otherwise, folded under the diagram (their full text, Layers chips and actions).
export function TurnDiagram(props: {
  id: string;
  user?: Message;
  messages: Message[];
  steps: Message[];
  results: Map<string, ToolResultPart>;
  answered: boolean;
  stopped: boolean;
  running: boolean;
  latest: boolean;
  children: ReactNode;
}) {
  const { id, user, messages, steps, results, answered, stopped, running, latest, children } = props;
  const view = useContext(ChatViewContext);
  const { pickDiagram } = useContext(ChatActionsContext);
  const reasoning = (view.reasoning ?? 'collapsed') !== 'hidden';
  // Each box its own kind, starting with the one last picked.
  const [kind, setKind] = useState<TurnDiagramKind>(() => diagramKindOf(view.turnDiagram));
  const loading = useDiagramType(PELE_TYPE[kind]);
  const zoom = useZoom();
  const live = useLiveSampled(running && (kind === 'sequence' || kind === 'flowchart' || kind === 'mindmap'));
  const { source, none, counts } = useMemo(
    () => turnDiagramOf(kind, { user, messages, steps, results, answered, stopped, running, live, reasoning }),
    [kind, user, messages, steps, results, answered, stopped, running, live, reasoning],
  );
  const drawn = useMemo(() => (source && loading.ready ? draw(source, id) : undefined), [source, id, loading.ready]);
  const line = countsLine(counts, running);
  const pick = (next: TurnDiagramKind) => {
    setKind(next);
    pickDiagram?.(next);
  };
  const name = TURN_DIAGRAM_KINDS.find(([k]) => k === kind)?.[1] ?? kind;
  return (
    <details className={`turn-diagram${running ? ' running' : ''}`} open={latest || undefined}>
      <summary>
        <Icon name="diagram" size={12} /> Turn diagram{line.length > 0 && ' · '}
        <DotLine parts={line} />
      </summary>
      <div className="turn-diagram-head">
        <Segmented className="compact" label="Draw this turn as" value={kind} onChange={pick}
          options={TURN_DIAGRAM_KINDS.map(([value, label, title]) => ({ value, label, title }))} />
        {drawn?.svg && <ZoomControls zoom={zoom} />}
      </div>
      {none ? (
        <div className="turn-diagram-none muted small">{none}</div>
      ) : loading.error ? (
        <div className="turn-diagram-error muted small">The {name.toLowerCase()} could not be loaded: {loading.error}</div>
      ) : !drawn ? (
        <div className="turn-diagram-loading muted small">Loading…</div>
      ) : drawn.svg ? (
        <DiagramSvg className="turn-diagram-svg diagram-svg" svg={drawn.svg} zoom={zoom}
          label={`${name} of this turn: ${countsText(counts)}. Its steps, as text, are under it.`} />
      ) : (
        <div className="turn-diagram-error muted small">The diagram could not be drawn: {drawn.error}</div>
      )}
      <details className="turn-diagram-steps">
        <summary>Steps</summary>
        {children}
      </details>
    </details>
  );
}
