import { useEffect, useRef } from 'react';
import { svgFromTree } from '../../widget/bubble-face';
import { BUBBLE_EYES, BUBBLE_HATS, BUBBLE_MOUTHS, BUBBLE_SHAPES, bubbleLook, type SvgNode } from '../../widget/bubble-look';
import type { BubbleProps } from './BubbleLookOptions';
import { useReducedMotion } from './useReducedMotion';

// An SVG drawn from its tree (widget/bubble-look), as the widget draws it.
function SvgTree({ node }: { node: SvgNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => void ref.current?.replaceChildren(svgFromTree(node)), [node]);
  return <span className="svg-tree" ref={ref} aria-hidden="true" />;
}

const thumb = (id: string): SvgNode => ['svg', { viewBox: '0 0 44 44', width: 28, height: 28 }, BUBBLE_SHAPES[id]!.body];
const THUMBS = Object.fromEntries(Object.keys(BUBBLE_SHAPES).map((id) => [id, thumb(id)]));
const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)]!;

export function ShapeOptions({ look, setLook }: BubbleProps) {
  const reduced = useReducedMotion();
  const shown = bubbleLook(look);
  const hasFace = !!BUBBLE_SHAPES[shown.shape]!.face;
  const eyes = shown.eyes && BUBBLE_EYES[shown.eyes];
  const surprise = () => {
    const faced = Object.keys(BUBBLE_SHAPES).filter((id) => BUBBLE_SHAPES[id]!.face);
    setLook({
      bubbleShape: pick(faced), bubbleEyes: pick(Object.keys(BUBBLE_EYES)), bubbleMouth: pick([undefined, ...Object.keys(BUBBLE_MOUTHS)]),
      bubbleHat: pick([undefined, ...Object.keys(BUBBLE_HATS)]), bubbleCheeks: Math.random() < 0.4,
    });
  };
  return (
    <>
      <div className="shape-grid" role="radiogroup" aria-label="Shape">
        {Object.entries(BUBBLE_SHAPES).map(([id, { label }]) => (
          <button key={id} type="button" role="radio" aria-checked={shown.shape === id} aria-label={label} className="shape-choice" onClick={() => setLook({ bubbleShape: id })}>
            <SvgTree node={THUMBS[id]!} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      {!look.bubbleColor && <p className="hint">Drawn in the theme's accent color.</p>}
      {!hasFace ? <p className="hint">Dots and Bars have no face.</p> : (
        <fieldset className="settings-block">
          <legend>Face</legend>
          <div className="row">
            <PartSelect label="Eyes" value={shown.eyes} parts={BUBBLE_EYES} set={(bubbleEyes) => setLook({ bubbleEyes })} />
            <PartSelect label="Mouth" value={shown.mouth} parts={BUBBLE_MOUTHS} set={(bubbleMouth) => setLook({ bubbleMouth })} />
            <PartSelect label="Hat" value={shown.hat} parts={BUBBLE_HATS} set={(bubbleHat) => setLook({ bubbleHat })} />
          </div>
          <label className="check">
            <input type="checkbox" checked={!!look.bubbleCheeks} onChange={(e) => setLook({ bubbleCheeks: e.target.checked || undefined })} />
            Cheeks
          </label>
          <label className="check">
            <input type="checkbox" disabled={!eyes} checked={!!look.bubbleEyesFollow} onChange={(e) => setLook({ bubbleEyesFollow: e.target.checked || undefined })} />
            Follow the mouse pointer
          </label>
          {eyes && !eyes.moves && <p className="hint">These eyes stay still.</p>}
          {eyes && eyes.moves && look.bubbleEyesFollow && (
            <p className="hint">They follow the pointer on the page you are on. Over embedded frames, such as videos or the floating chat, they keep looking where they last saw it.</p>
          )}
          {eyes && reduced && <p className="hint">Your system asks for reduced motion: the eyes stay still and do not blink.</p>}
          <div className="row">
            <button type="button" onClick={surprise}>Surprise me</button>
          </div>
        </fieldset>
      )}
    </>
  );
}

// One part of the face (eyes, mouth, hat) by its name, or none.
function PartSelect({ label, value, parts, set }: { label: string; value?: string; parts: Record<string, { label: string }>; set: (id: string | undefined) => void }) {
  return (
    <label>{label}
      <select value={value ?? ''} onChange={(e) => set(e.target.value || undefined)}>
        <option value="">None</option>
        {Object.entries(parts).map(([id, part]) => <option key={id} value={id}>{part.label}</option>)}
      </select>
    </label>
  );
}
