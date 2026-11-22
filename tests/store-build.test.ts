import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../src/storage/settings-types';

// The Chrome Web Store's build (STORE=1, wxt.config.ts) has the debugger permission as the others do:
// the DevTools engine follows its setting in it too.
vi.mock('wxt/browser', () => ({ browser: { debugger: {} } }));
const on = { providers: [], systemPrompt: '', devtoolsTools: true } as unknown as Settings;
async function devtoolsOnIn(store: boolean | undefined) {
  vi.resetModules();
  if (store !== undefined) vi.stubGlobal('__STORE__', store);
  const { devtoolsOn } = await import('../src/storage/settings-select');
  return devtoolsOn(on);
}

afterEach(() => vi.unstubAllGlobals());

describe('the store build', () => {
  it('has the DevTools engine, as the setting says', async () => {
    expect(await devtoolsOnIn(true)).toBe(true);
  });
  it('the other builds, and the tests without the define, follow the setting too', async () => {
    expect(await devtoolsOnIn(false)).toBe(true);
    expect(await devtoolsOnIn(undefined)).toBe(true);
  });
});
