// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

// Every Settings section has its icon in the menu (ui/text-pages PAGE_ICONS).
vi.mock('wxt/browser', async () => (await import('./fakes/browser')).inertBrowser());
const { SETTINGS_SECTIONS } = await import('../src/ui/Settings');
const { pageIcon } = await import('../src/ui/text-pages');

describe('the Settings menu', () => {
  it('has an icon for every section', () => {
    expect(SETTINGS_SECTIONS.filter((s) => !pageIcon(s.id)).map((s) => s.id)).toEqual([]);
  });
});
