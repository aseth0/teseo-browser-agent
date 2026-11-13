// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { Markdown } from '../src/ui/Markdown';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Markdown while the answer streams', () => {
  it('keeps the code blocks and tables already shown, not new ones at each token', async () => {
    const el = document.createElement('div');
    const root = createRoot(el);
    const start = 'Code:\n\n```js\nlet a = 1;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nMore';
    await act(async () => root.render(createElement(Markdown, { text: start })));
    const [code, table] = [...el.querySelectorAll('.copyable')];
    expect(code?.querySelector('pre')).toBeTruthy();
    expect(table?.querySelector('table')).toBeTruthy();
    await act(async () => root.render(createElement(Markdown, { text: `${start} text` })));
    const [codeAfter, tableAfter] = [...el.querySelectorAll('.copyable')];
    expect(codeAfter).toBe(code);
    expect(tableAfter).toBe(table);
    act(() => root.unmount());
  });
});

describe('folding the headings', () => {
  const answer = '## One\n\nfirst\n\n### Two\n\nsecond\n\n## Three\n\nthird';
  const render = async (text: string, foldable = true) => {
    const el = document.createElement('div');
    document.body.append(el);
    const root = createRoot(el);
    const show = (t: string) => act(async () => root.render(createElement(Markdown, { text: t, foldable })));
    await show(text);
    const button = (name: string) => [...el.querySelectorAll('button')].find((b) => b.getAttribute('aria-label')?.endsWith(` ${name}`))!;
    const hidden = (text: string) => [...el.querySelectorAll('.fold-section.folded > .fold-body')].some((b) => b.textContent?.includes(text));
    return { el, root, show, button, hidden };
  };

  it('gives a heading a button only where asked', async () => {
    const { el, root } = await render(answer, false);
    expect(el.querySelector('button')).toBeNull();
    expect(el.querySelector('section')).toBeNull();
    act(() => root.unmount());
  });

  it('hides what is under a heading, its subheadings too, and not what comes after', async () => {
    const { root, button, hidden } = await render(answer);
    const one = button('One');
    expect(one.getAttribute('aria-expanded')).toBe('true');
    await act(async () => one.click());
    expect(button('One').getAttribute('aria-expanded')).toBe('false');
    expect(button('One').getAttribute('aria-label')).toBe('Unfold One');
    expect(hidden('first')).toBe(true);
    expect(hidden('second')).toBe(true);
    expect(hidden('third')).toBe(false);
    await act(async () => button('One').click());
    expect(hidden('first')).toBe(false);
    act(() => root.unmount());
  });

  it('stays folded as the text streams on, and the button is the same', async () => {
    const { root, show, button, hidden } = await render('## One\n\nfirst');
    await act(async () => button('One').click());
    const pressed = button('One');
    await show('## One\n\nfirst and more');
    await show('## One\n\nfirst and more\n\n### Tw');
    expect(hidden('more')).toBe(true);
    expect(hidden('Tw')).toBe(true);
    await show('## One\n\nfirst and more\n\n### Two\n\nsecond\n\n## Three\n\nthird');
    expect(button('One')).toBe(pressed);
    expect(hidden('second')).toBe(true);
    expect(hidden('third')).toBe(false);
    act(() => root.unmount());
  });

  it('stays folded when the streamed answer is shown anew as a message, its last tokens included', async () => {
    const start = '## Kept\n\nfirst';
    const live = await render(start);
    await act(async () => live.button('Kept').click());
    const message = await render(`${start} and the rest`);
    expect(message.hidden('the rest')).toBe(true);
    act(() => live.root.unmount());
    act(() => message.root.unmount());
  });

  it('stays unfolded when unfolded after that, shown anew', async () => {
    const start = '## Undone\n\nfirst';
    const live = await render(start);
    await act(async () => live.button('Undone').click());
    act(() => live.root.unmount());
    const message = await render(`${start} and the rest`);
    await act(async () => message.button('Undone').click());
    expect(message.hidden('the rest')).toBe(false);
    act(() => message.root.unmount());
    const again = await render(`${start} and the rest`);
    expect(again.hidden('the rest')).toBe(false);
    act(() => again.root.unmount());
  });

  it('does not fold another answer because it starts with the same heading', async () => {
    const one = await render('## Summary\n\nthe first answer');
    await act(async () => one.button('Summary').click());
    const other = await render('## Summary\n\nanother answer');
    expect(other.hidden('another')).toBe(false);
    act(() => one.root.unmount());
    act(() => other.root.unmount());
  });

  it('does not keep what was folded when another text takes its place', async () => {
    const { root, show, button, hidden } = await render('## Old\n\nthe first version');
    await act(async () => button('Old').click());
    await show('## New\n\nregenerated');
    expect(hidden('regenerated')).toBe(false);
    expect(button('New').getAttribute('aria-expanded')).toBe('true');
    act(() => root.unmount());
  });

  it('keeps a link in a heading, and the button adds no text to what is copied', async () => {
    const { el, root, button, hidden } = await render('## See [this](https://example.com/x)\n\nbody');
    const toggle = button('See this');
    await act(async () => toggle.click());
    expect(hidden('body')).toBe(true);
    expect(el.querySelector('h2 a')?.getAttribute('href')).toBe('https://example.com/x');
    expect(el.querySelector('h2 button')?.textContent).toBe('');
    act(() => root.unmount());
  });
});

describe('images in Markdown', () => {
  it('are never loaded: a link named by the alt text, or by the host; no URL, the alt text alone', async () => {
    const el = document.createElement('div');
    const root = createRoot(el);
    const text = '![a chart](https://evil.test/c.png?d=secret) ![](https://img.example.com/x.png) ![only alt]() ![x](javascript:alert(1))';
    await act(async () => root.render(createElement(Markdown, { text })));
    expect(el.querySelector('img')).toBeNull();
    const links = [...el.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href'), a.target]);
    expect(links).toEqual([
      ['a chart', 'https://evil.test/c.png?d=secret', '_blank'],
      ['img.example.com', 'https://img.example.com/x.png', '_blank'],
    ]);
    expect(el.textContent).toContain('only alt');
    expect(el.textContent).not.toContain('javascript');
    act(() => root.unmount());
  });
});
