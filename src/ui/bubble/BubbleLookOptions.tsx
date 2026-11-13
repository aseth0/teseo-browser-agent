// Settings → Bubble: what the page widget's bubble looks like. An icon, a shape with a face (eyes that
// may follow the pointer, a mouth, a hat, cheeks), or the user's SVG kept as a safe copy; its color,
// and how it shows that the folded floating chat works. Beside them, the bubble as pages show it.
import type { Appearance } from '../../storage/settings-types';
import { BubblePreview } from './BubblePreview';
import { BubbleIconPicker } from './BubbleIconPicker';
import { DrawnChoice, type DrawnOption } from '../DrawnChoice';
import { ShapeOptions } from './ShapeOptions';
import { SvgOptions } from './SvgOptions';
import { ThinkingDrawing, THINKING_VIEW_BOX } from './ThinkingDrawing';

export interface BubbleProps {
  look: Appearance;
  setLook: (patch: Partial<Appearance>) => void;
}

const LOOKS = [['icon', 'Icon'], ['shape', 'Shape'], ['svg', 'Your SVG']] as const;
const THINKING: DrawnOption<NonNullable<Appearance['bubbleThinking']> | ''>[] = [
  { id: '', label: 'Ring', drawing: <ThinkingDrawing as="ring" /> },
  { id: 'pulse', label: 'Pulse', drawing: <ThinkingDrawing as="pulse" /> },
  { id: 'thought', label: 'Thought bubble', drawing: <ThinkingDrawing as="thought" /> },
  { id: 'face', label: 'The face thinks', drawing: <ThinkingDrawing as="face" /> },
  { id: 'none', label: 'None', drawing: <ThinkingDrawing as="none" /> },
];

export function BubbleLookOptions({ look, setLook }: BubbleProps) {
  const face = look.bubbleFace ?? 'icon';
  return (
    <div className="bubble-look">
      <div className="bubble-look-options">
        <div className="icon-field">
          <span>Look</span>
          <div className="segmented" role="radiogroup" aria-label="Look">
            {LOOKS.map(([id, label]) => (
              <button key={id} type="button" role="radio" aria-checked={face === id} onClick={() => setLook({ bubbleFace: id === 'icon' ? undefined : id })}>{label}</button>
            ))}
          </div>
        </div>
        {face === 'icon' && <BubbleIconPicker look={look} setLook={setLook} />}
        {face === 'shape' && <ShapeOptions look={look} setLook={setLook} />}
        {face === 'svg' && <SvgOptions look={look} setLook={setLook} />}
        <ColorOptions look={look} setLook={setLook} />
        <DrawnChoice legend="While it works" name="bubble-thinking" size="thumb" viewBox={THINKING_VIEW_BOX} options={THINKING} value={look.bubbleThinking ?? ''} onChange={(id) => setLook({ bubbleThinking: id || undefined })} />
        <p className="hint">Shown while the floating chat is folded. Waiting for your approval and a new answer always show.</p>
      </div>
      <BubblePreview look={look} />
    </div>
  );
}

function ColorOptions({ look, setLook }: BubbleProps) {
  const own = !!look.bubbleColor;
  // Own color starts from the accent shown now.
  const accent = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  return (
    <div className="icon-field">
      <span>Color</span>
      <div className="row bubble-color">
        <label className="check"><input type="radio" name="bubble-color" checked={!own} onChange={() => setLook({ bubbleColor: undefined })} />Theme accent</label>
        <label className="check"><input type="radio" name="bubble-color" checked={own} onChange={() => setLook({ bubbleColor: accent() })} />Own color</label>
        {own && <input type="color" aria-label="Bubble color" value={look.bubbleColor} onChange={(e) => setLook({ bubbleColor: e.target.value })} />}
      </div>
    </div>
  );
}
