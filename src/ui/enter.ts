import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

// Whether a key press is Enter, and not the one that ends an IME composition (Japanese, Chinese…):
// that one picks the text being composed, it does not send or accept. 229: the key code a browser
// gives while composing, also when it does not say isComposing.
export function isEnter(e: KeyboardEvent | ReactKeyboardEvent): boolean {
  const native = 'nativeEvent' in e ? e.nativeEvent : e;
  return e.key === 'Enter' && !native.isComposing && native.keyCode !== 229;
}
