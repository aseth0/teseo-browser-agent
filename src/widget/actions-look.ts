// How the bubble's actions unfold (Settings → Bubble → Actions): their shape, their layout, icons or
// names, their size. Read from the appearance, what is absent or unknown (a newer build's) as the default.
import type { Appearance } from '../storage/settings-types';
import { fanOut } from './actions-fan';

export const ACTIONS_SHAPES = ['square', 'rounded', 'circle'] as const;
export const ACTIONS_LAYOUTS = ['column', 'row', 'arc', 'ring'] as const;
export const ACTIONS_LABELS = ['icon', 'name'] as const;
export const ACTIONS_SIZES = { small: 28, medium: 36, large: 44 } as const; // px

type Size = keyof typeof ACTIONS_SIZES;
const oneOf = <T extends string>(values: readonly T[], value: string | undefined): T => values.find((v) => v === value) ?? values[0]!;
const SIZE_NAMES = ['large', 'medium', 'small'] as const satisfies readonly Size[];

export function actionsLook(a: Appearance | undefined) {
  const layout = oneOf(ACTIONS_LAYOUTS, a?.actionsLayout);
  const size = oneOf(SIZE_NAMES, a?.actionsSize);
  return {
    shape: oneOf(ACTIONS_SHAPES, a?.actionsShape),
    layout,
    labels: layout === 'column' ? oneOf(ACTIONS_LABELS, a?.actionsLabels) : 'icon', // names only in a column
    size,
    px: ACTIONS_SIZES[size],
  };
}
export type ActionsLook = ReturnType<typeof actionsLook>;

// On the menu, for the widget's style (widget/ui/style.ts).
export function setActionsLook(menu: HTMLElement, look: ActionsLook) {
  menu.dataset.shape = look.shape;
  menu.dataset.layout = look.layout;
  menu.dataset.labels = look.labels;
  menu.dataset.size = look.size;
}

// Where they unfold for a bubble at (x, y) in a window of that size: away from its nearest edges, and on
// an arc or a ring each button moved to its place (--dx, --dy). Their order, for the keyboard too, stays.
export function placeActions(menu: HTMLElement, look: ActionsLook, at: { x: number; y: number }, view: { width: number; height: number }, bubble: number) {
  const buttons = [...menu.children] as HTMLElement[];
  const fan = fanOut({ count: buttons.length, size: look.px, bubble, ...at, ...view, ring: look.layout === 'ring' });
  menu.classList.toggle('up', fan.up);
  menu.classList.toggle('down', !fan.up);
  menu.classList.toggle('left', fan.left);
  menu.classList.toggle('right', !fan.left);
  const round = look.layout === 'arc' || look.layout === 'ring';
  buttons.forEach((b, i) => {
    if (!round) return void (b.style.removeProperty('--dx'), b.style.removeProperty('--dy'));
    b.style.setProperty('--dx', `${fan.at[i]!.dx}px`);
    b.style.setProperty('--dy', `${fan.at[i]!.dy}px`);
  });
}

// How far the unfolded actions reach beside the bubble, on the side they open to (px, 0 within its
// width): the card, beside it on that side too, goes past them.
export function actionsReach(menu: HTMLElement, bubble: DOMRect, left: boolean): number {
  let reach = 0;
  for (const b of menu.children) {
    const r = b.getBoundingClientRect();
    reach = Math.max(reach, left ? bubble.left - r.left : r.right - bubble.right);
  }
  return Math.ceil(reach);
}
