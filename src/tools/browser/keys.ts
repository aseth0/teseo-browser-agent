// The keys browser.press_key may press on the engine, with what Input.dispatchKeyEvent needs for each, and the
// text a key types (Enter, Space).
export const KEYS: Record<string, { code: string; vk: number }> = {
  Enter: { code: 'Enter', vk: 13 },
  Tab: { code: 'Tab', vk: 9 },
  Escape: { code: 'Escape', vk: 27 },
  Backspace: { code: 'Backspace', vk: 8 },
  Delete: { code: 'Delete', vk: 46 },
  Space: { code: 'Space', vk: 32 },
  ArrowUp: { code: 'ArrowUp', vk: 38 },
  ArrowDown: { code: 'ArrowDown', vk: 40 },
  ArrowLeft: { code: 'ArrowLeft', vk: 37 },
  ArrowRight: { code: 'ArrowRight', vk: 39 },
  Home: { code: 'Home', vk: 36 },
  End: { code: 'End', vk: 35 },
  PageUp: { code: 'PageUp', vk: 33 },
  PageDown: { code: 'PageDown', vk: 34 },
};

export const KEY_TEXT: Record<string, string> = { Enter: '\r', Space: ' ' };

export const MODIFIERS = ['Shift', 'Control', 'Alt', 'Meta'] as const;
const BITS: Record<string, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };

// CDP's modifiers bit field.
export const modifierMask = (mods: readonly string[]) => mods.reduce((sum, m) => sum | (BITS[m] ?? 0), 0);
