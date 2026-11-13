// @vitest-environment jsdom
import { act, createElement as h, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CollectionTable, EmptyCollection, Switch } from '../src/ui/Collection';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
const show = async (node: ReactNode) => {
  host = document.createElement('div');
  document.body.append(host);
  await act(async () => createRoot(host).render(node));
};
afterEach(() => host.remove());

type Thing = { id: string; name: string; enabled: boolean; group?: string; fixed?: boolean };
const things: Thing[] = [
  { id: '1', name: 'alpha', enabled: true, group: 'G' },
  { id: '2', name: 'beta', enabled: false, group: 'G' },
  { id: '3', name: 'gamma', enabled: true, fixed: true },
];

describe('CollectionTable', () => {
  it('shows each row on or off, its name opening it, and its own columns', async () => {
    const onToggle = vi.fn(async () => undefined);
    const opened = vi.fn();
    await show(h(CollectionTable<Thing>, {
      className: 'things-table', rows: things, rowKey: (t) => t.id, name: (t) => t.name, nameHead: 'Thing',
      onOpen: (t) => (t.fixed ? undefined : () => opened(t.id)), onTitle: 'Used', isOn: (t) => t.enabled, onToggle,
      fixed: (t) => (t.fixed ? 'Always used' : undefined),
      tags: (t) => h('span', { className: 'badge' }, t.group ?? 'none'),
      columns: [{ head: 'Size', cell: (t) => t.name.length }],
      description: (t) => `About ${t.name}`,
    }));
    expect([...host.querySelectorAll('th')].map((th) => th.textContent)).toEqual(['On', 'Thing', 'Tags', 'Size', 'Description']);
    const rows = [...host.querySelectorAll('tbody tr')];
    expect(rows.map((r) => r.className)).toEqual(['', 'off', '']);
    const box = host.querySelector<HTMLInputElement>('input[aria-label="beta: on"]')!;
    expect(box.checked).toBe(false);
    await act(async () => box.click());
    expect(onToggle).toHaveBeenCalledWith(things[1], true);
    const fixed = host.querySelector<HTMLInputElement>('input[aria-label="gamma: on"]')!;
    expect([fixed.disabled, fixed.title]).toEqual([true, 'Always used']);
    await act(async () => host.querySelector<HTMLButtonElement>('button.item-name')!.click());
    expect(opened).toHaveBeenCalledWith('1');
    expect(rows[2]!.querySelector('button.item-name')).toBeNull(); // no editor: the name alone
    expect(rows[0]!.textContent).toContain('About alpha');
  });

  it('puts rows under a heading per group while there is more than one, and a row of its own when asked', async () => {
    await show(h(CollectionTable<Thing>, {
      className: 'things-table', rows: things, rowKey: (t) => t.id, name: (t) => t.name, nameHead: 'Thing', onOpen: () => undefined,
      onTitle: 'Used', isOn: (t) => t.enabled, onToggle: async () => undefined, group: (t) => t.group ?? '', groupTitle: (g) => g || 'No group',
      lead: { head: null, className: 'drag-col', label: 'Order' },
      row: (_t, i, cells) => h('tr', { 'data-index': i }, h('td', { className: 'drag-col' }), cells),
    }));
    expect([...host.querySelectorAll('tbody th')].map((th) => th.textContent)).toEqual(['G', 'No group']);
    expect([...host.querySelectorAll('tbody tr[data-index]')].map((r) => r.getAttribute('data-index'))).toEqual(['0', '1', '2']);
    expect(host.querySelector('thead th')!.getAttribute('aria-label')).toBe('Order');
  });
});

describe('CollectionTable: switches and the selection', () => {
  const base = {
    className: 'things-table', rows: things, rowKey: (t: Thing) => t.id, name: (t: Thing) => t.name, nameHead: 'Thing',
    onOpen: () => undefined, onTitle: 'Used', isOn: (t: Thing) => t.enabled, onToggle: async () => undefined,
  };

  it('draws on/off as a switch, and no selection column while not selecting', async () => {
    await show(h(CollectionTable<Thing>, base));
    const on = host.querySelector<HTMLInputElement>('input[aria-label="beta: on"]')!;
    expect([on.type, on.getAttribute('role')]).toEqual(['checkbox', 'switch']);
    expect(host.querySelector('input[aria-label^="Select "]')).toBeNull();
  });

  it('while selecting, a checkbox per row and one for all those shown that can be chosen', async () => {
    const onSelect = vi.fn();
    const onSelectShown = vi.fn();
    const select = (selected: string[]) => ({ selected: new Set(selected), onSelect, onSelectShown, cannot: (t: Thing) => (t.fixed ? 'Comes with it' : undefined) });
    await show(h(CollectionTable<Thing>, { ...base, select: select([]) }));
    expect(host.querySelector('thead th input')!.getAttribute('aria-label')).toBe('Select all shown');
    const gamma = host.querySelector<HTMLInputElement>('input[aria-label="Select gamma"]')!;
    expect([gamma.disabled, gamma.title]).toEqual([true, 'Comes with it']);
    await act(async () => host.querySelector<HTMLInputElement>('input[aria-label="Select beta"]')!.click());
    expect(onSelect).toHaveBeenCalledWith('2', true);
    await act(async () => host.querySelector<HTMLInputElement>('input[aria-label="Select all shown"]')!.click());
    expect(onSelectShown).toHaveBeenCalledWith(['1', '2'], true);
    host.remove();
    await show(h(CollectionTable<Thing>, { ...base, select: select(['1']) }));
    const all = host.querySelector<HTMLInputElement>('input[aria-label="Select all shown"]')!;
    expect([all.checked, all.indeterminate]).toEqual([false, true]);
    host.remove();
    await show(h(CollectionTable<Thing>, { ...base, select: select(['1', '2']) }));
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Select all shown"]')!.checked).toBe(true);
  });
});

describe('Switch', () => {
  it('is a checkbox with the switch role, telling its change', async () => {
    const onChange = vi.fn();
    await show(h(Switch, { checked: false, label: 'jira can ask', onChange }));
    const box = host.querySelector<HTMLInputElement>('input[role="switch"]')!;
    expect(box.getAttribute('aria-label')).toBe('jira can ask');
    await act(async () => box.click());
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('EmptyCollection', () => {
  it('says there are none yet, or none matching the filter, once read', async () => {
    await show(h('div', null,
      h(EmptyCollection, { shown: 0, total: 0, one: 'thing', many: 'things', loaded: true }),
      h(EmptyCollection, { shown: 0, total: 2, one: 'thing', many: 'things', loaded: true }),
      h(EmptyCollection, { shown: 0, total: 0, one: 'thing', many: 'things', loaded: false }),
      h(EmptyCollection, { shown: 1, total: 2, one: 'thing', many: 'things', loaded: true })));
    expect([...host.querySelectorAll('p')].map((p) => p.textContent)).toEqual(['No things yet.', 'No thing matches the filter.']);
  });
});
