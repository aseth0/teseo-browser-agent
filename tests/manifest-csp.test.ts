import { describe, expect, it } from 'vitest';
import config from '../wxt.config';

describe("the extension pages' content security policy", () => {
  it('loads images only from the extension or memory, and allows no form posts or base URL', () => {
    const manifest = config.manifest as { content_security_policy: { extension_pages: string } };
    const directives = manifest.content_security_policy.extension_pages.split(';').map((d) => d.trim());
    expect(directives).toEqual(expect.arrayContaining(["img-src 'self' data: blob:", "form-action 'none'", "base-uri 'none'", "script-src 'self' 'wasm-unsafe-eval'"]));
  });
});

describe('the keyboard shortcuts', () => {
  it('⌥⇧A opens the side panel itself, not the toolbar button\'s popup', () => {
    const { commands } = config.manifest as { commands: Record<string, { suggested_key?: { default: string } }> };
    expect(commands._execute_action).toBeUndefined();
    expect(commands['open-side-panel']?.suggested_key?.default).toBe('Alt+Shift+A');
  });
});
