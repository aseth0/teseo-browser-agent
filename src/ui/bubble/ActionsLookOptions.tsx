// Settings → Bubble → Actions: how the bubble's actions unfold on the pages (widget/actions-look):
// their shape, their layout, icons or names, their size. Beside them, the bubble with three sample
// actions unfolded, as pages show them.
import type { Appearance } from '../../storage/settings-types';
import { actionsLook } from '../../widget/actions-look';
import { Segmented } from '../Segmented';
import type { BubbleProps } from './BubbleLookOptions';
import { BubblePreview } from './BubblePreview';

type Options<K extends keyof Appearance> = { value: NonNullable<Appearance[K]>; label: string; title?: string }[];

const SHAPES: Options<'actionsShape'> = [{ value: 'square', label: 'Square' }, { value: 'rounded', label: 'Rounded' }, { value: 'circle', label: 'Circle' }];
const LAYOUTS: Options<'actionsLayout'> = [
  { value: 'column', label: 'Column', title: 'Above or below the bubble' },
  { value: 'row', label: 'Row', title: 'Beside the bubble' },
  { value: 'arc', label: 'Arc', title: 'A quarter circle around the bubble' },
  { value: 'ring', label: 'Ring', title: 'A circle around the bubble: an arc with more than 8 buttons, or without room for it' },
];
const LABELS: Options<'actionsLabels'> = [{ value: 'icon', label: 'Icon' }, { value: 'name', label: 'Icon and name' }];
const SIZES: Options<'actionsSize'> = [{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }];

export function ActionsLookOptions({ look, setLook }: BubbleProps) {
  const now = actionsLook(look);
  return (
    <div className="bubble-look">
      <div className="bubble-look-options">
        <div className="icon-field">
          <span>Shape</span>
          <Segmented label="Shape" value={now.shape} options={SHAPES} onChange={(actionsShape) => setLook({ actionsShape })} />
        </div>
        <div className="icon-field">
          <span>Layout</span>
          <Segmented label="Layout" value={now.layout} options={LAYOUTS} onChange={(actionsLayout) => setLook({ actionsLayout })} />
        </div>
        <div className="icon-field">
          <span>Shows</span>
          <Segmented label="Shows" value={look.actionsLabels === 'name' ? 'name' : 'icon'} options={LABELS} onChange={(actionsLabels) => setLook({ actionsLabels })} />
        </div>
        <div className="icon-field">
          <span>Size</span>
          <Segmented label="Size" value={now.size} options={SIZES} onChange={(actionsSize) => setLook({ actionsSize })} />
        </div>
        <p className="hint">
          They unfold away from the nearest edges of the window. Names show only in a column; elsewhere, icons, with the name when you point
          at one.
        </p>
      </div>
      <BubblePreview look={look} actions />
    </div>
  );
}
