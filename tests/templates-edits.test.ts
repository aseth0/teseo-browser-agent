import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tool, ToolContext } from '../src/core/types';
import type { PageTemplate } from '../src/templates/types';
import { fakeBrowser, fakeStorage } from './fakes/browser';

// templates.save and templates.run change a saved template's views by name: by edits, added, taken out.
const storage = fakeStorage();
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage, { tabs: { get: async () => ({ url: 'https://shop.example.com/p/1' }) } }) }));
const ran = vi.fn(async (_tab: number, _t: PageTemplate) => ({ view: undefined, results: [] }));
vi.mock('../src/templates/run', () => ({ runPageTemplate: (tab: number, t: PageTemplate) => ran(tab, t) }));
vi.mock('../src/templates/render', async (original) => ({ ...(await original<object>()), templateDiagnosis: () => 'diagnosis' }));
const { templateStore } = await import('../src/templates/store');
const { templateTools } = await import('../src/templates/tools');

const tool = (name: string) => templateTools().find((t) => t.name === name) as Tool & Required<Pick<Tool, 'describe'>>;
const ctx = { signal: new AbortController().signal, tabId: 1 } as ToolContext;
const LIST = '{%- assign rows = page | select: "li" %}\n{%- for r in rows %}\n- {{ r | strip }}\n{%- endfor %}';
const shop: PageTemplate = {
  id: 'shop',
  name: 'shop',
  description: 'Products.',
  matches: ['*://shop.example.com/*'],
  views: [
    { name: 'product', paths: ['/p/*'], replacePage: true, body: 'Product: {{ page | one: "h1" }}' },
    { name: 'list', paths: ['*'], replacePage: false, body: LIST },
  ],
  enabled: true,
};
const saved = async () => (await templateStore.load()).find((t) => t.name === 'shop')!;

beforeEach(async () => {
  storage.reset();
  ran.mockClear();
  await templateStore.save(shop);
});

