import { describe, expect, it } from 'vitest';
import { isEnter } from '../src/ui/enter';

const press = (key: string, init: { isComposing?: boolean; keyCode?: number } = {}) =>
  ({ key, isComposing: false, keyCode: key === 'Enter' ? 13 : 0, ...init }) as KeyboardEvent;

describe('isEnter', () => {
  it('is Enter, but not the one that ends an IME composition', () => {
    expect(isEnter(press('Enter'))).toBe(true);
    expect(isEnter(press('a'))).toBe(false);
    expect(isEnter(press('Enter', { isComposing: true }))).toBe(false);
    expect(isEnter(press('Enter', { keyCode: 229 }))).toBe(false);
  });

  it('reads a React event by its native one', () => {
    const react = { key: 'Enter', nativeEvent: press('Enter', { isComposing: true }) } as unknown as Parameters<typeof isEnter>[0];
    expect(isEnter(react)).toBe(false);
  });
});
