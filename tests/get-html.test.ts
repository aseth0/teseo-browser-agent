// @vitest-environment jsdom
// browser.get_html: the page's markup, cleaned, in pieces that fit a tool result.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanHtml, getHtml } from '../src/content/dom-html';
import type { PageRequest } from '../src/page/protocol';
import { TOOL_SETTINGS } from './helpers';

// The page's side of callPage: the request answered by getHtml on this document.
vi.mock('wxt/browser', () => ({
  browser: {
    tabs: {
      get: async () => ({ id: 7, url: 'https://shop.test/', title: 'Shop', status: 'complete' }),
      sendMessage: async (_tab: number, msg: { req: PageRequest }) => {
        const req = msg.req as Extract<PageRequest, { op: 'get-html' }>;
        try {
          return { ok: true, data: getHtml(document, req.selector, { from: req.from, max: req.max }) };
        } catch (e) {
          return { ok: false, error: (e as Error).message };
        }
      },
    },
    scripting: { executeScript: async () => [{ result: null }] },
  },
}));

const { readTools, htmlChars } = await import('../src/tools/browser/read-tools');
const { stripMarks } = await import('../src/core/model-texts');
const tool = readTools().find((t) => t.name === 'browser.get_html')!;
const run = async (args: Record<string, unknown>) => {
  const res = await tool.run(args, { settings: TOOL_SETTINGS, signal: new AbortController().signal, tabId: 7 });
  return stripMarks((res as { type: 'text'; text: string }).text);
};
const html = (markup: string) => {
  document.body.innerHTML = markup;
  return cleanHtml(document.body.firstElementChild!);
};

beforeEach(() => {
  document.body.innerHTML = `
    <ul class="products">
      <li class="product"><a href="/p/1"><span class="name">Cable</span></a> <b class="price">5 €</b></li>
      <li class="product"><a href="/p/2"><span class="name">Plug</span></a> <b class="price">3 €</b></li>
    </ul>`;
});

describe('cleanHtml', () => {
  it('leaves out scripts, styles, noscript and comments', () => {
    expect(html('<div id="a"><script>x()</script><style>p{}</style><noscript>on</noscript><!-- note --><p>Hi</p></div>')).toBe('<div id="a"><p>Hi</p></div>');
  });

  it('keeps an svg without what is inside it', () => {
    expect(html('<button><svg class="icon" viewBox="0 0 9 9"><path d="M0 0L9 9"></path></svg>Buy</button>')).toBe('<button><svg class="icon" viewBox="0 0 9 9"></svg>Buy</button>');
  });

  it('keeps the HTML in an svg\'s foreignObjects, through its groups', () => {
    expect(html('<div><svg viewBox="0 0 9 9"><path d="M0 0"></path><g><foreignObject width="9" height="9"><div role="treeitem">Space</div></foreignObject></g></svg></div>')).toBe(
      '<div><svg viewBox="0 0 9 9"><foreignObject width="9" height="9"><div role="treeitem">Space</div></foreignObject></svg></div>',
    );
  });

  it('collapses whitespace, in text and attributes', () => {
    expect(html('<p class="a\n   b">  Two\n\n words  <i>x</i>\n</p>')).toBe('<p class="a b"> Two words <i>x</i></p>');
  });

  it('cuts long attributes: style, srcset and data URIs to a short start, any other at 200', () => {
    const style = 'color: red; '.repeat(10);
    const out = html(`<img src="data:image/png;base64,${'A'.repeat(500)}" srcset="${'a.jpg 1x, '.repeat(20)}" style="${style}" alt="${'x'.repeat(300)}">`);
    expect(out).toBe(`<img src="data:image/png;base64,AAAAAAAAAAAAAAAAAA…" srcset="${'a.jpg 1x, '.repeat(4)}…" style="${style.slice(0, 40)}…" alt="${'x'.repeat(200)}…">`);
  });

  it('escapes text and attributes, and never shows a password field\'s value', () => {
    expect(html('<form><input type="password" value="hunter2"><label title="a &quot;b&quot;">1 &lt; 2 &amp; 3</label></form>')).toBe(
      '<form><input type="password" value="••••"><label title="a &quot;b&quot;">1 &lt; 2 &amp; 3</label></form>',
    );
  });

  it('shows an open shadow root as declarative shadow DOM', () => {
    document.body.innerHTML = '<x-card><span>light</span></x-card>';
    document.querySelector('x-card')!.attachShadow({ mode: 'open' }).innerHTML = '<h2 part="title">Shadow</h2><slot></slot>';
    expect(cleanHtml(document.body.firstElementChild!)).toBe('<x-card><template shadowrootmode="open"><h2 part="title">Shadow</h2><slot></slot></template><span>light</span></x-card>');
  });
});

