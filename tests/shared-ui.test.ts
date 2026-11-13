// @vitest-environment jsdom
import { act, createElement as h, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Segmented } from '../src/ui/Segmented';
import { MarkdownToggle } from '../src/ui/MarkdownToggle';
import { Chip } from '../src/ui/Chip';
import { PanelHead } from '../src/entrypoints/sidepanel/PanelHead';
import { useAttempt } from '../src/ui/useAttempt';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
const show = async (node: ReactNode) => {
  host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return root;
};
const button = (name: string) => [...host.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent) === name)!;
const click = (el: Element) => act(async () => void (el as HTMLElement).click());
const key = (el: Element, k: string) => act(async () => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })));
afterEach(() => host.remove());

describe('Segmented', () => {
  it('is a labelled group of toggle buttons, the chosen one pressed', async () => {
    const onChange = vi.fn();
    await show(h(Segmented<'a' | 'b'>, { label: 'View', value: 'a', onChange, options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B', ariaLabel: 'Bee' }] }));
    const group = host.querySelector('[role="group"]')!;
    expect(group.getAttribute('aria-label')).toBe('View');
    expect(button('A').getAttribute('aria-pressed')).toBe('true');
    expect(button('Bee').getAttribute('aria-pressed')).toBe('false');
    await click(button('Bee'));
    expect(onChange).toHaveBeenCalledWith('b');
  });
});

describe('MarkdownToggle', () => {
  it('renders Markdown or shows it as written, its tags and placeholders when it has them', async () => {
    const onChange = vi.fn();
    await show(h(MarkdownToggle, { on: true, onChange, marks: true }));
    expect(button('Render Markdown').getAttribute('aria-pressed')).toBe('true');
    await click(button('Show as written (tags and placeholders)'));
    expect(onChange).toHaveBeenCalledWith(false);
  });
});

describe('Chip', () => {
  it('shows what goes, and takes it out with ×', async () => {
    const onClick = vi.fn();
    await show(h(Chip, { icon: 'file', remove: { label: 'Remove file a.txt', onClick }, children: 'a.txt' }));
    expect(host.textContent).toContain('a.txt');
    await click(button('Remove file a.txt'));
    expect(onClick).toHaveBeenCalled();
  });
});

describe('PanelHead', () => {
  it('searches, closes with Escape or Close, and keeps the list\'s own buttons between', async () => {
    const onQuery = vi.fn();
    const onClose = vi.fn();
    await show(h(PanelHead, { query: '', onQuery, placeholder: 'Search…', label: 'Search things', onClose }, h('button', null, 'Settings…')));
    const search = host.querySelector('input[aria-label="Search things"]')!;
    expect(document.activeElement).toBe(search);
    await key(search, 'Escape');
    await click(button('Close'));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Settings…', 'Close']);
  });
});

describe('useAttempt', () => {
  it('shows what a click could not do, clears it once one works, and runs `then` either way', async () => {
    let attempt!: ReturnType<typeof useAttempt>['attempt'];
    const Probe = () => {
      const a = useAttempt();
      attempt = a.attempt;
      return h('p', null, a.failed);
    };
    await show(h(Probe));
    const then = vi.fn();
    await act(async () => attempt(Promise.reject(new TypeError('No such tab')), then));
    expect(host.textContent).toBe('No such tab');
    await act(async () => attempt(Promise.resolve(), then));
    expect(host.textContent).toBe('');
    expect(then).toHaveBeenCalledTimes(2);
  });
});
