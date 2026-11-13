// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

// {{page}}: the page's main text as Markdown. The widget in the page leaves it to the background (no
// Readability there), which reads it on the action's tab at Settings → Limits' size; the page script
// reads it for a site skill too. The other values are still the widget's, cut to 1,000 characters.
vi.mock('wxt/browser', async () => (await import('./fakes/browser')).emptyBrowser());
const { parseVariable, findVariables } = await import('../src/skills/variables');
const { actionProblems, newAction, pageTextNames, widgetReads } = await import('../src/widget/actions');
const { withPageText } = await import('../src/background/widget-page-text');
const { variableValues } = await import('../src/content/extractors');
const { resolveVariable } = await import('../src/content/page-values');
const { LIMIT_DEFS } = await import('../src/core/limits');

const action = (more: object) => ({ ...newAction(), id: 'a', name: 'Summarize', input: 'none' as const, prompt: 'Summarize: {article}', ...more });

describe('the variable', () => {
  it('is read as the page, found in a text, and resolved only by the page script', () => {
    expect(parseVariable('{{page}}')).toEqual({ kind: 'page' });
    expect(parseVariable('{{page:x}}')).toBeNull();
    expect(findVariables('Read {{page}} and {{url}}')).toEqual(['{{page}}', '{{url}}']);
    document.body.innerHTML = '<article><h1>Prices</h1><p>Prices rose for the third month in a row, analysts said on Monday.</p></article>';
    expect(resolveVariable(document, [], { kind: 'page' })).toBe(''); // not in the widget
    const read = variableValues(document, ['{{page}}'], 30)['{{page}}'] as { text: string; truncated: boolean };
    expect(read.text).toContain('Prices');
    expect(read.truncated).toBe(true);
  });

  it('has a limit of its own, which Settings → Limits changes', () => {
    expect(LIMIT_DEFS.actionPageText).toMatchObject({ value: 10000, unit: 'characters', range: [2000, 100000] });
  });
});

describe('an action that reads the page', () => {
  it('may be saved, as a value or as a step', () => {
    expect(actionProblems(action({ reads: { article: '{{page}}' } }))).toEqual([]);
    expect(actionProblems(action({ prompt: undefined, steps: [{ name: 'article', read: '{{page}}' }, { name: 'sum', prompt: 'Summarize: {article}' }], outputs: [{ label: 'Summary', from: 'sum' }] }))).toEqual([]);
  });

  it('leaves {{page}} to the background: the widget reads only the others', () => {
    const a = action({ reads: { article: '{{page}}', price: '{{meta:og:price}}' }, steps: undefined });
    expect(pageTextNames(a)).toEqual(['article']);
    expect(widgetReads(a)).toEqual({ price: '{{meta:og:price}}' });
  });

  it("gets the page's text under each name that reads it, on its tab", async () => {
    const a = action({ reads: { article: '{{page}}', price: '{{meta:og:price}}' } });
    const read = vi.fn(async () => '# Prices\n\nThey rose.');
    expect(await withPageText(a, { input: '', reads: { price: '12', article: 'from the page itself' } }, 7, read)).toEqual({ input: '', reads: { price: '12', article: '# Prices\n\nThey rose.' } });
    expect(read).toHaveBeenCalledWith(7);
  });

  it('none read without a tab, or when it reads no page; an error when the page cannot be read', async () => {
    const a = action({ reads: { article: '{{page}}' } });
    const read = vi.fn(async () => 'x');
    expect(await withPageText(a, { input: 'q' }, undefined, read)).toEqual({ input: 'q' });
    expect(await withPageText(action({ reads: {} }), { input: 'q' }, 7, read)).toEqual({ input: 'q' });
    expect(read).not.toHaveBeenCalled();
    expect(await withPageText(a, { input: '' }, 7, async () => { throw new Error('no access'); })).toEqual({ error: 'The page cannot be read: no access' });
  });
});
