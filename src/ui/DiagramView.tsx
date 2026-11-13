// A diagram pele drew, shown at the width of the chat (Fit) or zoomed in or out with its controls,
// scrolling when larger: a Mermaid block in the model's text (MermaidBlock) and a turn's diagram
// (TurnDiagram). Its SVG goes in through diagramSvg's allowlist, never as markup.
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Shrink } from 'lucide';
import { load, registered, type DiagramType } from 'pele/lazy';
import { errorText } from '../core/errors';
import { diagramSvg } from './diagram-svg';
import { LucideIcon } from './LucideIcon';

// Whether pele can draw `type` now, loading it the first time (each kind is a chunk of its own); why
// it could not be loaded.
export function useDiagramType(type: DiagramType | null): { ready: boolean; error?: string } {
  const [state, setState] = useState<{ type: DiagramType; error?: string }>();
  useEffect(() => {
    if (!type || registered(type)) return;
    let gone = false;
    load(type).then(
      (ok) => !gone && setState({ type, error: ok ? undefined : 'pele has no such diagram' }),
      (e: unknown) => !gone && setState({ type, error: errorText(e) }),
    );
    return () => void (gone = true);
  }, [type]);
  return { ready: !!type && registered(type), error: state?.type === type ? state.error : undefined };
}

// What every diagram is drawn with: no links and no images (diagramSvg drops them too), a little padding.
export const SAFE_RENDER = { padding: 8, links: false, images: false };

// The svg pele draws, or why it could not draw it.
export function drawSvg(draw: () => { svg: string }): { svg: string } | { error: string } {
  try {
    return { svg: draw().svg };
  } catch (e) {
    return { error: errorText(e) };
  }
}

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;
const ZOOM_STEP = 1.25;

// The scale `factor` times `current`, kept between ZOOM_MIN and ZOOM_MAX, to the percent.
export const zoomedBy = (current: number, factor: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(current * factor * 100) / 100));

// What the controls say: Fit (no scale), else the scale in percent.
export const zoomLabel = (scale: number | undefined) => (scale === undefined ? 'Fit' : `${Math.round(scale * 100)}%`);

export interface Zoom {
  scale?: number; // none: Fit, the diagram as wide as the chat at most
  box: RefObject<HTMLDivElement | null>;
  by(factor: number): void;
  fit(): void;
}

// The zoom of one diagram (not kept: each starts at Fit).
export function useZoom(): Zoom {
  const [scale, setScale] = useState<number>();
  const box = useRef<HTMLDivElement>(null);
  // From Fit, from the scale it is shown at.
  const shown = () => {
    const svg = box.current?.querySelector('svg');
    const natural = parseFloat(svg?.getAttribute('width') ?? '');
    return svg && natural > 0 ? svg.getBoundingClientRect().width / natural : 1;
  };
  return { scale, box, by: (factor) => setScale((s) => zoomedBy(s ?? shown(), factor)), fit: () => setScale(undefined) };
}

export function ZoomControls({ zoom }: { zoom: Zoom }) {
  return (
    <span className="zoom-controls" role="group" aria-label="Zoom">
      <button type="button" title="Zoom out" aria-label="Zoom out" onClick={() => zoom.by(1 / ZOOM_STEP)}>−</button>
      <span className="zoom-level">{zoomLabel(zoom.scale)}</span>
      <button type="button" title="Zoom in" aria-label="Zoom in" onClick={() => zoom.by(ZOOM_STEP)}>+</button>
      <button type="button" title="Fit to width" aria-label="Fit to width" onClick={zoom.fit}><LucideIcon node={Shrink} size={11} /></button>
    </span>
  );
}

// `svg`: pele's markup; `label`: what it shows, for screen readers.
export function DiagramSvg({ svg, label, zoom, className }: { svg: string; label: string; zoom: Zoom; className: string }) {
  const natural = useRef(0);
  useLayoutEffect(() => {
    const el = diagramSvg(svg);
    natural.current = parseFloat(el?.getAttribute('width') ?? '');
    zoom.box.current?.replaceChildren(...(el ? [el] : []));
  }, [svg, zoom.box]);
  useLayoutEffect(() => {
    const el = zoom.box.current?.querySelector('svg');
    if (!el || !(natural.current > 0)) return;
    el.setAttribute('width', String(natural.current * (zoom.scale ?? 1)));
    el.style.maxWidth = zoom.scale === undefined ? '100%' : 'none';
  }, [svg, zoom.box, zoom.scale]);
  return <div className={className} ref={zoom.box} role="img" aria-label={label} />;
}
