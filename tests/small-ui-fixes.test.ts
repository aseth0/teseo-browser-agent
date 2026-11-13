// @vitest-environment jsdom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { withMakeTool } from '../src/entrypoints/sidepanel/make-tool';
import { MAX_IMPORT_BYTES, readImportFile } from '../src/ui/import-file';

vi.mock('wxt/browser', () => ({ browser: { tabs: { create: async () => undefined } } }));
const { TitleLinks } = await import('../src/ui/TitleLinks');

describe('"Make a tool…" in the message box', () => {
  it('fills an empty box, and goes after a half-written message on a new line', () => {
    expect(withMakeTool('  ', 'Make a tool.')).toBe('Make a tool.');
    expect(withMakeTool('Also check the dates ', 'Make a tool.')).toBe('Also check the dates\nMake a tool.');
  });
});

describe('a file to import', () => {
  it('is not read when far larger than any export', async () => {
    const big = new File(['{}'], 'all.json');
    Object.defineProperty(big, 'size', { value: MAX_IMPORT_BYTES + 1 });
    const text = vi.spyOn(big, 'text');
    await expect(readImportFile(big)).rejects.toThrow('all.json is 101 MB: a file to import can be at most 100 MB.');
    expect(text).not.toHaveBeenCalled();
    await expect(readImportFile(new File(['{"a":1}'], 'small.json'))).resolves.toBe('{"a":1}');
  });
});

describe("a link in a conversation's title", () => {
  it('is a real link, reached with the keyboard', () => {
    const html = renderToStaticMarkup(createElement(TitleLinks, { title: 'See [the docs](https://docs.example.com/a)' }));
    expect(html).toContain('<a href="https://docs.example.com/a" target="_blank" rel="noopener noreferrer" class="title-link"');
  });
});
