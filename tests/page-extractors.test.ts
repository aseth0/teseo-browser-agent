// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { Readability } from '@mozilla/readability';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { find, RefStore, snapshot } from '../src/content/a11y';
import { describeElement } from '../src/content/a11y-names';
import { pageMeta, readableMarkdown, selectionText, structuredData, variableValues } from '../src/content/extractors';
import { findVariables, parseVariable } from '../src/skills/variables';

const html = readFileSync('tests/fixtures/shop.html', 'utf8');

beforeEach(() => {
  document.documentElement.innerHTML = html.replace(/^<!doctype html>\s*<html[^>]*>/i, '').replace(/<\/html>\s*$/, '');
  document.documentElement.lang = 'en';
  // Open shadow DOM with a button inside.
  const host = document.querySelector('shadow-host')!;
  host.attachShadow({ mode: 'open' }).innerHTML = '<button>Button in shadow DOM</button>';
});

describe('a11y snapshot', () => {
  it('lists landmarks, headings and interactive elements with refs and state', () => {
    const { text } = snapshot(document, new RefStore());
    expect(text).toMatch(/^navigation "Main": /m);
    expect(text).toMatch(/\[Deals\]\(\/deals\) \[ref_\w+\]/);
    expect(text).toMatch(/searchbox "Search products" \[ref_\w+\] value="headphones"/);
    expect(text).toMatch(/^# X1 Headphones$/m);
    expect(text).toMatch(/combobox "Color" \[ref_\w+\] value="White"/);
    expect(text).not.toContain('option "Black"');
    expect(text).toMatch(/^search: searchbox/m);
    expect(text).toMatch(/checkbox "Add extended warranty" \[ref_\w+\] checked/);
    expect(text).toMatch(/button "Buy now" \[ref_\w+\]/);
    expect(text).toMatch(/button "Add to favorites" \[ref_\w+\]/);
    expect(text).toContain('img "Photo of the X1 headphones"');
    expect(text).toMatch(/button "Button in shadow DOM" \[ref_\w+\]/);
  });

  it('never leaks hidden elements, scripts, javascript: hrefs or passwords', () => {
    const { text } = snapshot(document, new RefStore());
    expect(text).not.toContain('hidden by CSS');
    expect(text).not.toContain('Button with hidden');
    expect(text).not.toContain('Button aria-hidden');
    expect(text).not.toContain('must not appear');
    expect(text).not.toContain('javascript:');
    expect(text).not.toContain('secret');
    expect(text).toContain('value="••••"');
    expect(text).not.toContain('decoration');
  });

  it('interactive filter drops plain text but keeps structure', () => {
    const all = snapshot(document, new RefStore()).text;
    const interactive = snapshot(document, new RefStore(), { filter: 'interactive' }).text;
    expect(all).toMatch(/^Active noise cancelling/m);
    expect(interactive).not.toContain('Active noise cancelling');
    expect(interactive).toContain('button "Buy now"');
    expect(interactive.length).toBeLessThan(all.length);
  });

  it('keeps refs stable across snapshots and resolves them back to elements', () => {
    const refs = new RefStore();
    const ref = snapshot(document, refs).text.match(/button "Buy now" \[(ref_\w+)\]/)![1]!;
    expect(snapshot(document, refs).text).toContain(`button "Buy now" [${ref}]`);
    expect(refs.get(ref)).toBe(document.getElementById('buy'));
    document.getElementById('buy')!.remove();
    expect(refs.get(ref)).toBeUndefined();
  });

  it("refuses a ref read from another document (before a navigation), even at the same position", () => {
    const before = new RefStore(); // the page before the navigation
    const ref = snapshot(document, before).text.match(/button "Buy now" \[(ref_\w+)\]/)![1]!;
    const after = new RefStore(); // the next page's, in the same order
    snapshot(document, after);
    expect(ref).toMatch(/^ref_[a-z0-9]{3}_\d+$/);
    expect(after.get(ref)).toBeUndefined();
    expect(before.get(ref)).toBe(document.getElementById('buy'));
  });

  it('can snapshot a subtree by root and truncates by maxNodes', () => {
    const refs = new RefStore();
    const nav = snapshot(document, refs, { root: document.querySelector('nav')! }).text;
    expect(nav).toContain('Deals');
    expect(nav).not.toContain('Buy now');
    const small = snapshot(document, refs, { maxNodes: 3 });
    expect(small.truncated).toBe(true);
    expect(small.text).not.toContain('truncated'); // the background adds the marker
  });

  it('keeps the own text of elements with a role (status messages)', () => {
    expect(snapshot(document, new RefStore()).text).toMatch(/^status: Cart: empty$/m);
  });

  it('describes elements for confirmations', () => {
    expect(describeElement(document.getElementById('buy')!)).toBe('button "Buy now"');
    expect(describeElement(document.getElementById('q')!)).toBe('searchbox "Search products"');
  });

  it('find matches all words case-insensitively', () => {
    const refs = new RefStore();
    expect(find(document, refs, 'BUY now').lines).toEqual([expect.stringMatching(/^button "Buy now" \[ref_\w+\]$/)]);
    expect(find(document, refs, 'nonexistent').lines).toEqual([]);
  });

  it('find says when the page has more than it read, so that a line not found may be past the cut', () => {
    document.body.innerHTML = '<p>first</p>'.repeat(5000) + '<button>Last one</button>';
    const refs = new RefStore();
    expect(find(document, refs, 'last one')).toEqual({ lines: [], truncated: true });
    expect(find(document, refs, 'first', 1)).toEqual({ lines: ['text "first"'], truncated: true });
    document.body.innerHTML = '<button>Last one</button>';
    expect(find(document, refs, 'nothing')).toEqual({ lines: [], truncated: false });
  }, 30_000); // 5,000 nodes read in jsdom take seconds on a loaded machine

  it('find matches whatever the accents, and shows the text as the page writes it', () => {
    document.body.innerHTML = '<button>Ágora Café</button><button>Valencia</button>';
    const refs = new RefStore();
    expect(find(document, refs, 'agora CAFE').lines).toEqual([expect.stringMatching(/^button "Ágora Café" \[ref_\w+\]$/)]);
    expect(find(document, refs, 'válencia').lines).toEqual([expect.stringMatching(/^button "Valencia" \[ref_\w+\]$/)]);
  });
});

describe('a11y snapshot layout', () => {
  const issues = `
    <header><nav><ul><li><a href="/">Home</a></li><li><a href="/issues">Issues</a></li><li><button aria-expanded="false">Account</button></li></ul></nav></header>
    <main>
      <h1>Open issues</h1>
      <label>Status <select><option>Open</option></select></label>
      <ul>
        <li><article><h3><a href="/issues/PROJ-12">Login fails with SSO</a></h3><p>Users get a 500 after the redirect.</p>
          <span>In progress</span><button>Assign</button></article></li>
        <li><article><h3><a href="/issues/PROJ-13">Export is slow</a></h3><span>Open</span><button>Assign</button></article></li>
      </ul>
    </main>
    <footer><ul><li><a href="/about">About</a></li><li><a href="/help">Help</a></li></ul></footer>`;
  const lines = (opts: Parameters<typeof snapshot>[2] = { filter: 'interactive' }) => {
    document.body.innerHTML = issues;
    return snapshot(document, new RefStore(), opts).text.split('\n');
  };

  it('opens a section per top landmark and writes a short group on one line', () => {
    const out = lines();
    expect(out[0]).toBe('--- banner ---');
    expect(out[1]).toMatch(/^navigation: \[Home\]\(\/\) \[ref_\w+\] · \[Issues\]\(\/issues\) \[ref_\w+\] · button "Account" \[ref_\w+\] expanded=false$/);
    expect(out).toContain('--- main ---');
    expect(out).toContain('# Open issues');
    expect(out.at(-1)).toMatch(/^\[About\]\(\/about\) \[ref_\w+\] · \[Help\]\(\/help\) \[ref_\w+\]$/);
    expect(out.join('\n')).not.toMatch(/listitem|article|\blist\b/);
  });

  it('keeps a link inside a heading, with its ref and target', () => {
    document.body.innerHTML = issues;
    const refs = new RefStore();
    const text = snapshot(document, refs, { filter: 'interactive' }).text;
    const ref = text.match(/### \[Login fails with SSO\]\(\/issues\/PROJ-12\) \[(ref_\w+)\]/)?.[1];
    expect(refs.get(ref!)).toBe(document.querySelector('a[href="/issues/PROJ-12"]'));
    expect(find(document, refs, 'login sso').lines).toContainEqual(expect.stringMatching(/^\[Login fails with SSO\]\(\/issues\/PROJ-12\) \[ref_\w+\]$/));
  });

  it('writes each list item on one line, with its short text even when only interactive elements are read', () => {
    const items = lines().filter((l) => l.startsWith('- '));
    expect(items).toHaveLength(2);
    expect(items[0]).toMatch(/^- ### \[Login fails with SSO\]\(\/issues\/PROJ-12\) \[ref_\w+\] · Users get a 500 after the redirect\. · In progress · button "Assign" \[ref_\w+\]$/);
    expect(items[1]).toMatch(/· Open · button "Assign"/);
  });

  it("leaves out a label's text next to the field it names", () => {
    const out = lines({ filter: 'all' });
    expect(out).toContainEqual(expect.stringMatching(/^combobox "Status" \[ref_\w+\] value="Open"$/));
    expect(out).not.toContain('Status');
  });

  // A chat app's rail: each entry an icon drawn in an SVG, its HTML inside a foreignObject.
  const rail = `<nav aria-label="Spaces sidebar"><div role="tree" tabindex="0"><div role="group" aria-label="Spaces">
    ${['Example Space', 'Ágora Space'].map((name, i) => `<div class="item"><span><div><svg width="48" height="48" viewBox="-4 -4 48 48"><mask id="m${i}"></mask>
      <g><path d="M0 0h48v48H0z"></path><text>drawn</text><foreignObject x="0" y="0" width="48" height="48" mask="url(#m${i})">
      <div role="treeitem" aria-label="${name}" tabindex="-1" data-list-item-id="spaces___${i}"><img alt="" src="data:,"></div>
      </foreignObject></g></svg></div></span><span><div><span>${name}</span></div></span></div>`).join('')}</div></div></nav>`;

  it('reads the HTML inside an SVG foreignObject, with refs, and leaves the rest of the drawing out', () => {
    document.body.innerHTML = rail;
    const refs = new RefStore();
    const text = snapshot(document, refs, { filter: 'all' }).text;
    expect(text).toMatch(/^navigation "Spaces sidebar": tree: group "Spaces": treeitem "Example Space" \[ref_\w+\] · treeitem "Ágora Space" \[(ref_\w+)\]$/);
    expect(text).not.toContain('drawn');
    const ref = text.match(/treeitem "Ágora Space" \[(ref_\w+)\]/)![1]!;
    expect(refs.get(ref)).toBe(document.querySelector('[data-list-item-id="spaces___1"]'));
    expect(find(document, refs, 'ágora').lines).toEqual([`treeitem "Ágora Space" [${ref}]`]);
  });

  it('leaves out an SVG that is hidden, foreignObject and all', () => {
    document.body.innerHTML = rail.replace('<svg ', '<svg aria-hidden="true" ');
    expect(snapshot(document, new RefStore(), { filter: 'all' }).text).not.toContain('Example Space" [ref_');
  });

  it('reads a foreignObject through the containers drawn in place, not one in defs, a symbol or a shape', () => {
    document.body.innerHTML = `<svg width="48" height="48">
      <defs><foreignObject><button>In defs</button></foreignObject></defs>
      <symbol id="s"><foreignObject><button>In a symbol</button></foreignObject></symbol>
      <path d="M0 0h1"><foreignObject><button>In a path</button></foreignObject></path>
      <a href="/a"><g><switch><foreignObject><button>Drawn</button></foreignObject></switch></g></a></svg>`;
    expect(snapshot(document, new RefStore()).text).toMatch(/^button "Drawn" \[ref_\w+\]$/);
  });

  it('does not go through the shapes of a drawing', () => {
    const paths = 2000;
    document.body.innerHTML = `<svg width="48" height="48"><g>${'<path d="M0 0h1"><title>drawn</title></path>'.repeat(paths)}<foreignObject><button>Drawn</button></foreignObject></g></svg>`;
    const spy = vi.spyOn(Element.prototype, 'children', 'get');
    try {
      expect(snapshot(document, new RefStore()).text).toMatch(/^button "Drawn" \[ref_\w+\]$/);
      expect(spy.mock.calls.length).toBeLessThan(paths); // the svg and its group, not each path and its title
    } finally {
      spy.mockRestore();
    }
  });

  it('breaks a group that does not fit on one line into its parts, under its label', () => {
    document.body.innerHTML = `<nav aria-label="Docs">${Array.from({ length: 12 }, (_, i) => `<a href="/docs/page-${i}">Documentation page ${i}</a>`).join('')}</nav>`;
    const out = snapshot(document, new RefStore(), { filter: 'interactive' }).text.split('\n');
    expect(out[0]).toBe('navigation "Docs":');
    expect(out).toHaveLength(13);
    expect(out[1]).toMatch(/^ {2}\[Documentation page 0\]\(\/docs\/page-0\) \[ref_\w+\]$/);
  });
});

describe('a11y snapshot of focusable containers', () => {
  const read = (html: string, opts: Parameters<typeof snapshot>[2] = {}) => {
    document.body.innerHTML = html;
    const refs = new RefStore();
    return { refs, text: snapshot(document, refs, opts).text };
  };
  const scroller = `<div id="scroller" tabindex="0" style="overflow: hidden scroll"><ul aria-label="Channels">
    <li><a role="link" aria-label="general" href="/c/general">general</a></li>
    <li><a role="link" aria-label="clips" href="/c/clips">clips</a></li></ul></div>`;

  it('shows each link of a focusable scroller with its own ref', () => {
    const { refs, text } = read(scroller);
    expect(text).not.toContain('clickable');
    const ref = text.match(/\[clips\]\(\/c\/clips\) \[(ref_\w+)\]/)![1]!;
    expect(text).toMatch(/\[general\]\(\/c\/general\) \[ref_\w+\]/);
    expect(refs.get(ref)).toBe(document.querySelector('a[href="/c/clips"]'));
  });

  it('shows them when only interactive elements are read too', () => {
    const { text } = read(scroller, { filter: 'interactive' });
    expect(text).not.toContain('clickable');
    expect(text).toMatch(/\[general\]\(\/c\/general\) \[ref_\w+\]/);
  });

  it('keeps the own text of the container', () => {
    expect(read('<div tabindex="0">Pick one <a href="/a">First</a></div>').text).toMatch(/^Pick one\n?.*\[First\]\(\/a\) \[ref_\w+\]$/m);
  });

  it('goes into a focusable container whose controls are inside an SVG foreignObject', () => {
    const { text } = read(`<div tabindex="0"><svg width="48" height="48"><foreignObject width="40" height="40"><div role="treeitem" aria-label="First space"></div></foreignObject></svg></div>`);
    expect(text).toMatch(/treeitem "First space" \[ref_\w+\]/);
    expect(text).not.toContain('clickable');
  });

  it('keeps a focusable element holding only an SVG drawing as clickable', () => {
    expect(read(`<div tabindex="0" aria-label="Logo"><svg width="48" height="48"><circle r="4" tabindex="0"></circle></svg></div>`).text).toMatch(/clickable "Logo" \[ref_\w+\]/);
  });

  it('keeps a focusable element with only text as clickable, with its name', () => {
    const { text } = read('<div tabindex="0"><h3>Basic plan</h3><p>9 € a month</p></div>');
    expect(text).toMatch(/^clickable "Basic plan 9 € a month" \[ref_\w+\]$/);
  });

  it('keeps an onclick element as clickable, with or without a tabindex, and does not go into it', () => {
    for (const attrs of ['onclick="go()"', 'onclick="go()" tabindex="0"']) {
      const { text } = read(`<div ${attrs}><a href="/docs">Docs</a> and more</div>`);
      expect(text).toMatch(/^clickable "Docs and more" \[ref_\w+\]$/);
    }
  });

  it('does not take a negative tabindex for a control, inside or out', () => {
    expect(read('<div tabindex="-1"><a href="/a">First</a></div>').text).toMatch(/^\[First\]\(\/a\) \[ref_\w+\]$/);
    expect(read('<div tabindex="0"><div tabindex="-1">Only text</div></div>').text).toMatch(/^clickable "Only text" \[ref_\w+\]$/);
  });

  it('goes through nested focusable containers down to what can be acted on', () => {
    const { text } = read('<div tabindex="0"><div tabindex="0"><div><a href="/a">First</a></div></div></div>');
    expect(text).toMatch(/^\[First\]\(\/a\) \[ref_\w+\]$/);
  });

  it('counts an inner focusable element or onclick element as something to act on, each with its ref', () => {
    const { text } = read('<div tabindex="0"><div tabindex="0">Card one</div><div onclick="go()">Card two</div></div>');
    expect(text).toMatch(/clickable "Card one" \[ref_\w+\]/);
    expect(text).toMatch(/clickable "Card two" \[ref_\w+\]/);
    expect(text).not.toContain('Card oneCard two');
  });

  it('finds a link inside a heading, and one in an open shadow root', () => {
    expect(read('<div tabindex="0"><h3><a href="/a">First</a></h3><p>Details</p></div>').text).toMatch(/\[First\]\(\/a\) \[ref_\w+\]/);
    document.body.innerHTML = '<shadow-card tabindex="0"></shadow-card>';
    document.querySelector('shadow-card')!.attachShadow({ mode: 'open' }).innerHTML = '<a href="/s">In shadow</a>';
    expect(snapshot(document, new RefStore()).text).toMatch(/^\[In shadow\]\(\/s\) \[ref_\w+\]$/);
  });

  it.each([
    ['the hidden attribute', '<a hidden href="/x">Gone</a>'],
    ['display: none', '<a style="display: none" href="/x">Gone</a>'],
    ['aria-hidden', '<a aria-hidden="true" href="/x">Gone</a>'],
    ['a hidden wrapper', '<div hidden><div><a href="/x">Gone</a></div></div>'],
    ['an aria-hidden wrapper', '<div aria-hidden="true"><a href="/x">Gone</a></div>'],
    ['a template', '<template><a href="/x">Gone</a></template>'],
  ])('does not count a link hidden by %s', (_how, inner) => {
    const { text } = read(`<div tabindex="0">Visible text${inner}</div>`);
    expect(text).toMatch(/^clickable "Visible text.*" \[ref_\w+\]$/);
    expect(text).not.toContain('](/x)');
  });

  it('keeps a ref given to the container before it held links: it resolves, reads its area and is described', () => {
    document.body.innerHTML = '<div id="box" tabindex="0" aria-label="Channels">Loading</div>';
    const refs = new RefStore();
    const ref = snapshot(document, refs).text.match(/clickable "Channels" \[(ref_\w+)\]/)![1]!;
    const box = document.getElementById('box')!;
    box.innerHTML = '<a href="/c/general">general</a>';
    expect(refs.get(ref)).toBe(box);
    expect(describeElement(box)).toBe('div "Channels"');
    expect(snapshot(document, refs, { root: box }).text).toMatch(/^\[general\]\(\/c\/general\) \[ref_\w+\]$/);
  });

  it('browser.find gets the link, not the container', () => {
    document.body.innerHTML = scroller;
    expect(find(document, new RefStore(), 'clips').lines).toEqual([expect.stringMatching(/^\[clips\]\(\/c\/clips\) \[ref_\w+\]$/)]);
  });

  it('stays linear on a focusable grid: focusable rows of text-only cells in a focusable container', () => {
    const rows = 200;
    const row = `<div tabindex="0">${'<div><span>cell</span></div>'.repeat(10)}</div>`;
    const spy = vi.spyOn(window, 'getComputedStyle');
    try {
      const { text } = read(`<div tabindex="0">${row.repeat(rows)}</div>`, { filter: 'interactive' });
      expect(text.match(/^clickable "cell/gm)).toHaveLength(rows);
      const elements = document.body.querySelectorAll('*').length;
      expect(spy.mock.calls.length).toBeLessThanOrEqual(3 * elements); // the container stops at its first row; each row looks at its own cells once
    } finally {
      spy.mockRestore();
    }
  });

  it('stays linear on nested containers', () => {
    const levels = 100;
    const fillers = '<div>text</div>'.repeat(10);
    const html = `${'<div tabindex="0">' + fillers}`.repeat(levels) + '<a href="/deep">Deep</a>' + '</div>'.repeat(levels);
    const spy = vi.spyOn(window, 'getComputedStyle');
    try {
      expect(read(html, { filter: 'interactive' }).text).toMatch(/^\[Deep\]\(\/deep\) \[ref_\w+\]$/);
      const elements = document.body.querySelectorAll('*').length;
      expect(spy.mock.calls.length).toBeLessThanOrEqual(3 * elements); // each element looked at by the walk, and once by the container above it
    } finally {
      spy.mockRestore();
    }
  });
});

describe('a11y snapshot names (Playwright accname)', () => {
  const read = (html: string, opts: Parameters<typeof snapshot>[2] = {}) => {
    document.body.innerHTML = html;
    return snapshot(document, new RefStore(), opts).text;
  };

  it('leaves out the aria-hidden copy of a price read out for screen readers', () => {
    const html = '<a href="/p/1"><span class="sr-only">49,99 €</span><span aria-hidden="true">49<sup>,99</sup>€</span></a>';
    expect(read(html)).toMatch(/^\[49,99 €\]\(\/p\/1\) \[ref_\w+\]$/);
  });

  it('puts a space between the blocks of a name, none inside a line', () => {
    expect(read('<a href="/m/1"><div>Work</div><div>Subject of the <b>report</b></div></a>')).toMatch(/^\[Work Subject of the report\]/);
  });

  it('names a row or a cell by no text of its own: what is in it says it', () => {
    const text = read('<table><tr><td>Owner</td><td><a href="/o">City</a></td></tr></table>');
    expect(text).not.toContain('row "');
    expect(text).toContain('Owner · [City](/o)');
  });

  it('names no row by the part of it its aria-labelledby points to', () => {
    const text = read('<table role="grid"><tr role="row" aria-labelledby="s1"><td><a href="/t/1"><span id="s1">Quarterly report</span></a></td><td>9:00</td></tr></table>');
    expect(text).not.toContain('row "');
    expect(text).toContain('[Quarterly report](/t/1)');
  });

  it('keeps the name a landmark takes from its own heading', () => {
    expect(read('<nav aria-labelledby="t"><h2 id="t">Trams in Europe</h2><a href="/a">A</a></nav>')).toMatch(/^navigation "Trams in Europe":/);
  });

  it('takes a field\'s name from its label, its placeholder or its title', () => {
    const text = read('<label>Email <input type="email"></label><input placeholder="Search mail"><input title="Code">');
    expect(text).toContain('textbox "Email"');
    expect(text).toContain('textbox "Search mail"');
    expect(text).toContain('textbox "Code"');
  });
});

describe('extractors', () => {
  it('reads page meta and selection', () => {
    const meta = pageMeta(document);
    expect(meta.title).toBe('Demo Shop · X1 Headphones');
    expect(meta.lang).toBe('en');
    const p = document.querySelector('article p')!;
    const range = document.createRange();
    range.selectNodeContents(p);
    document.getSelection()!.addRange(range);
    expect(selectionText(document).text).toContain('Active noise cancelling');
  });

  it('extracts readable markdown of the main content', () => {
    const { title, markdown } = readableMarkdown(document);
    expect(title).toContain('X1 Headphones');
    expect(markdown.text).toContain('Active noise cancelling');
    expect(markdown.text).not.toContain('must not appear');
  });

  it('keeps a table of the main content as a Markdown table', () => {
    document.body.innerHTML =
      `<article><h1>Cable guide</h1><p>${'Prose about cables and connectors. '.repeat(20)}</p>` +
      '<table><thead><tr><th>Model</th><th>Price</th></tr></thead><tbody><tr><td>A1</td><td>9,99 €</td></tr></tbody></table></article>';
    const { markdown } = readableMarkdown(document);
    expect(markdown.text).toMatch(/\| Model \| Price \|\n\| --- \| --- \|\n\| A1 +\| 9,99 € \|/);
  });

  it('reads no script or style as text when there is no article', () => {
    const parse = vi.spyOn(Readability.prototype, 'parse').mockReturnValue(null);
    document.body.innerHTML = '<form><label>Email <input></label><button>Sign in</button></form><script>window.cfg = {"csrf": "t-1"}</script><style>.x { color: red }</style>' +
      '<svg><text>chart label</text></svg><object data="a.pdf">no plugin</object><iframe>frame fallback</iframe>';
    const { markdown } = readableMarkdown(document);
    parse.mockRestore();
    expect(markdown.text).toBe('Email Sign in');
  });

  it('extracts OpenGraph, description, canonical and JSON-LD (ignoring broken blocks)', () => {
    const data = structuredData(document);
    expect(data.meta['og:title']).toBe('X1 Headphones');
    expect(data.meta.description).toContain('noise cancelling');
    expect(data.meta.canonical).toBe('https://shop.test/p/x1');
    expect(data.jsonLd).toEqual([expect.objectContaining({ '@type': 'Product', name: 'X1 Headphones' })]);
  });
});

describe('site skill variables', () => {
  it('finds the variables written in instructions, each once', () => {
    expect(findVariables('Title {{selector:h1}}, price {{schema:@Product:offers.price}}, again {{selector:h1}}, not {{other:x}}')).toEqual([
      '{{selector:h1}}',
      '{{schema:@Product:offers.price}}',
    ]);
    expect(parseVariable('{{selector:img.hero?src}}')).toEqual({ kind: 'selector', css: 'img.hero', attr: 'src' });
    expect(parseVariable('{{schema:Product}}')).toBeNull(); // the type needs an @ and a path
    expect(parseVariable('{{items:li.result; title = h3 ; url=a?href; id=?data-id; label=}}')).toEqual({
      kind: 'items',
      container: 'li.result',
      fields: [
        { name: 'title', css: 'h3', attr: undefined },
        { name: 'url', css: 'a', attr: 'href' },
        { name: 'id', css: undefined, attr: 'data-id' },
        { name: 'label', css: undefined, attr: undefined },
      ],
    });
    expect(parseVariable('{{items:li.result}}')).toBeNull(); // no fields
    expect(parseVariable('{{items:li; h3}}')).toBeNull(); // a field without a name
    expect(parseVariable('{{url}}')).toEqual({ kind: 'url' });
    expect(parseVariable('{{url:x}}')).toBeNull();
  });

  it('resolves them on the page: text, attributes, meta and JSON-LD; empty when nothing matches', () => {
    const tokens = ['{{selector:h1}}', '{{meta:og:title}}', '{{schema:@Product:offers.price}}', '{{selector:link[rel=canonical]?href}}', '{{selector:.missing}}', '{{selector:[[bad}}', '{{url}}'];
    const values = Object.fromEntries(Object.entries(variableValues(document, tokens)).map(([k, v]) => [k, 'text' in v ? v.text : v]));
    expect(values).toEqual({
      '{{selector:h1}}': 'X1 Headphones',
      '{{meta:og:title}}': 'X1 Headphones',
      '{{schema:@Product:offers.price}}': '129.00',
      '{{selector:link[rel=canonical]?href}}': expect.stringContaining('x1'),
      '{{selector:.missing}}': '',
      '{{selector:[[bad}}': '',
      '{{url}}': document.URL,
    });
  });

  it('reads items as records: first match per field, the container itself, absolute links, gaps kept', () => {
    const token = '{{items:nav a; text=; url=?href; icon=img?src}}';
    expect(variableValues(document, [token, '{{items:.missing; a=b}}'])).toEqual({
      [token]: {
        total: 3,
        items: [
          { text: 'Home', url: 'http://localhost:3000/', icon: '' },
          { text: 'Deals', url: 'http://localhost:3000/deals', icon: '' },
          { text: 'Menu', url: 'javascript:void(0)', icon: '' },
        ],
      },
      '{{items:.missing; a=b}}': { total: 0, items: [] },
    });
  });
});

