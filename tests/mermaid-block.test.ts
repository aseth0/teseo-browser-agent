// @vitest-environment jsdom
// ```mermaid blocks of the model's text drawn as diagrams: only once closed, falling back to their code
// with a line saying why, their SVG imported through an allowlist, and their zoom.
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { fenceClosed } from '../src/markdown/mermaid';
import { diagramSvg } from '../src/ui/diagram-svg';
import { zoomedBy, zoomLabel } from '../src/ui/DiagramView';
import { Markdown } from '../src/ui/Markdown';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('fenceClosed', () => {
  it('is true when the last line closes the opening fence', () => {
    expect(fenceClosed('```mermaid\npie\n"a": 1\n```')).toBe(true);
    expect(fenceClosed('~~~mermaid\npie\n~~~~\n')).toBe(true);
    expect(fenceClosed('````mermaid\npie\n````  ')).toBe(true);
    expect(fenceClosed('```mermaid\npie\n> ```')).toBe(true); // in a quote
  });
  it('is false while it streams, or when another fence ends it', () => {
    expect(fenceClosed('```mermaid')).toBe(false);
    expect(fenceClosed('```mermaid\npie\n"a": 1')).toBe(false);
    expect(fenceClosed('```mermaid\npie\n``')).toBe(false);
    expect(fenceClosed('````mermaid\npie\n```')).toBe(false); // shorter
    expect(fenceClosed('```mermaid\npie\n~~~')).toBe(false); // other character
    expect(fenceClosed('```mermaid\npie\n``` text')).toBe(false);
  });
});

describe('diagramSvg', () => {
  const NS = 'xmlns="http://www.w3.org/2000/svg"';
  it("keeps what pele draws with: shapes, text, classes, inline styles and its own #ids", () => {
    const svg = diagramSvg(`<svg ${NS} class="pele" viewBox="0 0 10 10" width="10" height="10" style="max-width:100%;--_fg:var(--pele-fg,#1f1f1f)" role="graphics-document document">`
      + '<g class="pele-node" data-id="A" transform="translate(1,1)"><rect x="0" y="0" width="5" height="5" rx="1" fill="var(--_s)"/>'
      + '<text x="1" y="4" text-anchor="middle" xml:space="preserve"><tspan dy="1">A &lt;b&gt;</tspan></text></g>'
      + '<defs><marker id="m1"><path d="M0,0L1,1"/></marker></defs><path d="M0,0L5,5" marker-end="url(#m1)" clip-path="url(#c1)"/></svg>')!;
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(svg.getAttribute('class')).toBe('pele');
    expect(svg.getAttribute('style')).toContain('--_fg:var(--pele-fg,#1f1f1f)');
    expect(svg.querySelector('rect')?.getAttribute('fill')).toBe('var(--_s)');
    expect(svg.querySelector('tspan')?.textContent).toBe('A <b>');
    expect(svg.querySelector('g')?.getAttribute('data-id')).toBe('A');
    expect(svg.querySelector('marker')?.id).toBe('m1');
    expect(svg.querySelector(':scope > path')?.getAttribute('clip-path')).toBe('url(#c1)');
  });
  it('drops scripts, handlers, links, embedded content and references outside the SVG', () => {
    const svg = diagramSvg(`<svg ${NS} onload="alert(1)"><script>alert(1)</script><style>@import url(https://evil.test/x.css)</style>`
      + '<a href="javascript:alert(1)"><text>link</text></a><image href="https://evil.test/p.png"/>'
      + '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>'
      + '<rect fill="url(https://evil.test/p.png)" style="background:url(https://evil.test/s.png)" onclick="x()" data-href="https://evil.test"/>'
      + '<rect style="fill:red;behavior:expression(alert(1))"/><use href="#a"/></svg>')!;
    const markup = new XMLSerializer().serializeToString(svg);
    expect(markup).not.toMatch(/script|style>|evil|onload|onclick|href|<a|image|foreignObject|<use|expression/);
    expect(svg.querySelectorAll('rect')).toHaveLength(2);
  });
  it('is none for what is not an SVG', () => {
    expect(diagramSvg('<html><body>x</body></html>')).toBeUndefined();
    expect(diagramSvg('<svg')).toBeUndefined();
  });
});