describe('getHtml', () => {
  it('reads one match whole', () => {
    expect(getHtml(document, '.product:first-child .name', { max: 1000 })).toEqual({ text: '<span class="name">Cable</span>', next: 31, total: 31, count: 1 });
  });

  it('numbers several matches', () => {
    const { text, count } = getHtml(document, '.price', { max: 1000 });
    expect(count).toBe(2);
    expect(text).toBe('<!-- 1 of 2 -->\n<b class="price">5 €</b>\n<!-- 2 of 2 -->\n<b class="price">3 €</b>');
  });

  it('shows an element inside another match only once, inside it', () => {
    const { text, count } = getHtml(document, 'ul, li', { max: 1000 });
    expect(count).toBe(1);
    expect(text.startsWith('<ul class="products">')).toBe(true);
  });

  it('reads on from a character', () => {
    const whole = getHtml(document, 'ul', { max: 10_000 });
    const first = getHtml(document, 'ul', { max: 50 });
    expect(first).toMatchObject({ text: whole.text.slice(0, 50), next: 50, total: whole.text.length });
    const rest = getHtml(document, 'ul', { from: first.next, max: 10_000 });
    expect(first.text + rest.text).toBe(whole.text);
    expect(rest.next).toBe(whole.total);
  });

  it('finds matches inside open shadow roots', () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="host"></div>');
    document.querySelector('#host')!.attachShadow({ mode: 'open' }).innerHTML = '<p class="deal">-20%</p>';
    expect(getHtml(document, '.deal', { max: 100 }).text).toBe('<p class="deal">-20%</p>');
  });

  it('says what the browser said about an invalid selector', () => {
    expect(() => getHtml(document, 'div[', { max: 100 })).toThrow(/^Invalid CSS selector "div\[": .+/);
  });
});

describe('browser.get_html', () => {
  it('wraps the markup as page content, from body by default', async () => {
    const out = await run({});
    expect(out).toMatch(/^<untrusted_page_content source="browser.get_html">\n<body><ul class="products"><li class="product"><a href="\/p\/1">/);
    expect(out).not.toContain('[cut at');
  });

  it('says where it was cut and how to read on', async () => {
    const out = await run({ selector: 'ul', maxChars: 40 });
    const total = getHtml(document, 'ul', { max: 1 }).total;
    expect(out).toContain(`\n…[cut at 40 of ${total} characters: call it again with from=40 to read on]`);
    expect(await run({ selector: 'ul', from: 40 })).not.toContain('[cut at');
  });

  it('reads from 0, from the exact end, and from beyond it', async () => {
    const total = getHtml(document, 'ul', { max: 1 }).total;
    expect(getHtml(document, 'ul', { from: 0, max: total })).toMatchObject({ next: total, total });
    expect(getHtml(document, 'ul', { from: 0, max: total - 1 })).toMatchObject({ next: total - 1 });
    expect(getHtml(document, 'ul', { from: total, max: 100 })).toMatchObject({ text: '', next: total });
    expect(getHtml(document, 'ul', { from: total + 50, max: 100 })).toMatchObject({ text: '', next: total });
    expect(await run({ selector: 'ul', from: 0, maxChars: total })).not.toContain('[cut at');
    expect(await run({ selector: 'ul', from: 0, maxChars: total - 1 })).toContain(`[cut at ${total - 1} of ${total} characters`);
    expect(await run({ selector: 'ul', from: total + 50 })).toBe('<untrusted_page_content source="browser.get_html">\n\n</untrusted_page_content>');
  });

  it('never reads more than fits in a tool result', () => {
    expect(htmlChars(10 ** 9)).toBe(htmlChars(undefined));
    expect(htmlChars(500)).toBe(500);
  });

  it('says when nothing matches', async () => {
    expect(await run({ selector: 'video' })).toBe('No element matches "video"');
  });
});