describe('templates.save of a saved template', () => {
  it("sets a view's description, keeps it when not given, and takes it out with an empty one", async () => {
    const call = { name: 'shop', views: [{ name: 'product', description: ' The product: name, price. ' }] };
    expect((await tool('templates.save').describe(call, ctx)).details?.[2]?.label).toBe('View "product" · paths: /p/* · replaces the page\'s visible elements · The product: name, price. (was: View "product" · paths: /p/* · replaces the page\'s visible elements)');
    await tool('templates.save').run(call, ctx);
    expect((await saved()).views[0]!.description).toBe('The product: name, price.');
    await tool('templates.save').run({ name: 'shop', views: [{ name: 'product', paths: ['/p/*', '/item/*'] }] }, ctx);
    expect((await saved()).views[0]).toMatchObject({ paths: ['/p/*', '/item/*'], description: 'The product: name, price.' });
    await tool('templates.save').run({ name: 'shop', views: [{ name: 'product', description: '' }] }, ctx);
    expect((await saved()).views[0]).not.toHaveProperty('description');
  });

  it('changes one view by edits, keeping the others and the rest of the template', async () => {
    const call = { name: 'shop', views: [{ name: 'list', edits: [{ old: '- {{ r | strip }}', new: '- {{ r | strip | truncate: 80 }}' }] }] };
    const card = await tool('templates.save').describe(call, ctx);
    expect(card.summary).toBe('Update the site template "shop"');
    expect(card.details).toEqual([
      { label: 'Websites', value: '*://shop.example.com/*', edit: { field: 'urlPatterns', value: '*://shop.example.com/*', lines: 'list' } },
      { label: 'Description', value: 'Products.', edit: { field: 'description', value: 'Products.' } },
      { label: 'View "product" · paths: /p/* · replaces the page\'s visible elements', value: 'Unchanged' },
      {
        label: 'View "list" · paths: *',
        value: '  {%- assign rows = page | select: "li" %}\n  {%- for r in rows %}\n− - {{ r | strip }}\n+ - {{ r | strip | truncate: 80 }}\n  {%- endfor %}',
        diff: true,
        code: true,
      },
    ]);
    expect(await tool('templates.save').run(call, ctx)).not.toHaveProperty('isError');
    const t = await saved();
    expect(t).toMatchObject({ matches: shop.matches, description: 'Products.' });
    expect(t.views.map((v) => v.name)).toEqual(['product', 'list']);
    expect(t.views[1]!.body).toBe(LIST.replace('- {{ r | strip }}', '- {{ r | strip | truncate: 80 }}'));
    expect(t.views[0]).toEqual(shop.views[0]);
  });

  it('adds a view at the end or before another, and takes one out', async () => {
    const view = { name: 'cart', paths: ['/cart'], template: 'Cart: {{ page | one: ".total" }}' };
    await tool('templates.save').run({ name: 'shop', views: [{ ...view, before: 'list' }] }, ctx);
    expect((await saved()).views.map((v) => v.name)).toEqual(['product', 'cart', 'list']);
    const card = await tool('templates.save').describe({ name: 'shop', views: [{ name: 'product', remove: true }, { name: 'help', paths: ['/help'], template: '{{ page | one: "h1" }}' }] }, ctx);
    expect(card.details).toContainEqual({ label: 'View "help" · paths: /help', value: '+ {{ page | one: "h1" }}', diff: true, code: true });
    expect(card.details).toContainEqual({ label: 'View "product" · paths: /p/* · replaces the page\'s visible elements', value: '− Product: {{ page | one: "h1" }}', diff: true, code: true });
    await tool('templates.save').run({ name: 'shop', views: [{ name: 'product', remove: true }, { name: 'help', paths: ['/help'], template: '{{ page | one: "h1" }}' }] }, ctx);
    expect((await saved()).views.map((v) => v.name)).toEqual(['cart', 'list', 'help']);
  });

  it('changes a view\'s paths alone, the card saying what they were', async () => {
    const card = await tool('templates.save').describe({ name: 'shop', views: [{ name: 'product', paths: ['/item/*'] }] }, ctx);
    expect(card.details).toContainEqual({ label: 'View "product" · paths: /item/* · replaces the page\'s visible elements (was: View "product" · paths: /p/* · replaces the page\'s visible elements)', value: 'Unchanged' });
  });

  it('says what keeps a change from being made', async () => {
    const run = (views: object[]) => tool('templates.save').run({ name: 'shop', views }, ctx);
    expect(await run([{ name: 'gone', remove: true }])).toMatchObject({ isError: true, text: expect.stringContaining('No view "gone" to remove: its views are product, list.') });
    expect(await run([{ name: 'cart', template: '{{ page | one: "h1" }}', before: 'gone' }])).toMatchObject({ isError: true, text: expect.stringContaining('No view "gone" to put "cart" before: its views are product, list.') });
    expect(await run([{ name: 'cart', edits: [{ old: 'a', new: 'b' }] }])).toMatchObject({ isError: true, text: expect.stringContaining('There is no view "cart" to edit: give its whole "template" to add it.') });
    expect(await run([{ name: 'list', edits: [{ old: 'r', new: 'x' }] }])).toMatchObject({
      isError: true,
      text: expect.stringContaining('Edit 1: this "old" appears 7 times in the template of the view "list": "r". Quote more of the text around it, so that it appears once.'),
    });
    expect(await saved()).toEqual(shop);
  });

  it('a new template still needs its websites and views', async () => {
    const result = await tool('templates.save').run({ name: 'news' }, ctx);
    expect(result).toMatchObject({ isError: true, text: expect.stringContaining('URL patterns: at least one') });
  });
});

describe('templates.run', () => {
  it('with a name and views, runs the saved template with those views changed', async () => {
    await tool('templates.run').run({ name: 'shop', views: [{ name: 'product', edits: [{ old: 'Product:', new: 'Item:' }] }] }, ctx);
    const t = ran.mock.calls[0]![1];
    expect(t.views.map((v) => v.body)).toEqual(['Item: {{ page | one: "h1" }}', LIST]);
    await expect(tool('templates.run').run({ name: 'shop', views: [{ name: 'product', edits: [{ old: 'Nope', new: '' }] }] }, ctx)).rejects.toThrow(/Edit 1: this "old" is not in the template of the view "product"/);
  });

  it('with views alone, runs them as a draft', async () => {
    await tool('templates.run').run({ views: [{ name: 'main', paths: ['*'], template: '{{ page | one: "h1" }}' }] }, ctx);
    expect(ran.mock.calls[0]![1]).toMatchObject({ name: 'draft', views: [{ name: 'main', body: '{{ page | one: "h1" }}' }] });
  });
});
