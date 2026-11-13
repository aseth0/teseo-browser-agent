// A closed ```mermaid block of the model's text drawn as a diagram by pele, with its code a click away
// (Diagram / Code) and its zoom; or its code, with a line saying why it could not be drawn. Each kind
// of diagram loads the first time one is shown. Drawn once per source: Markdown re-renders at each
// streamed token, this does not (memo).
import { memo, useId, useMemo, useState } from 'react';
import { detectType, render, type DiagramType } from 'pele/lazy';
import { CopyIconButton } from './icons';
import { DiagramSvg, drawSvg, SAFE_RENDER, useDiagramType, useZoom, ZoomControls } from './DiagramView';
import { Segmented } from './Segmented';

const RENDER = { ...SAFE_RENDER, fontSize: 13 };

type Drawn = { svg: string; type: DiagramType } | { error: string } | undefined;

export const MermaidBlock = memo(function MermaidBlock({ source }: { source: string }) {
  const id = `mermaid-${useId().replace(/\W/g, '')}-`;
  const type = useMemo(() => detectType(source), [source]);
  const kind = useDiagramType(type);
  const drawn = useMemo((): Drawn => {
    if (!type || !kind.ready) return undefined;
    const d = drawSvg(() => render(source, { ...RENDER, idPrefix: id }));
    return 'svg' in d ? { ...d, type } : d;
  }, [source, type, kind.ready, id]);
  const [view, setView] = useState<'diagram' | 'code'>('diagram');
  const zoom = useZoom();
  const note = !type ? "This kind of diagram can't be drawn here."
    : kind.error ? `The ${type} diagram could not be loaded: ${kind.error}`
    : drawn && 'error' in drawn ? `The diagram could not be drawn: ${drawn.error}`
    : undefined;
  const svg = drawn && 'svg' in drawn ? drawn.svg : undefined;
  const code = <pre><code className="language-mermaid">{source}</code></pre>;
  return (
    <div className="copyable mermaid-block">
      {note ? (
        <><div className="mermaid-note muted small">{note}</div>{code}</>
      ) : (
        <>
          <div className="mermaid-bar">
            <Segmented className="compact" label="Show as" value={view} onChange={setView}
              options={[{ value: 'diagram', label: 'Diagram' }, { value: 'code', label: 'Code' }]} />
            {view === 'diagram' && svg && <ZoomControls zoom={zoom} />}
          </div>
          {view === 'code' ? code
            : svg ? <DiagramSvg className="diagram-svg" svg={svg} zoom={zoom} label={`${type} diagram, drawn from the model's Mermaid code`} />
            : <div className="mermaid-note muted small">Drawing the diagram…</div>}
        </>
      )}
      <span className="copy-corner">
        <CopyIconButton label="Copy the code" text={source} />
      </span>
    </div>
  );
});
