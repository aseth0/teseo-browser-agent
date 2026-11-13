// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The limits made changeable in Settings → Limits: clamped to their range, and applied where they cut,
// the page scripts included (they get the value with the request); and the sections that show them.
vi.mock('wxt/browser', async () => ({ browser: { ...(await import('./fakes/browser')).inertBrowser().browser, offscreen: {} } })); // offscreen: Settings → Speak is listed
const callPage = vi.fn();
vi.mock('../src/page/bridge', async (importOriginal) => ({ ...(await importOriginal<object>()), callPage: (...args: unknown[]) => callPage(...args) }));
const { LIMIT_DEFS, limit, pageTextDefault, setLimitOverrides } = await import('../src/core/limits');
const { selectionText, variableValues } = await import('../src/content/extractors');
const { buildPageContext, readPageValues } = await import('../src/context/pipeline');
const { pageTextChars, readTools } = await import('../src/tools/browser/read-tools');
const { SectionTop } = await import('../src/ui/SectionTop');
const { SECTION_TOPS } = await import('../src/ui/section-tops');
const { SettingsContext } = await import('../src/ui/settings-context');
const { SETTINGS_SECTIONS } = await import('../src/ui/Settings');
type LimitId = import('../src/core/limits').LimitId;
type Settings = import('../src/storage/settings').Settings;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  setLimitOverrides(undefined);
  callPage.mockReset();
});

describe('limits that can be changed now', () => {
  it('are clamped to their range', () => {
    setLimitOverrides({ pageElements: 5, readPageElements: 99_999, selection: 1000, skillItems: 3, mentions: 50, findInDomMatches: 40 });
    expect([limit('pageElements'), limit('readPageElements'), limit('selection'), limit('skillItems'), limit('mentions'), limit('findInDomMatches')]).toEqual([50, 5000, 1000, 10, 10, 40]);
  });

  it('let a page offer fewer WebMCP tools, never more', () => {
    setLimitOverrides({ webmcpTools: 100 });
    expect(limit('webmcpTools')).toBe(25);
    setLimitOverrides({ webmcpTools: 5 });
    expect(limit('webmcpTools')).toBe(5);
  });

  it('keep the ones that guard against a page or break saved templates fixed', () => {
    setLimitOverrides({ renderDepth: 10, webmcpDescription: 50, webmcpSchema: 50 });
    expect([limit('renderDepth'), limit('webmcpDescription'), limit('webmcpSchema')]).toEqual([3, 1000, 4000]);
    expect((Object.keys(LIMIT_DEFS) as LimitId[]).filter((id) => !LIMIT_DEFS[id].range)).toEqual(['renderDepth', 'webmcpDescription', 'webmcpSchema']);
  });
});

describe('the page text read when no size is asked', () => {
  it('is the page text limit, at most what a call may ask for, and the tool says so', () => {
    const maxChars = () => {
      const tool = readTools().find((t) => t.name === 'browser.get_page_text')!;
      return JSON.parse(JSON.stringify(tool.inputSchema)).properties.maxChars.description as string;
    };
    expect(maxChars()).toBe('Defaults to 7000');
    setLimitOverrides({ pageText: 30000 });
    expect([pageTextDefault(), pageTextChars(undefined)]).toEqual([30000, 30000]);
    expect(maxChars()).toBe('Defaults to 30000');
    setLimitOverrides({ pageText: 30000, pageTextMax: 8000 });
    expect(pageTextChars(undefined)).toBe(8000);
  });
});

describe('the page script', () => {
  it('cuts the selection and site skill lists to what the request says', () => {
    document.body.innerHTML = `<p id="s">${'x'.repeat(800)}</p><ul>${'<li>item</li>'.repeat(30)}</ul>`;
    getSelection()!.selectAllChildren(document.getElementById('s')!);
    expect(selectionText(document, 600)).toMatchObject({ truncated: true, max: 600 });
    expect(selectionText(document).truncated).toBe(false); // the default, 4,000
    const token = '{{items:li; text=}}';
    const value = variableValues(document, [token], 2000, 12)[token]!;
    expect('items' in value && [value.items.length, value.total]).toEqual([12, 30]);
  });

  it('gets the limits as set in Settings with the request', async () => {
    setLimitOverrides({ pageElements: 120, selection: 900, skillValue: 500, skillItems: 40 });
    callPage.mockResolvedValueOnce({ meta: { url: 'https://example.com/', title: '', lang: '', viewport: '', scroll: '' }, selection: { text: '' }, snapshot: { text: '' } });
    await buildPageContext(1);
    expect(callPage).toHaveBeenLastCalledWith(1, { op: 'context', maxNodes: 120, maxChars: 900 });
    callPage.mockResolvedValueOnce({});
    await readPageValues(1, ['{{url}}']);
    expect(callPage).toHaveBeenLastCalledWith(1, { op: 'values', vars: ['{{url}}'], maxChars: 500, maxItems: 40 });
  });
});

describe('the top of a settings section', () => {
  const commands = [...readFileSync('wxt.config.ts', 'utf8').matchAll(/^\s+'([a-z-]+)': \{ (?:suggested_key|description)/gm)].map((m) => m[1]!);

  it('names sections, commands and limits that exist', () => {
    const ids = SETTINGS_SECTIONS.map((s) => s.id);
    expect(Object.keys(SECTION_TOPS).filter((id) => !ids.includes(id))).toEqual([]);
    const tops = Object.values(SECTION_TOPS);
    expect(tops.flatMap((t) => t.shortcuts ?? []).filter((c) => !commands.includes(c))).toEqual([]);
    expect(tops.flatMap((t) => [...(t.limits ?? []), ...(t.more ?? [])]).filter((id) => !(id in LIMIT_DEFS))).toEqual([]);
  });

  it('shows every limit and every command somewhere', () => {
    const tops = Object.values(SECTION_TOPS);
    const shown = new Set(tops.flatMap((t) => [...(t.limits ?? []), ...(t.more ?? [])]));
    expect(Object.keys(LIMIT_DEFS).filter((id) => !shown.has(id as LimitId))).toEqual([]);
    const keys = new Set(tops.flatMap((t) => t.shortcuts ?? []));
    expect(commands.filter((c) => !keys.has(c))).toEqual([]);
  });
});

describe('a limit at the top of a section', () => {
  it('sets the same stored value as Settings → Limits, and back to its default', async () => {
    const changes: unknown[] = [];
    const settings = { limits: { memory: 6000 } } as Settings;
    const update = (c: unknown) => void changes.push(c);
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => root.render(createElement(SettingsContext.Provider, { value: { settings, update, save: async () => undefined } }, createElement(SectionTop, { page: 'memory' }))));
    const box = host.querySelector<HTMLInputElement>(`input[aria-label="${LIMIT_DEFS.memory.label} limit"]`)!;
    expect(box.value).toBe('6000');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, '9000');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label^="Reset Memory index"]')!.click());
    expect(changes).toEqual([{ limits: { memory: 9000 } }, { limits: {} }]);
    expect(host.querySelectorAll('.section-top input[type="number"]')).toHaveLength(3); // pinned, index, site items
    act(() => root.unmount());
  });
});
