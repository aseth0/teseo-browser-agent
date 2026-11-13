import { describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', async () => (await import('./fakes/browser')).emptyBrowser());
const { exportTemplates, importTemplates } = await import('../src/templates/io');
type PageTemplate = import('../src/templates/types').PageTemplate;

const shop: PageTemplate = { id: 's', name: 'shop', description: 'Products.', matches: ['*://shop.example.com/*'], enabled: true, createdBy: 'model',
  views: [{ name: 'main', paths: ['*'], replacePage: true, body: 'Product: {{ page | one: "h1" }}' }] };
const builtin: PageTemplate = { ...shop, id: 'builtin:ddg', name: 'duckduckgo-search', builtin: true };

describe('site templates as JSON', () => {
  it('exports yours with their views, not the built-in ones nor their on/off', () => {
    const { templates } = JSON.parse(exportTemplates([builtin, shop]));
    expect(templates).toEqual([{ name: 'shop', description: 'Products.', matches: ['*://shop.example.com/*'], views: shop.views }]);
  });

  it("keeps each view's description through export and import", () => {
    const described = { ...shop, views: [{ ...shop.views[0]!, description: 'The product.' }] };
    expect(importTemplates(exportTemplates([described]), []).templates[0]!.views[0]!.description).toBe('The product.');
  });

  it('imports them off, replacing yours of the same name, never a built-in one', () => {
    const json = exportTemplates([shop]);
    expect(importTemplates(json, []).templates[0]).toMatchObject({ name: 'shop', enabled: false, views: [{ name: 'main', replacePage: true }] });
    expect(importTemplates(json, [shop]).templates[0]!.id).toBe('s');
    const { templates, skipped } = importTemplates(JSON.stringify([{ ...JSON.parse(json).templates[0], name: 'duckduckgo-search' }, { name: 'empty', matches: [], views: [] }]), [builtin]);
    expect(templates).toEqual([]);
    expect(skipped[0]).toBe('duckduckgo-search: a built-in template has this name.');
    expect(skipped[1]).toMatch(/^empty: URL patterns/);
  });
});
