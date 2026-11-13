// Where the bubble's actions go: away from the nearest edges of the window, and for an arc or a ring
// each button's center, from the bubble's. Plain numbers, px.

export const ACTIONS_GAP = 8; // between the buttons, and between them and the bubble
export const RING_MAX = 8; // more buttons than this make an arc instead of a ring

export interface Fan {
  count: number; // buttons
  size: number; // of each
  bubble: number; // the bubble's size
  x: number; // the bubble's top left corner in the window
  y: number;
  width: number; // the window
  height: number;
  ring?: boolean; // a ring was chosen, not an arc
}

export interface FanOut {
  up: boolean; // they open upward (the bubble is in the lower half)
  left: boolean; // leftward (in the right half)
  ring: boolean; // a ring around the bubble (else a quarter circle)
  at: { dx: number; dy: number }[]; // each button's center, from the bubble's center
}

// Away from the nearest edges: upward from the lower half, leftward from the right half.
export function opening({ bubble, x, y, width, height }: Pick<Fan, 'bubble' | 'x' | 'y' | 'width' | 'height'>) {
  return { up: y + bubble / 2 > height / 2, left: x + bubble / 2 > width / 2 };
}

// The radius at which `count` buttons `step` radians apart do not touch, never closer to the bubble's
// center than the bubble's edge, the gap and half a button.
function radius(f: Fan, step: number) {
  const least = f.bubble / 2 + ACTIONS_GAP + f.size / 2;
  if (f.count < 2) return least;
  return Math.max(least, (f.size + ACTIONS_GAP) / (2 * Math.sin(step / 2)));
}

// A ring when chosen, with at most RING_MAX buttons and room for it in the window; else a quarter
// circle away from the nearest edges, its first button toward the top or the bottom and its last
// toward the side. The ring's first button is at the top, the others clockwise.
export function fanOut(f: Fan): FanOut {
  const { up, left } = opening(f);
  const cx = f.x + f.bubble / 2;
  const cy = f.y + f.bubble / 2;
  if (f.ring && f.count <= RING_MAX) {
    const step = (2 * Math.PI) / Math.max(f.count, 1);
    const r = radius(f, step);
    const reach = r + f.size / 2;
    if (cx - reach >= 0 && cx + reach <= f.width && cy - reach >= 0 && cy + reach <= f.height) {
      const at = Array.from({ length: f.count }, (_, i) => ({ dx: r * Math.sin(i * step), dy: -r * Math.cos(i * step) }));
      return { up, left, ring: true, at: at.map(rounded) };
    }
  }
  const step = f.count < 2 ? 0 : Math.PI / 2 / (f.count - 1);
  const r = radius(f, step);
  const at = Array.from({ length: f.count }, (_, i) => {
    const angle = f.count < 2 ? Math.PI / 4 : i * step; // from the vertical
    return { dx: (left ? -1 : 1) * r * Math.sin(angle), dy: (up ? -1 : 1) * r * Math.cos(angle) };
  });
  return { up, left, ring: false, at: at.map(rounded) };
}

const rounded = ({ dx, dy }: { dx: number; dy: number }) => ({ dx: Math.round(dx * 10) / 10 + 0, dy: Math.round(dy * 10) / 10 + 0 });