describe('the zoom', () => {
  it('steps from the scale shown, between 25% and 300%', () => {
    expect(zoomedBy(1, 1.25)).toBe(1.25);
    expect(zoomedBy(0.6, 1 / 1.25)).toBe(0.48);
    expect(zoomedBy(2.8, 1.25)).toBe(3);
    expect(zoomedBy(0.3, 1 / 1.25)).toBe(0.25);
    expect(zoomLabel(undefined)).toBe('Fit');
    expect(zoomLabel(1.25)).toBe('125%');
  });
});

describe('Mermaid blocks in Markdown', () => {
  const mount = async (text: string) => {
    const el = document.createElement('div');
    const root = createRoot(el);
    await act(async () => root.render(createElement(Markdown, { text })));
    // The kind loads the first time (pele/lazy).
    await act(async () => new Promise((r) => setTimeout(r, 50)));
    return { el, rerender: (t: string) => act(async () => root.render(createElement(Markdown, { text: t }))), unmount: () => act(() => root.unmount()) };
  };
  const FLOW = 'flowchart LR\n  A[Start] --> B[End]';

  it('stay code while the fence is open, and are drawn once it closes', async () => {
    const m = await mount(`Here:\n\n\`\`\`mermaid\n${FLOW}`);
    expect(m.el.querySelector('.mermaid-block')).toBeNull();
    expect(m.el.querySelector('pre code')?.textContent).toContain('A[Start]');
    await m.rerender(`Here:\n\n\`\`\`mermaid\n${FLOW}\n\`\`\`\n\nDone`);
    await act(async () => new Promise((r) => setTimeout(r, 50)));
    const block = m.el.querySelector('.mermaid-block')!;
    expect(block).toBeTruthy();
    const svg = block.querySelector('.diagram-svg svg');
    expect(svg?.textContent).toContain('Start');
    expect(block.querySelector('[aria-pressed="true"]')?.textContent).toBe('Diagram');
    expect(block.querySelector('.zoom-level')?.textContent).toBe('Fit');
    // Streaming more text after it does not draw it again.
    await m.rerender(`Here:\n\n\`\`\`mermaid\n${FLOW}\n\`\`\`\n\nDone and more`);
    expect(m.el.querySelector('.diagram-svg svg')).toBe(svg);
    m.unmount();
  });

  it('show their code with Code, and zoom', async () => {
    const m = await mount(`\`\`\`mermaid\n${FLOW}\n\`\`\``);
    const button = (label: string) => [...m.el.querySelectorAll('button')].find((b) => b.textContent === label || b.title === label)!;
    await act(async () => button('Zoom in').click());
    expect(m.el.querySelector('.zoom-level')?.textContent).toMatch(/^\d+%$/);
    expect((m.el.querySelector('.diagram-svg svg') as SVGElement).style.maxWidth).toBe('none');
    await act(async () => button('Fit to width').click());
    expect(m.el.querySelector('.zoom-level')?.textContent).toBe('Fit');
    await act(async () => button('Code').click());
    expect(m.el.querySelector('.diagram-svg')).toBeNull();
    expect(m.el.querySelector('.mermaid-block pre code')?.textContent).toBe(FLOW);
    m.unmount();
  });

  it('fall back to their code with a line: an error, or a kind pele does not know', async () => {
    const bad = await mount('```mermaid\nflowchart LR\n  A[Start --> \n```');
    expect(bad.el.querySelector('.mermaid-note')?.textContent).toMatch(/^The diagram could not be drawn: /);
    expect(bad.el.querySelector('.mermaid-block pre code')?.textContent).toContain('A[Start');
    bad.unmount();
    const unknown = await mount('```mermaid\nnotADiagram\n  a --> b\n```');
    expect(unknown.el.querySelector('.mermaid-note')?.textContent).toBe("This kind of diagram can't be drawn here.");
    unknown.unmount();
  });

  it('leave other code blocks as they were', async () => {
    const m = await mount('```js\nlet a = 1;\n```');
    expect(m.el.querySelector('.mermaid-block')).toBeNull();
    expect(m.el.querySelector('.copyable pre code.hljs')).toBeTruthy();
    m.unmount();
  });
});
