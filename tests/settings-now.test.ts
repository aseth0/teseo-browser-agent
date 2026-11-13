import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '../src/storage/settings';

// The background applies the texts, limits and dedupe only when they change, not on every settingsNow().
let stored = { providers: [], promptTexts: { a: 'one' }, limits: {} } as unknown as Settings;
const applyModelSettings = vi.fn();
vi.mock('wxt/browser', async () => (await import('./fakes/browser')).emptyBrowser());
vi.mock('../src/storage/settings', async (original) => ({ ...(await original<object>()), loadSettings: async () => stored }));
vi.mock('../src/context/model-settings', async (original) => ({ ...(await original<object>()), applyModelSettings: (s: Settings) => applyModelSettings(s) }));
const { settingsNow } = await import('../src/background/settings');

describe('settingsNow', () => {
  it('applies the texts and limits on first use and after a change only', async () => {
    await settingsNow();
    await settingsNow();
    expect(applyModelSettings).toHaveBeenCalledTimes(1);
    stored = { ...stored, limits: { pageChars: 100 } } as unknown as Settings;
    expect(await settingsNow()).toBe(stored);
    await settingsNow();
    expect(applyModelSettings).toHaveBeenCalledTimes(2);
    expect(applyModelSettings).toHaveBeenLastCalledWith(stored);
  });

  it("applies them again once what is not sent again changes (Settings → Compaction)", async () => {
    await settingsNow();
    applyModelSettings.mockClear();
    stored = { ...stored, context: { dedupe: { enabled: false } } } as unknown as Settings;
    await settingsNow();
    expect(applyModelSettings).toHaveBeenCalledTimes(1);
  });
});
