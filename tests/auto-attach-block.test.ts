// @vitest-environment jsdom
// The playground of Auto-attach (ui/AutoAttachBlock's AttachPlayground): as it was where only words count, two meters and
// no single line where meaning counts too, and the provider not called on each key.
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AttachPlayground } from '../src/ui/AutoAttachBlock';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const defaults = { threshold: 60, max: 2, most: 5 };
const hits = [
  { id: 'a', match: 0.68, meaning: 0.44, title: 'Order tracking codes' },
  { id: 'b', match: 0.12, meaning: 0.71, title: 'Returns need the order number' },
  { id: 'c', match: 0.15, meaning: 0.29, title: 'Invoice address' },
];
const picked = ['a', 'b'];
const wordsOnly = hits.map(({ meaning: _, ...h }) => h);

let container: HTMLDivElement;
function mount(props: object) {
  container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(createElement(AttachPlayground, { auto: { enabled: true, threshold: 60 }, defaults, nouns: ['item', 'items'], searchLabel: 'Try', search: async () => ({ hits: wordsOnly, picked: ['a'] }), ...props } as never)),
  );
}
const typeQuery = (value: string) =>
  act(() => {
    const box = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, value);
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
const after = (ms: number) => act(async () => vi.advanceTimersByTime(ms));

afterEach(() => {
  container?.remove();
  vi.useRealTimers();
});

describe('where only words count', () => {
  it('shows one meter, the line of the match needed, and no labels', async () => {
    vi.useFakeTimers();
    mount({});
    typeQuery('order');
    await after(150);
    expect(container.querySelectorAll('.playground-meter')).toHaveLength(3);
    expect(container.querySelector('.playground-threshold')!.textContent).toBe('60% needed');
    expect(container.textContent).toContain('68% match');
    expect(container.textContent).not.toContain('Meaning');
  });
});

describe('where meaning counts too', () => {
  const withMeaning = (over: object = {}) => ({ meaningThreshold: 55, search: async () => ({ hits, picked }), ...over });

  it('shows two labelled meters per hit, each with its own mark, and no single line', async () => {
    vi.useFakeTimers();
    mount(withMeaning());
    typeQuery('order');
    await after(150);
    expect(container.querySelectorAll('.playground-meter')).toHaveLength(6);
    expect(container.querySelector('.playground-threshold')).toBeNull();
    const marks = [...container.querySelectorAll<HTMLElement>('.playground-meter > i')].slice(0, 2).map((m) => m.style.left);
    expect(marks).toEqual(['60%', '55%']);
    const first = container.querySelector('.playground-hit')!.textContent!;
    expect(first).toContain('Words');
    expect(first).toContain('68%');
    expect(first).toContain('Meaning');
    expect(first).toContain('44%');
  });

  it('counts as reaching what either meter reaches', async () => {
    vi.useFakeTimers();
    mount(withMeaning());
    typeQuery('order');
    await after(150);
    const under = [...container.querySelectorAll('.playground-hit')].map((h) => h.classList.contains('under'));
    expect(under).toEqual([false, false, true]);
    expect(container.querySelectorAll('.badge.accent')).toHaveLength(2);
  });

  it('asks for meaning once the typing stops, not on each key', async () => {
    vi.useFakeTimers();
    const refine = vi.fn(async () => ({ hits, picked }));
    mount(withMeaning({ refine }));
    for (const q of ['o', 'or', 'ord', 'orde', 'order']) {
      typeQuery(q);
      await after(100);
    }
    expect(refine).not.toHaveBeenCalled();
    await after(600);
    expect(refine).toHaveBeenCalledTimes(1);
    expect(refine).toHaveBeenCalledWith('order');
  });

  it('shows what meaning found, and says when it could not', async () => {
    vi.useFakeTimers();
    const refine = vi.fn(async () => ({ hits, picked, note: 'Matched by words only: the embeddings provider did not answer.' }));
    mount(withMeaning({ refine }));
    typeQuery('order');
    await after(150);
    await after(600);
    expect(container.textContent).toContain('Matched by words only');
  });
});
